import makeWASocket, {
    DisconnectReason,
    fetchLatestBaileysVersion,
    makeCacheableSignalKeyStore,
    WASocket,
    ConnectionState
} from "@whiskeysockets/baileys";
import { prisma } from "@/lib/prisma";
import { usePrismaAuthState } from "./auth/usePrismaAuthState";
import { Server } from "socket.io";
import pino from "pino";
import { bindSessionStore } from "./store";
import { syncGroups } from "./store/groups";
import { bindContactSync } from "./store/contacts";
import { bindAutoReply } from "./store/autoreply";
import { bindPpGuard } from "./store/ppguard";
import { antispam } from "./antispam";
import { logger } from "@/lib/logger";

const MAX_RECONNECT_ATTEMPTS = 3;

export class WhatsAppInstance {
    socket: WASocket | null = null;
    qr: string | null = null;
    rq: string | null = null;
    status: string = "DISCONNECTED";
    sessionId: string;
    userId: string;
    io: Server;
    config: any = {};
    startTime: Date | null = null;
    pairingCode: string | null = null;

    isStopped: boolean = false;
    private reconnectCount: number = 0;
    /** Called when instance auto-stops or logs out — lets manager remove it from Map */
    onRemovedFromManager: (() => void) | null = null;

    constructor(sessionId: string, userId: string, io: Server) {
        this.sessionId = sessionId;
        this.userId = userId;
        this.io = io;
    }

    async init() {
        const sessionData = await prisma.session.findUnique({
            where: { sessionId: this.sessionId },
            include: { botconfig: true }
        });
        if (!sessionData) {
            logger.warn("Instance", `Session ${this.sessionId} not found in DB, aborting init`);
            return;
        }
        this.config = sessionData?.config || {};
        const botConfig = (sessionData as any)?.botconfig;

        const { state, saveCreds } = await usePrismaAuthState(this.sessionId);
        const { version } = await fetchLatestBaileysVersion();

        this.socket = makeWASocket({
            version,
            logger: pino({ level: process.env.BAILEYS_LOG_LEVEL || "error" }) as any,
            printQRInTerminal: false,
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(state.keys, pino({ level: process.env.BAILEYS_LOG_LEVEL || "error" }) as any),
            },
            browser: ["Ubuntu", "Chrome", "20.0.04"],
            markOnlineOnConnect: botConfig?.alwaysOnline ?? true,
            syncFullHistory: true,
        });

        // Apply Anti-Spam Wrapper to sendMessage
        const originalSendMessage = this.socket.sendMessage.bind(this.socket);
        const sessionId = this.sessionId;
        this.socket.sendMessage = async function (jid: string, content: any, options?: any) {
            await antispam.enqueue(sessionId, jid, content);
            return originalSendMessage(jid, content, options);
        } as any;

        // Bind Store for DB Sync
        bindSessionStore(this.socket, this.sessionId, this.io);

        // Bind Contact Sync
        bindContactSync(this.socket, this.sessionId);

        this.socket.ev.on("creds.update", saveCreds);

        this.socket.ev.on("connection.update", async (update) => {
            await this.handleConnectionUpdate(update);
        });
    }

    async handleConnectionUpdate(update: Partial<ConnectionState>) {
        const { connection, lastDisconnect, qr } = update;

        try {
            if (qr) {
                if (this.isStopped) return;
                // Reset reconnect count on new QR (user is re-scanning)
                this.reconnectCount = 0;
                this.qr = qr;
                this.status = "SCAN_QR";

                this.io?.to(this.sessionId).emit("connection.update", { status: this.status, qr });

                await prisma.session.update({
                    where: { sessionId: this.sessionId },
                    data: { qr, status: "SCAN_QR" }
                });
            }

            if (connection === "close") {
                const code = (lastDisconnect?.error as any)?.output?.statusCode;
                const isLoggedOut = code === DisconnectReason.loggedOut;

                if (isLoggedOut) {
                    // Logged out: stop permanently, remove from memory
                    this.status = "LOGGED_OUT";
                    this.socket = null;
                    this.config = {};
                    this.io?.to(this.sessionId).emit("connection.update", { status: "LOGGED_OUT", qr: null });

                    logger.info("Instance", `Session ${this.sessionId} logged out. Deleting credentials...`);
                    try {
                        await prisma.$transaction([
                            prisma.session.update({
                                where: { sessionId: this.sessionId },
                                data: { status: "LOGGED_OUT", qr: null }
                            }),
                            prisma.authstate.deleteMany({
                                where: { sessionId: this.sessionId }
                            })
                        ]);
                    } catch (e) { /* ignore */ }
                    logger.success("Instance", `Session ${this.sessionId} credentials deleted.`);

                    // Remove from memory manager
                    this.onRemovedFromManager?.();
                    return;
                }

                if (this.isStopped) {
                    // Explicitly stopped: preserve creds for restart
                    this.status = "STOPPED";
                    this.socket = null;
                    this.reconnectCount = 0;
                    this.io?.to(this.sessionId).emit("connection.update", { status: "STOPPED", qr: null });

                    await prisma.session.update({
                        where: { sessionId: this.sessionId },
                        data: { status: "STOPPED", qr: null }
                    }).catch(() => {});
                    logger.warn("Instance", `Session ${this.sessionId} stopped. Credentials preserved.`);

                    // Remove from memory manager
                    const { waManager } = require("./manager");
                    waManager.removeInstance(this.sessionId);
                    return;
                }

                // Unexpected disconnect: retry with limit
                this.reconnectCount++;
                const remaining = MAX_RECONNECT_ATTEMPTS - this.reconnectCount + 1;

                if (remaining > 0) {
                    this.status = "DISCONNECTED";
                    this.io?.to(this.sessionId).emit("connection.update", { status: "DISCONNECTED", qr: null });
                    await prisma.session.update({
                        where: { sessionId: this.sessionId },
                        data: { status: "DISCONNECTED", qr: null }
                    }).catch(() => {});

                    logger.warn("Instance",
                        `Session ${this.sessionId} disconnected. Reconnecting (${this.reconnectCount}/${MAX_RECONNECT_ATTEMPTS})...`
                    );
                    setTimeout(() => {
                        if (!this.isStopped) this.init();
                    }, 3000);
                } else {
                    // Max retries exceeded — auto-stop
                    this.status = "STOPPED";
                    this.socket = null;
                    this.reconnectCount = 0;
                    this.isStopped = true; // prevent further retries
                    this.io?.to(this.sessionId).emit("connection.update", { status: "STOPPED", qr: null });

                    await prisma.session.update({
                        where: { sessionId: this.sessionId },
                        data: { status: "STOPPED", qr: null }
                    }).catch(() => {});
                    logger.error("Instance",
                        `Session ${this.sessionId} max reconnects (${MAX_RECONNECT_ATTEMPTS}) reached. Auto-stopped.`
                    );

                    // Remove from memory manager
                    this.onRemovedFromManager?.();
                }
            }

            if (connection === "open") {
                // Connected — reset reconnect count
                this.reconnectCount = 0;
                this.isStopped = false;
                this.status = "CONNECTED";
                this.qr = null;
                this.startTime = new Date();

                this.io?.to(this.sessionId).emit("connection.update", { status: "CONNECTED", qr: null });

                try {
                    await syncGroups(this.socket as WASocket, this.sessionId);
                } catch (e) {
                    logger.error("Instance", "Group sync failed:", e);
                }

                bindAutoReply(this.socket as WASocket, this.sessionId);
                bindPpGuard(this.socket as WASocket, this.sessionId);

                await prisma.session.update({
                    where: { sessionId: this.sessionId },
                    data: { status: "CONNECTED", qr: null }
                });

                logger.success("Instance", `Session ${this.sessionId} connected and synced successfully`);
            }
        } catch (error: any) {
            if (error.code === 'P2025') {
                logger.warn("Instance", `Session ${this.sessionId} record not found during update. Stopping.`);
                this.socket?.end(undefined);
                this.socket = null;
            } else {
                logger.error("Instance", "Error in handleConnectionUpdate:", error);
            }
        }
    }

    async requestPairingCode(phoneNumber: string) {
        if (!this.socket) {
            throw new Error("Socket not initialized");
        }

        try {
            const cleanNumber = phoneNumber.replace(/[^0-9]/g, '');
            if (!cleanNumber) throw new Error("Invalid phone number");

            const code = await this.socket.requestPairingCode(cleanNumber);
            this.pairingCode = code;
            this.status = "SCAN_QR";

            this.io?.to(this.sessionId).emit("connection.update", {
                status: this.status,
                qr: this.qr,
                pairingCode: code
            });

            return code;
        } catch (error) {
            logger.error("Instance", "Pairing code error:", error);
            throw error;
        }
    }

    /** Clean shutdown without triggering reconnect */
    async shutdown() {
        this.isStopped = true;
        this.socket?.end(undefined);
        this.socket = null;
        this.reconnectCount = 0;
    }

    /** On-demand sync all contacts from WhatsApp socket & message history to MySQL database */
    async syncAllContactsToDb() {
        const { backfillContactIdentities, contactIdentityFields, repairOutgoingNameContamination } = await import("@/lib/contact-identity");
        const session = await prisma.session.findUnique({
            where: { sessionId: this.sessionId },
            select: { id: true }
        });
        if (!session) {
            throw new Error("Session not found in database");
        }
        const dbSessionId = session.id;

        // 1. Query distinct remoteJids from message history
        const distinctRemoteJids = await prisma.message.groupBy({
            by: ['remoteJid'],
            where: { sessionId: dbSessionId }
        });

        for (const item of distinctRemoteJids) {
            if (!item.remoteJid || item.remoteJid.includes('@g.us') || item.remoteJid === 'status@broadcast') continue;
            try {
                const identity = contactIdentityFields(item.remoteJid);
                await prisma.contact.upsert({
                    where: { sessionId_jid: { sessionId: dbSessionId, jid: item.remoteJid } },
                    create: {
                        sessionId: dbSessionId,
                        jid: item.remoteJid,
                        lid: identity.lid || undefined,
                        remoteJidAlt: identity.phoneJid || undefined
                    },
                    update: {
                        lid: identity.lid || undefined,
                        remoteJidAlt: identity.phoneJid || undefined
                    }
                });
            } catch (e) {}
        }

        // 2. Fetch profile pictures if socket is active
        if (this.socket) {
            const contacts = await prisma.contact.findMany({
                where: { sessionId: dbSessionId }
            });

            for (const c of contacts) {
                if (!c.profilePic) {
                    try {
                        const ppUrl = await this.socket.profilePictureUrl(c.jid, "image").catch(() => null);
                        if (ppUrl) {
                            await prisma.contact.update({
                                where: { id: c.id },
                                data: { profilePic: ppUrl }
                            });
                        }
                    } catch (e) {}
                }
            }
        }

        // Baileys keeps authoritative LID -> phone mappings in the connected
        // session's Signal repository. Use those mappings for historical rows
        // that predate remoteJidAlt persistence.
        if (this.socket) {
            const lidMapping = (this.socket as any).signalRepository?.lidMapping;
            if (lidMapping?.getPNForLID) {
                const unresolvedLids = await prisma.contact.findMany({
                    where: {
                        sessionId: dbSessionId,
                        jid: { endsWith: "@lid" },
                        OR: [
                            { remoteJidAlt: null },
                            { remoteJidAlt: { endsWith: "@lid" } }
                        ]
                    },
                    select: { id: true, jid: true }
                });

                for (const contact of unresolvedLids) {
                    try {
                        const phoneJid = await lidMapping.getPNForLID(contact.jid);
                        if (phoneJid?.endsWith("@s.whatsapp.net")) {
                            await prisma.contact.update({
                                where: { id: contact.id },
                                data: { lid: contact.jid, remoteJidAlt: phoneJid }
                            });
                        }
                    } catch (error) {
                        logger.debug("Instance", `No phone mapping available for ${contact.jid}`);
                    }
                }
            }
        }

        const identitySummary = await backfillContactIdentities(dbSessionId);
        const repairedNames = await repairOutgoingNameContamination(dbSessionId);
        const total = identitySummary.total;

        logger.success("Instance", `Synced ${total} contacts for session ${this.sessionId}; ${identitySummary.resolved} phone identities resolved, ${repairedNames} names repaired`);
        return identitySummary;
    }
}


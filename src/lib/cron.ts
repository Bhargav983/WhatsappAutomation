import cron from "node-cron";
import cronParser from "cron-parser";
import { prisma } from "@/lib/prisma";
import { waManager } from "@/modules/whatsapp/manager";
import { logger } from "./logger";

export async function resolveRecipientJid(sessionDbId: string, rawJid: string) {
    if (rawJid.endsWith("@g.us") || rawJid.endsWith("@newsletter")) return rawJid;

    const digits = rawJid.split("@")[0].replace(/\D/g, "");
    const lidJid = rawJid.endsWith("@lid") ? rawJid : `${digits}@lid`;
    const contact = await prisma.contact.findFirst({
        where: {
            sessionId: sessionDbId,
            OR: [{ jid: lidJid }, { lid: lidJid }],
            remoteJidAlt: { endsWith: "@s.whatsapp.net" }
        },
        select: { remoteJidAlt: true }
    });

    if (contact?.remoteJidAlt) return contact.remoteJidAlt;
    return rawJid.includes("@") ? rawJid : `${digits}@s.whatsapp.net`;
}

export async function confirmRecipientExists(socket: any, jid: string) {
    if (!jid.endsWith("@s.whatsapp.net")) return jid;
    const result = await socket.onWhatsApp(jid);
    const match = Array.isArray(result) ? result.find(item => item?.exists) : null;
    if (!match?.jid) throw new Error(`Recipient ${jid.split("@")[0]} is not registered on WhatsApp`);
    return match.jid as string;
}

async function waitForOutgoingMessage(sessionDbId: string, keyId: string) {
    for (let attempt = 0; attempt < 20; attempt++) {
        const stored = await prisma.message.findUnique({
            where: { sessionId_keyId: { sessionId: sessionDbId, keyId } },
            select: { id: true }
        });
        if (stored) return true;
        await new Promise(resolve => setTimeout(resolve, 250));
    }
    return false;
}

export function initScheduler() {
    // Run every minute
    cron.schedule("* * * * *", async () => {
        try {
            const now = new Date();
            
            // Fetch pending messages due for sending
            const pendingMessages = await prisma.scheduledmessage.findMany({
                where: {
                    status: "PENDING",
                    sendAt: {
                        lte: now
                    }
                },
                include: {
                    session: true
                }
            });

            if (pendingMessages.length === 0) return;

            // Only log if we're actually processing things to reduce noise
            logger.info("Cron", `Found ${pendingMessages.length} messages to send`);

            for (const msg of pendingMessages) {
                const instance = waManager.getInstance(msg.session.sessionId);

                if (!instance || !instance.socket) {
                    logger.warn("Cron", `Session ${msg.session.sessionId} not connected. Skipping.`);
                    // Optionally mark as FAILED or retry later
                    // keeping PENDING will define behavior (retry next minute)
                    // But if session is dead for long time, it piles up.
                    // Let's keep it PENDING for now.
                    continue;
                }

                try {
                    const claimed = await prisma.scheduledmessage.updateMany({
                        where: { id: msg.id, status: "PENDING" },
                        data: { status: "PROCESSING" }
                    });
                    if (claimed.count === 0) continue;

                    const group = msg.jid.endsWith("@g.us")
                        ? await prisma.group.findUnique({
                            where: { sessionId_jid: { sessionId: msg.sessionId, jid: msg.jid } },
                            select: { subject: true }
                        })
                        : null;
                    const run = await prisma.scheduledmessagerun.create({
                        data: {
                            sessionId: msg.sessionId,
                            scheduleId: msg.id,
                            jid: msg.jid,
                            recipientName: group?.subject || null,
                            content: msg.content,
                            mediaUrl: msg.mediaUrl,
                            mediaType: msg.mediaType,
                            plannedAt: msg.sendAt,
                            status: "PROCESSING"
                        }
                    });

                    let keyId: string | undefined;
                    let confirmed = false;
                    try {

                    const resolvedJid = await resolveRecipientJid(msg.sessionId, msg.jid);
                    const recipientJid = await confirmRecipientExists(instance.socket, resolvedJid);
                    logger.info("Cron", `Sending to ${recipientJid}`);
                    let sentMessage: any;
                    
                    if (msg.mediaUrl) {
                        const type = msg.mediaType || "document";
                        let payload: any = {};
                        if (msg.content) payload.caption = msg.content;
                        
                        if (type === "image") {
                            payload.image = { url: msg.mediaUrl };
                        } else if (type === "video") {
                            payload.video = { url: msg.mediaUrl };
                        } else if (type === "audio") {
                            payload = { audio: { url: msg.mediaUrl } };
                        } else {
                            payload.document = { url: msg.mediaUrl };
                            payload.mimetype = "application/octet-stream";
                            payload.fileName = msg.mediaUrl.split('/').pop() || "file";
                        }
                        sentMessage = await instance.socket.sendMessage(recipientJid, payload);
                    } else {
                        sentMessage = await instance.socket.sendMessage(recipientJid, { text: msg.content || "" });
                    }

                    keyId = sentMessage?.key?.id;
                    if (!keyId) throw new Error("WhatsApp did not return a message ID");
                    const stored = await waitForOutgoingMessage(msg.sessionId, keyId);
                    if (!stored) throw new Error("WhatsApp accepted the request but no outgoing message record was confirmed");
                    confirmed = true;
                    await prisma.scheduledmessagerun.update({
                        where: { id: run.id },
                        data: { status: "SENT", jid: recipientJid, messageKeyId: keyId, processedAt: new Date() }
                    });

                    // Update status or compute next sendAt if recurring
                    if (msg.cronExpression) {
                        const interval = cronParser.parse(msg.cronExpression, { tz: "Asia/Jakarta" });
                        const nextDate = interval.next().toDate();
                        await prisma.scheduledmessage.update({
                            where: { id: msg.id },
                            data: { sendAt: nextDate, status: "PENDING", jid: recipientJid }
                        });
                    } else {
                        await prisma.scheduledmessage.update({
                            where: { id: msg.id },
                            data: { status: "SENT", jid: recipientJid }
                        });
                    }

                    } catch (error) {
                        await prisma.scheduledmessagerun.update({
                            where: { id: run.id },
                            data: {
                                status: confirmed ? "SENT" : keyId ? "UNCONFIRMED" : "FAILED",
                                messageKeyId: keyId || null,
                                error: error instanceof Error ? error.message : String(error),
                                processedAt: new Date()
                            }
                        });
                        throw error;
                    }

                } catch (error) {
                    logger.error("Cron", `Check failed for ${msg.id}`, error);
                    if (!msg.cronExpression) {
                        await prisma.scheduledmessage.update({
                            where: { id: msg.id },
                            data: { status: "FAILED" } // Failed to send
                        });
                    } else {
                        const interval = cronParser.parse(msg.cronExpression, { tz: "Asia/Jakarta" });
                        await prisma.scheduledmessage.update({
                            where: { id: msg.id },
                            data: { sendAt: interval.next().toDate(), status: "PENDING" }
                        });
                    }
                }
            }

        } catch (error) {
            logger.error("Cron", "Scheduler error:", error);
        }
    });
    
    logger.info("Cron", "Scheduler initialized");
}

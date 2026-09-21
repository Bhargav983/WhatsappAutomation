import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { canAccessSession, getAuthenticatedUser } from "@/lib/api-auth";

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ sessionId: string }> }
) {
    const user = await getAuthenticatedUser(request);
    if (!user) return NextResponse.json({ status: false, message: "Unauthorized" }, { status: 401 });

    const { sessionId } = await params;
    const canAccess = await canAccessSession(user.id, user.role, sessionId);
    if (!canAccess) return NextResponse.json({ status: false, message: "Forbidden" }, { status: 403 });

    const session = await prisma.session.findUnique({
        where: { sessionId },
        include: { aichatconfig: true }
    });

    if (!session) return NextResponse.json({ status: false, message: "Session not found" }, { status: 404 });

    let allowedJids: string[] = [];
    if (session.aichatconfig?.allowedJids) {
        try {
            const parsed = JSON.parse(session.aichatconfig.allowedJids);
            if (Array.isArray(parsed)) {
                allowedJids = parsed;
            }
        } catch {
            if (typeof session.aichatconfig.allowedJids === "string") {
                allowedJids = session.aichatconfig.allowedJids.split(",").map(j => j.trim()).filter(Boolean);
            }
        }
    }

    const contacts = allowedJids.length > 0
        ? await prisma.contact.findMany({
            where: {
                sessionId: session.id,
                OR: [
                    { jid: { in: allowedJids } },
                    { remoteJidAlt: { in: allowedJids } },
                    { lid: { in: allowedJids } }
                ]
            },
            select: { jid: true, remoteJidAlt: true, lid: true, name: true, notify: true, profilePic: true }
        })
        : [];

    const contactMap = new Map<string, any>();
    for (const c of contacts) {
        if (c.jid) contactMap.set(c.jid, c);
        if (c.remoteJidAlt) contactMap.set(c.remoteJidAlt, c);
        if (c.lid) contactMap.set(c.lid, c);
    }

    const allowedContacts = allowedJids.map(jid => {
        const c = contactMap.get(jid);
        const digits = jid.split("@")[0].replace(/\D/g, "");
        return {
            jid,
            name: c?.name || null,
            notify: c?.notify || null,
            profilePic: c?.profilePic || null,
            phone: digits ? `+${digits}` : jid
        };
    });

    // Fetch contact relationships for these jids
    const relationships = await prisma.contactrelationship.findMany({
        where: {
            sessionId: session.id,
            jid: { in: allowedJids }
        }
    });

    const relMap = new Map<string, any>();
    for (const r of relationships) {
        relMap.set(r.jid, r);
    }

    const allowedContactsWithRelations = allowedContacts.map(ac => {
        const r = relMap.get(ac.jid);
        return {
            ...ac,
            category: r?.category || null,
            relationship: r?.relationship || null,
            addressAs: r?.addressAs || null,
            tone: r?.tone || null
        };
    });

    const configData = session.aichatconfig
        ? {
            ...session.aichatconfig,
            allowedJids
        }
        : {
            enabled: false,
            audienceMode: "SPECIFIC",
            allowedJids: [],
            businessPrompt: "",
            handoffMessage: ""
        };

    return NextResponse.json({
        status: true,
        data: configData,
        allowedContacts: allowedContactsWithRelations,
        runtime: {
            hasBaseUrl: !!process.env.AI_CHAT_BASE_URL,
            hasApiKey: !!process.env.AI_CHAT_API_KEY,
            model: process.env.AI_CHAT_MODEL || "qwen2.5-coder:3b"
        }
    });
}

export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ sessionId: string }> }
) {
    const user = await getAuthenticatedUser(request);
    if (!user) return NextResponse.json({ status: false, message: "Unauthorized" }, { status: 401 });

    const { sessionId } = await params;
    const canAccess = await canAccessSession(user.id, user.role, sessionId);
    if (!canAccess) return NextResponse.json({ status: false, message: "Forbidden" }, { status: 403 });

    const session = await prisma.session.findUnique({
        where: { sessionId },
        select: { id: true }
    });

    if (!session) return NextResponse.json({ status: false, message: "Session not found" }, { status: 404 });

    const body = await request.json();
    const audienceMode = body.audienceMode === "ALL_PRIVATE" ? "ALL_PRIVATE" : "SPECIFIC";
    const allowedJids = Array.isArray(body.allowedJids)
        ? body.allowedJids
            .filter((jid: unknown) => typeof jid === "string" && (jid as string).trim())
            .map((jid: string) => {
                const t = jid.trim();
                return t.includes("@") ? t : `${t.replace(/\D/g, "")}@s.whatsapp.net`;
            })
        : [];

    const config = await prisma.aichatconfig.upsert({
        where: { sessionId: session.id },
        create: {
            id: session.id,
            sessionId: session.id,
            enabled: !!body.enabled,
            audienceMode,
            allowedJids: JSON.stringify(allowedJids),
            businessPrompt: body.businessPrompt || null,
            handoffMessage: body.handoffMessage || null,
            updatedAt: new Date()
        },
        update: {
            enabled: !!body.enabled,
            audienceMode,
            allowedJids: JSON.stringify(allowedJids),
            businessPrompt: body.businessPrompt || null,
            handoffMessage: body.handoffMessage || null,
            updatedAt: new Date()
        }
    });

    // If autoInitConversations is true, ensure aiconversation exists for all allowed contacts
    if (body.autoInitConversations && allowedJids.length > 0) {
        for (const jid of allowedJids) {
            await prisma.aiconversation.upsert({
                where: { sessionId_remoteJid: { sessionId: session.id, remoteJid: jid } },
                create: {
                    id: `${session.id}_${jid}`, // Explicit primary key ID
                    sessionId: session.id,
                    remoteJid: jid,
                    status: "ACTIVE",
                    updatedAt: new Date()
                },
                update: {
                    updatedAt: new Date()
                }
            }).catch(() => {});
        }
    }

    const responseConfigData = {
        ...config,
        allowedJids
    };

    return NextResponse.json({ status: true, message: "AI chat config saved", data: responseConfigData });
}

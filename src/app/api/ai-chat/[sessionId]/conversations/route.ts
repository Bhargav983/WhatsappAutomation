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
        select: { id: true }
    });

    if (!session) return NextResponse.json({ status: false, message: "Session not found" }, { status: 404 });

    const conversations = await prisma.aiconversation.findMany({
        where: { sessionId: session.id },
        orderBy: { updatedAt: "desc" },
        take: 100
    });

    const jids = conversations.map(conversation => conversation.remoteJid);
    const contacts = jids.length > 0
        ? await prisma.contact.findMany({
            where: {
                sessionId: session.id,
                OR: [
                    { jid: { in: jids } },
                    { remoteJidAlt: { in: jids } },
                    { lid: { in: jids } }
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

    return NextResponse.json({
        status: true,
        data: conversations.map(conversation => ({
            ...conversation,
            contact: contactMap.get(conversation.remoteJid) || null
        }))
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
    let remoteJid = (body.remoteJid || "").trim();
    if (!remoteJid) return NextResponse.json({ status: false, message: "remoteJid is required" }, { status: 400 });

    if (!remoteJid.includes("@")) {
        remoteJid = `${remoteJid.replace(/\D/g, "")}@s.whatsapp.net`;
    }

    const conversation = await prisma.aiconversation.upsert({
        where: { sessionId_remoteJid: { sessionId: session.id, remoteJid } },
        create: {
            id: `${session.id}_${remoteJid}`,
            sessionId: session.id,
            remoteJid,
            status: body.status || "ACTIVE",
            updatedAt: new Date()
        },
        update: {
            status: body.status || "ACTIVE",
            updatedAt: new Date()
        }
    });

    return NextResponse.json({ status: true, message: "Conversation initialized", data: conversation });
}

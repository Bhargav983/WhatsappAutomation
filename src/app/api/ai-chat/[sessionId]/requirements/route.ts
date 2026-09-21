import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { canAccessSession, getAuthenticatedUser } from "@/lib/api-auth";

function normalizeRequirementText(text: string) {
    return text.toLowerCase().replace(/[“”"'`]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
}

function requirementsSimilar(a: string, b: string) {
    const left = normalizeRequirementText(a);
    const right = normalizeRequirementText(b);
    if (!left || !right) return false;
    return left === right || left.includes(right) || right.includes(left);
}

function titleFromDescription(description: string) {
    const firstLine = description.split("\n").find(line => line.trim())?.replace(/^[-•]\s*/, "").trim() || "Requirement";
    return firstLine.length > 80 ? `${firstLine.slice(0, 77)}...` : firstLine;
}

async function backfillRequirements(sessionDbId: string) {
    const conversations = await prisma.aiconversation.findMany({
        where: { sessionId: sessionDbId, requirementDetails: { not: null } }
    });

    for (const conversation of conversations) {
        const description = conversation.requirementDetails?.trim();
        if (!description) continue;
        const existing = await prisma.airequirement.findMany({
            where: { sessionId: sessionDbId, remoteJid: conversation.remoteJid },
            select: { id: true, description: true }
        });
        if (existing.some(item => requirementsSimilar(item.description, description))) continue;
        await prisma.airequirement.create({
            data: {
                id: `req_${sessionDbId}_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
                sessionId: sessionDbId,
                conversationId: conversation.id,
                remoteJid: conversation.remoteJid,
                title: titleFromDescription(description),
                description,
                status: "NEW",
                updatedAt: new Date()
            }
        });
    }
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ sessionId: string }> }) {
    const user = await getAuthenticatedUser(request);
    if (!user) return NextResponse.json({ status: false, message: "Unauthorized" }, { status: 401 });
    const { sessionId } = await params;
    const canAccess = await canAccessSession(user.id, user.role, sessionId);
    if (!canAccess) return NextResponse.json({ status: false, message: "Forbidden" }, { status: 403 });
    const session = await prisma.session.findUnique({ where: { sessionId }, select: { id: true } });
    if (!session) return NextResponse.json({ status: false, message: "Session not found" }, { status: 404 });

    await backfillRequirements(session.id);

    const requirements = await prisma.airequirement.findMany({ where: { sessionId: session.id }, orderBy: { updatedAt: "desc" }, take: 200 });
    const jids = [...new Set(requirements.map(req => req.remoteJid))];
    const contacts = jids.length > 0 ? await prisma.contact.findMany({
        where: { sessionId: session.id, OR: [{ jid: { in: jids } }, { remoteJidAlt: { in: jids } }, { lid: { in: jids } }] },
        select: { jid: true, remoteJidAlt: true, lid: true, name: true, notify: true, profilePic: true }
    }) : [];
    const contactMap = new Map<string, any>();
    for (const c of contacts) {
        if (c.jid) contactMap.set(c.jid, c);
        if (c.remoteJidAlt) contactMap.set(c.remoteJidAlt, c);
        if (c.lid) contactMap.set(c.lid, c);
    }
    return NextResponse.json({ status: true, data: requirements.map(requirement => ({ ...requirement, contact: contactMap.get(requirement.remoteJid) || null })) });
}

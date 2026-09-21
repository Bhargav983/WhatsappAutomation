import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedUser, canAccessSession } from "@/lib/api-auth";

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ sessionId: string }> }
) {
    try {
        const user = await getAuthenticatedUser(request);
        if (!user) {
            return NextResponse.json({ status: false, message: "Unauthorized", error: "Unauthorized" }, { status: 401 });
        }

        const { sessionId } = await params;
        const { searchParams } = new URL(request.url);
        const search = (searchParams.get("search") || "").trim().toLowerCase();
        const limit = Math.min(parseInt(searchParams.get("limit") || "10", 10) || 10, 30);

        const canAccess = await canAccessSession(user.id, user.role, sessionId);
        if (!canAccess) {
            return NextResponse.json({ status: false, message: "Forbidden - Cannot access this session", error: "Forbidden - Cannot access this session" }, { status: 403 });
        }

        const session = await prisma.session.findUnique({
            where: { sessionId },
            select: { id: true }
        });

        if (!session) {
            return NextResponse.json({ status: false, message: "Session not found", error: "Session not found" }, { status: 404 });
        }

        const [contacts, messageJids] = await Promise.all([
            prisma.contact.findMany({
                where: {
                    sessionId: session.id,
                    jid: { contains: "@newsletter" },
                    ...(search ? {
                        OR: [
                            { name: { contains: search } },
                            { notify: { contains: search } },
                            { verifiedName: { contains: search } },
                            { jid: { contains: search } }
                        ]
                    } : {})
                },
                select: { jid: true, name: true, notify: true, verifiedName: true },
                take: limit,
                orderBy: { name: "asc" }
            }),
            prisma.message.findMany({
                where: {
                    sessionId: session.id,
                    AND: [
                        { remoteJid: { contains: "@newsletter" } },
                        ...(search ? [{ remoteJid: { contains: search } }] : [])
                    ]
                },
                select: { remoteJid: true },
                distinct: ["remoteJid"],
                take: limit
            })
        ]);

        const byJid = new Map<string, { jid: string; name: string | null; notify: string | null; verifiedName: string | null }>();
        for (const contact of contacts) byJid.set(contact.jid, contact);
        for (const message of messageJids) {
            if (!byJid.has(message.remoteJid)) {
                byJid.set(message.remoteJid, { jid: message.remoteJid, name: null, notify: null, verifiedName: null });
            }
        }

        const data = Array.from(byJid.values()).slice(0, limit).map(item => ({
            jid: item.jid,
            name: item.name || item.notify || item.verifiedName || item.jid.split("@")[0]
        }));

        return NextResponse.json({ status: true, message: "Newsletters retrieved successfully", data });
    } catch (error) {
        console.error("Get newsletters error:", error);
        return NextResponse.json({ status: false, message: "Failed to fetch newsletters", error: "Failed to fetch newsletters" }, { status: 500 });
    }
}

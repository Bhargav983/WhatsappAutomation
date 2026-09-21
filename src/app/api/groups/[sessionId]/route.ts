import { prisma } from "@/lib/prisma";
import { NextResponse, NextRequest } from "next/server";
import { getAuthenticatedUser, canAccessSession } from "@/lib/api-auth";
import { waManager } from "@/modules/whatsapp/manager";
import { syncGroups } from "@/modules/whatsapp/store/groups";

// GET: List groups for a session
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

        // Verify access
        const canAccess = await canAccessSession(user.id, user.role, sessionId);
        if (!canAccess) {
            return NextResponse.json({ status: false, message: "Forbidden - Cannot access this session", error: "Forbidden - Cannot access this session" }, { status: 403 });
        }

        // Get internal ID
        const session = await prisma.session.findUnique({
            where: { sessionId: sessionId },
            select: { id: true }
        });

        if (!session) {
            return NextResponse.json({ status: false, message: "Session not found", error: "Session not found" }, { status: 404 });
        }

        let groups = await prisma.group.findMany({
            where: { sessionId: session.id },
            orderBy: { subject: 'asc' }
        });

        const forceRefresh = request.nextUrl.searchParams.get("refresh") === "1";
        const hadStoredGroups = groups.length > 0;
        let syncWarning: string | null = null;

        // Keep the picker usable while the WhatsApp socket is still reconnecting.
        // Message history gives us confirmed group JIDs; live sync below replaces
        // the fallback labels with current group metadata and names.
        if (groups.length === 0) {
            const knownGroupMessages = await prisma.message.findMany({
                where: { sessionId: session.id, remoteJid: { endsWith: "@g.us" } },
                select: { remoteJid: true },
                distinct: ["remoteJid"],
                orderBy: { timestamp: "desc" },
                take: 200
            });

            if (knownGroupMessages.length > 0) {
                await prisma.group.createMany({
                    data: knownGroupMessages.map(item => ({ sessionId: session.id, jid: item.remoteJid })),
                    skipDuplicates: true
                });
                groups = await prisma.group.findMany({
                    where: { sessionId: session.id },
                    orderBy: { subject: 'asc' }
                });
            }
        }

        // If DB has no groups (or the user explicitly refreshes), sync from the
        // live socket and return an actionable error instead of a silent empty list.
        if (!hadStoredGroups || forceRefresh) {
            const instance = waManager.getInstance(sessionId);
            if (instance?.socket) {
                try {
                    await syncGroups(instance.socket, sessionId);
                    groups = await prisma.group.findMany({
                        where: { sessionId: session.id },
                        orderBy: { subject: 'asc' }
                    });
                } catch (e) {
                    console.error("Live group sync error:", e);
                    if (groups.length === 0) {
                        return NextResponse.json({ status: false, message: "Could not synchronize groups from WhatsApp. Please try again." }, { status: 502 });
                    }
                    syncWarning = "Showing groups from message history. Refresh after the WhatsApp session finishes connecting to load group names.";
                }
            } else if (groups.length === 0) {
                return NextResponse.json({ status: false, message: "WhatsApp session is not available. Start the session and try again." }, { status: 503 });
            } else if (!instance?.socket) {
                syncWarning = "Showing groups from message history. Refresh after the WhatsApp session finishes connecting to load group names.";
            }
        }

        return NextResponse.json({
            status: true,
            message: "Groups retrieved successfully",
            data: groups,
            source: groups.some(group => !group.subject) ? "history" : "live",
            warning: syncWarning
        });
    } catch (error) {
        console.error("Get groups error:", error);
        return NextResponse.json({ status: false, message: "Failed to fetch groups", error: "Failed to fetch groups" }, { status: 500 });
    }
}

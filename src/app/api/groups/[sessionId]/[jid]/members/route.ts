import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { waManager } from "@/modules/whatsapp/manager";
import { getAuthenticatedUser, canAccessSession } from "@/lib/api-auth";


// GET: List group members for mention pickers
export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ sessionId: string; jid: string }> }
) {
    try {
        const user = await getAuthenticatedUser(request);
        if (!user) {
            return NextResponse.json({ status: false, message: "Unauthorized", error: "Unauthorized" }, { status: 401 });
        }

        const { sessionId, jid } = await params;
        const decodedJid = decodeURIComponent(jid);

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

        let participants: any[] = [];
        const group = await prisma.group.findUnique({
            where: { sessionId_jid: { sessionId: session.id, jid: decodedJid } },
            select: { participants: true }
        });

        if (Array.isArray(group?.participants)) {
            participants = group.participants as any[];
        }

        if (!participants.length) {
            const instance = waManager.getInstance(sessionId);
            if (instance?.socket) {
                try {
                    const metadata = await instance.socket.groupMetadata(decodedJid);
                    participants = metadata.participants as any[];
                    await prisma.group.update({
                        where: { sessionId_jid: { sessionId: session.id, jid: decodedJid } },
                        data: { participants: metadata.participants as any, metadata: metadata as any }
                    }).catch(() => undefined);
                } catch {
                    // Keep empty result; caller will show a helpful message.
                }
            }
        }

        const participantRows = participants
            .map((participant: any) => {
                const id = typeof participant?.id === "string" ? participant.id : "";
                const phoneNumber = typeof participant?.phoneNumber === "string" ? participant.phoneNumber : "";
                const jid = phoneNumber.endsWith("@s.whatsapp.net")
                    ? phoneNumber
                    : id.endsWith("@s.whatsapp.net") ? id : "";
                return { participant, id, jid };
            })
            .filter((row: { jid: string }) => Boolean(row.jid));

        const participantJids = [...new Set(participantRows.map((row: { jid: string }) => row.jid))];

        const contacts = participantJids.length ? await prisma.contact.findMany({
            where: {
                sessionId: session.id,
                OR: [
                    { jid: { in: participantJids } },
                    { remoteJidAlt: { in: participantJids } }
                ]
            },
            select: { jid: true, remoteJidAlt: true, name: true, notify: true, verifiedName: true }
        }) : [];

        const contactByJid = new Map<string, typeof contacts[number]>();
        for (const contact of contacts) {
            contactByJid.set(contact.jid, contact);
            if (contact.remoteJidAlt) contactByJid.set(contact.remoteJidAlt, contact);
        }
        const data = participantRows.map(({ participant, jid }: { participant: any; jid: string }) => {
            const contact = contactByJid.get(jid);
            const phone = jid.split("@")[0];
            return {
                jid,
                phone,
                name: contact?.name || contact?.notify || contact?.verifiedName || phone,
                admin: participant.admin || null
            };
        });

        return NextResponse.json({ status: true, message: "Group members retrieved successfully", data });
    } catch (error) {
        console.error("Get group members error:", error);
        return NextResponse.json({ status: false, message: "Failed to fetch group members", error: "Failed to fetch group members" }, { status: 500 });
    }
}

// PUT: Update group members (add, remove, promote, demote)
export async function PUT(
    request: NextRequest,
    { params }: { params: Promise<{ sessionId: string; jid: string }> }
) {
    try {
        const user = await getAuthenticatedUser(request);
        if (!user) {
            return NextResponse.json({ status: false, message: "Unauthorized", error: "Unauthorized" }, { status: 401 });
        }
        
        const { sessionId, jid } = await params;
        const decodedJid = decodeURIComponent(jid);
        const body = await request.json();
        const { action, participants } = body;

        if (!action || !participants || !Array.isArray(participants)) {
            return NextResponse.json({ status: false, message: "action and participants (array) are required", error: "action and participants (array) are required" }, { status: 400 });
        }

        const validActions = ['add', 'remove', 'promote', 'demote'];
        if (!validActions.includes(action)) {
            return NextResponse.json({ 
                error: `Invalid action. Must be one of: ${validActions.join(', ')}` 
            }, { status: 400 });
        }

        if (participants.length === 0) {
            return NextResponse.json({ status: false, message: "Participants array cannot be empty", error: "Participants array cannot be empty" }, { status: 400 });
        }

        // Check if user can access this session
        const canAccess = await canAccessSession(user.id, user.role, sessionId);
        if (!canAccess) {
            return NextResponse.json({ status: false, message: "Forbidden - Cannot access this session", error: "Forbidden - Cannot access this session" }, { status: 403 });
        }

        const instance = waManager.getInstance(sessionId);
        if (!instance?.socket) {
            return NextResponse.json({ status: false, message: "Session not ready", error: "Session not ready" }, { status: 503 });
        }

        // Execute the action
        const result = await instance.socket.groupParticipantsUpdate(
            decodedJid,
            participants,
            action as any
        );

        return NextResponse.json({ 
            success: true,
            message: `Successfully ${action}ed participants`,
            result
        });

    } catch (error: any) {
        console.error("Update group members error:", error);
        
        if (error.message?.includes("not-admin") || error.message?.includes("forbidden")) {
            return NextResponse.json({ status: false, message: "Bot must be admin to update group members", error: "Bot must be admin to update group members" }, { status: 403 });
        }
        
        if (error.message?.includes("not-authorized")) {
            return NextResponse.json({ status: false, message: "Not authorized to perform this action", error: "Not authorized to perform this action" }, { status: 403 });
        }
        
        return NextResponse.json({ status: false, message: "Failed to update group members", error: "Failed to update group members" }, { status: 500 });
    }
}

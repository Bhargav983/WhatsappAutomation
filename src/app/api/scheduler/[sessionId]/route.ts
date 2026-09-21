import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedUser, canAccessSession } from "@/lib/api-auth";
import moment from "moment-timezone";

// GET: List Scheduled Messages
export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ sessionId: string }> }
) {
    try {
        const { sessionId } = await params;

        const user = await getAuthenticatedUser(request);
        if (!user) {
            return NextResponse.json({ status: false, message: "Unauthorized", error: "Unauthorized" }, { status: 401 });
        }

        const canAccess = await canAccessSession(user.id, user.role, sessionId);
        if (!canAccess) {
            return NextResponse.json({ status: false, message: "Forbidden - Cannot access this session", error: "Forbidden - Cannot access this session" }, { status: 403 });
        }

        const session = await prisma.session.findUnique({
            where: { sessionId: sessionId },
            select: { id: true }
        });

        if (!session) {
            return NextResponse.json({ status: false, message: "Session not found", error: "Session not found" }, { status: 404 });
        }

        const url = new URL(request.url);
        const tab = url.searchParams.get("tab") || "pending";
        const groups = await prisma.group.findMany({
            where: { sessionId: session.id },
            select: { jid: true, subject: true }
        });
        const groupNames = new Map(groups.map(group => [group.jid, group.subject]));

        if (tab === "history") {
            const [runs, legacy] = await Promise.all([
                prisma.scheduledmessagerun.findMany({
                    where: { sessionId: session.id, status: { not: "PROCESSING" } },
                    orderBy: { processedAt: "desc" },
                    take: 200
                }),
                prisma.scheduledmessage.findMany({
                    where: { sessionId: session.id, status: { in: ["SENT", "FAILED"] }, runs: { none: {} } },
                    orderBy: { sendAt: "desc" },
                    take: 200
                })
            ]);
            const data = [
                ...runs.map(run => ({
                    ...run,
                    isRun: true,
                    sendAt: run.plannedAt,
                    recipientName: run.recipientName || groupNames.get(run.jid) || null
                })),
                ...legacy.map(message => ({
                    ...message,
                    isRun: false,
                    processedAt: message.sendAt,
                    recipientName: groupNames.get(message.jid) || null
                }))
            ].sort((a, b) => new Date(b.processedAt).getTime() - new Date(a.processedAt).getTime());
            return NextResponse.json({ status: true, data });
        }

        const whereClause: any = { sessionId: session.id };
        whereClause.status = "PENDING";

        const messages = await prisma.scheduledmessage.findMany({
            where: whereClause,
            include: { runs: { orderBy: { processedAt: "desc" }, take: 1 } },
            orderBy: { sendAt: "asc" }
        });

        // Parse mentions from JSON string back to object for the frontend
        const data = messages.map((m: any) => {
            let mentions = null;
            if (m.mentions) {
                try { mentions = JSON.parse(m.mentions); } catch { mentions = null; }
            }
            return {
                ...m,
                mentions,
                recipientName: groupNames.get(m.jid) || null,
                lastRun: m.runs[0] ? { status: m.runs[0].status, processedAt: m.runs[0].processedAt } : null
            };
        });

        return NextResponse.json({ status: true, message: "Scheduled messages retrieved successfully", data });

    } catch (error) {
        return NextResponse.json({ status: false, message: "Internal Server Error", error: "Internal Server Error" }, { status: 500 });
    }
}

// POST: Create Scheduled Message
export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ sessionId: string }> }
) {
    try {
        const { sessionId } = await params;

        const user = await getAuthenticatedUser(request);
        if (!user) {
            return NextResponse.json({ status: false, message: "Unauthorized", error: "Unauthorized" }, { status: 401 });
        }

        const body = await request.json();
        const { jid, content, sendAt, mediaUrl, mediaType, cronExpression, recurrenceRule } = body;

        if (!jid || (!content && !mediaUrl) || !sendAt) {
            return NextResponse.json({ status: false, message: "Missing required fields (JID, Content/Media, SendAt)", error: "Missing required fields" }, { status: 400 });
        }

        const canAccess = await canAccessSession(user.id, user.role, sessionId);
        if (!canAccess) {
            return NextResponse.json({ status: false, message: "Forbidden - Cannot access this session", error: "Forbidden - Cannot access this session" }, { status: 403 });
        }

        const session = await prisma.session.findUnique({
            where: { sessionId: sessionId },
            select: { id: true }
        });

        if (!session) {
            return NextResponse.json({ status: false, message: "Session not found", error: "Session not found" }, { status: 404 });
        }

        let resolvedJid = jid as string;
        if (!resolvedJid.endsWith("@g.us") && !resolvedJid.endsWith("@newsletter")) {
            const digits = resolvedJid.split("@")[0].replace(/\D/g, "");
            const lidJid = resolvedJid.endsWith("@lid") ? resolvedJid : `${digits}@lid`;
            const linkedContact = await prisma.contact.findFirst({
                where: {
                    sessionId: session.id,
                    OR: [{ jid: lidJid }, { lid: lidJid }],
                    remoteJidAlt: { endsWith: "@s.whatsapp.net" }
                },
                select: { remoteJidAlt: true }
            });
            if (linkedContact?.remoteJidAlt) resolvedJid = linkedContact.remoteJidAlt;
        }

        // Fetch system timezone
        const sysConfig = await prisma.systemconfig.findUnique({ where: { id: "default" } });
        const timezone = sysConfig?.timezone || "Asia/Jakarta";

        console.log(`[Scheduler:POST] Received sendAt: ${sendAt}, using timezone: ${timezone}`);
        const utcDate = moment.tz(sendAt, timezone).toDate();
        console.log(`[Scheduler:POST] Resolved UTC Date: ${utcDate.toISOString()}`);

        // Serialize mentions to JSON string (DB column is String, not Json)
        const mentionsData = body.mentions ? JSON.stringify(body.mentions) : null;

        const scheduled = await prisma.scheduledmessage.create({
            data: {
                sessionId: session.id,
                jid: resolvedJid,
                content,
                mediaUrl,
                mediaType,
                cronExpression,
                recurrenceRule,
                mentions: mentionsData,
                sendAt: utcDate,
                status: "PENDING"
            }
        });

        return NextResponse.json({ status: true, message: "Message scheduled successfully", data: scheduled });

    } catch (error) {
        console.error("Schedule error:", error);
        return NextResponse.json({ status: false, message: "Internal Server Error", error: "Internal Server Error" }, { status: 500 });
    }

}


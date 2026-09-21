import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { canAccessSession, getAuthenticatedUser } from "@/lib/api-auth";
import { waManager } from "@/modules/whatsapp/manager";

const VALID_STATUSES = ["NEW", "IN_PROGRESS", "DONE", "ON_HOLD", "NEEDS_CLARIFICATION"] as const;
type RequirementStatus = typeof VALID_STATUSES[number];

function statusLabel(status: RequirementStatus) {
    const labels: Record<RequirementStatus, string> = {
        NEW: "New",
        IN_PROGRESS: "In Progress",
        DONE: "Done",
        ON_HOLD: "On Hold",
        NEEDS_CLARIFICATION: "Needs Clarification"
    };
    return labels[status];
}

function buildStatusMessage(status: RequirementStatus, description: string) {
    const clean = description.replace(/\s+/g, " ").trim();
    const shortRequirement = clean.length > 120 ? `${clean.slice(0, 117)}...` : clean;
    switch (status) {
        case "NEW": return `Thanks, we have received your requirement and will review it: “${shortRequirement}”.`;
        case "IN_PROGRESS": return `We have started working on your requirement: “${shortRequirement}”.`;
        case "DONE": return `Your requirement has been completed: “${shortRequirement}”. Please check and let us know if anything else is needed.`;
        case "ON_HOLD": return `Your requirement is currently on hold: “${shortRequirement}”. We will update you once work resumes.`;
        case "NEEDS_CLARIFICATION": return `We need a little more detail for your requirement: “${shortRequirement}”. Could you please clarify?`;
        default: return `Your requirement status is now ${statusLabel(status)}: “${shortRequirement}”.`;
    }
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ sessionId: string; requirementId: string }> }) {
    const user = await getAuthenticatedUser(request);
    if (!user) return NextResponse.json({ status: false, message: "Unauthorized" }, { status: 401 });
    const { sessionId, requirementId } = await params;
    const canAccess = await canAccessSession(user.id, user.role, sessionId);
    if (!canAccess) return NextResponse.json({ status: false, message: "Forbidden" }, { status: 403 });
    const session = await prisma.session.findUnique({ where: { sessionId }, select: { id: true } });
    if (!session) return NextResponse.json({ status: false, message: "Session not found" }, { status: 404 });

    const body = await request.json();
    const nextStatus = typeof body.status === "string" ? body.status : undefined;
    if (nextStatus && !VALID_STATUSES.includes(nextStatus as RequirementStatus)) return NextResponse.json({ status: false, message: "Invalid requirement status" }, { status: 400 });

    const existing = await prisma.airequirement.findFirst({ where: { id: requirementId, sessionId: session.id } });
    if (!existing) return NextResponse.json({ status: false, message: "Requirement not found" }, { status: 404 });

    const updateData: any = {};
    if (nextStatus) updateData.status = nextStatus;
    if (typeof body.internalNotes === "string") updateData.internalNotes = body.internalNotes;

    let notificationMessage: string | undefined;
    if (body.notifyContact && nextStatus) {
        const messageToSend = typeof body.message === "string" && body.message.trim() ? body.message.trim() : buildStatusMessage(nextStatus as RequirementStatus, existing.description);
        const instance = waManager.getInstance(sessionId);
        if (!instance?.socket) return NextResponse.json({ status: false, message: "WhatsApp session is not connected. Status was not changed." }, { status: 409 });
        await instance.socket.sendMessage(existing.remoteJid, { text: messageToSend });
        notificationMessage = messageToSend;
        updateData.lastStatusNotifiedAt = new Date();
    }

    const updated = await prisma.airequirement.update({ where: { id: existing.id }, data: updateData });
    const io = (global as any).io;
    if (io) io.to(sessionId).emit("ai.requirement.update", { requirementId: updated.id, status: updated.status });
    return NextResponse.json({ status: true, message: "Requirement updated", data: updated, notificationMessage });
}



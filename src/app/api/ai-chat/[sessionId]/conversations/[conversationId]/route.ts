import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { canAccessSession, getAuthenticatedUser } from "@/lib/api-auth";

export async function PATCH(
    request: NextRequest,
    { params }: { params: Promise<{ sessionId: string; conversationId: string }> }
) {
    const user = await getAuthenticatedUser(request);
    if (!user) return NextResponse.json({ status: false, message: "Unauthorized" }, { status: 401 });

    const { sessionId, conversationId } = await params;
    const canAccess = await canAccessSession(user.id, user.role, sessionId);
    if (!canAccess) return NextResponse.json({ status: false, message: "Forbidden" }, { status: 403 });

    const body = await request.json();
    const allowedStatuses = new Set(["ACTIVE", "COMPLETED", "NEEDS_HUMAN", "MANUAL"]);
    const status = allowedStatuses.has(body.status) ? body.status : undefined;

    if (!status) return NextResponse.json({ status: false, message: "Invalid status" }, { status: 400 });

    const session = await prisma.session.findUnique({
        where: { sessionId },
        select: { id: true }
    });

    if (!session) return NextResponse.json({ status: false, message: "Session not found" }, { status: 404 });

    const conversation = await prisma.aiconversation.updateMany({
        where: { id: conversationId, sessionId: session.id },
        data: { status }
    });

    if (conversation.count === 0) {
        return NextResponse.json({ status: false, message: "Conversation not found" }, { status: 404 });
    }

    return NextResponse.json({ status: true, message: "Conversation updated" });
}

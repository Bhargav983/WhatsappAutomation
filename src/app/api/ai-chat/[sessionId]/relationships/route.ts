import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedUser, canAccessSession } from "@/lib/api-auth";

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
    const { jid, category, relationship, addressAs, tone } = body;

    if (!jid) {
        return NextResponse.json({ status: false, message: "JID is required" }, { status: 400 });
    }

    const rel = await prisma.contactrelationship.upsert({
        where: {
            sessionId_jid: {
                sessionId: session.id,
                jid
            }
        },
        create: {
            sessionId: session.id,
            jid,
            category: category || "FAMILY",
            relationship: relationship || null,
            addressAs: addressAs || null,
            tone: tone || "CASUAL"
        },
        update: {
            category: category || "FAMILY",
            relationship: relationship || null,
            addressAs: addressAs || null,
            tone: tone || "CASUAL"
        }
    });

    return NextResponse.json({ status: true, message: "Relationship metadata updated", data: rel });
}

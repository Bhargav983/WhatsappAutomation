import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser, canAccessSession } from "@/lib/api-auth";
import { waManager } from "@/modules/whatsapp/manager";

export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ sessionId: string }> }
) {
    const user = await getAuthenticatedUser(request);
    if (!user) return NextResponse.json({ status: false, message: "Unauthorized" }, { status: 401 });

    const { sessionId } = await params;
    const canAccess = await canAccessSession(user.id, user.role, sessionId);
    if (!canAccess) return NextResponse.json({ status: false, message: "Forbidden" }, { status: 403 });

    try {
        const summary = await waManager.syncContacts(sessionId);
        return NextResponse.json({
            status: true,
            message: `Synced ${summary.total} contacts · ${summary.resolved} phone numbers resolved · ${summary.unavailable} unavailable`,
            ...summary
        });
    } catch (error) {
        console.error("Sync contacts error:", error);
        return NextResponse.json({ status: false, message: "Failed to sync contacts" }, { status: 500 });
    }
}

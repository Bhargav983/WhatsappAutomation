import { getAccessibleSessions, canAccessSession } from "@/lib/api-auth";

export async function resolveActiveSessionId(
    userId: string,
    userRole: string,
    cookieSessionId?: string
) {
    if (cookieSessionId) {
        const hasAccess = await canAccessSession(userId, userRole, cookieSessionId);
        if (hasAccess) return cookieSessionId;
    }

    const sessions = await getAccessibleSessions(userId, userRole);
    const connectedSession = sessions.find((session) => session.status === "CONNECTED");

    return connectedSession?.sessionId || sessions[0]?.sessionId || null;
}


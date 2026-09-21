import { auth } from "@/lib/auth";
import { ChatInterface } from "@/components/chat/chat-interface";
import { ChatLayoutClient } from "@/components/chat/chat-layout-client";
import { cookies } from "next/headers";
import { SessionGuard } from "@/components/dashboard/session-guard";
import { resolveActiveSessionId } from "@/lib/session-selection";

export default async function ChatPage() {
    const session = await auth();
    console.log("ChatPage Session (Role debug):", session?.user?.role);

    if (!session?.user?.id) return <div>Unauthorized</div>;

    const cookieStore = await cookies();
    const sessionId = cookieStore.get("sessionId")?.value;
    const validSessionId = await resolveActiveSessionId(session.user.id, session.user.role, sessionId);

    if (!validSessionId) {
        return (
            <SessionGuard>
                <ChatInterface sessionId={null} />
            </SessionGuard>
        );
    }

    return (
        <div className="h-[calc(100vh-6.5rem)] sm:h-[calc(100vh-6rem)]">
            <ChatLayoutClient key={validSessionId} sessionId={validSessionId} />
        </div>
    );
}


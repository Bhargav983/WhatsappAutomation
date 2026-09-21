import { auth } from "@/lib/auth";
import { ChatInterface } from "@/components/chat/chat-interface";
import { ChatLayoutClient } from "@/components/chat/chat-layout-client";
import { cookies } from "next/headers";
import { SessionGuard } from "@/components/dashboard/session-guard";
import { resolveActiveSessionId } from "@/lib/session-selection";

export default async function ChatWithJidPage({
    params,
}: {
    params: Promise<{ jid: string }>;
}) {
    const { jid: rawJid } = await params;
    const session = await auth();

    if (!session?.user?.id) return <div>Unauthorized</div>;

    let clean = rawJid.replace(/\D/g, '');
    if (clean.startsWith('0')) clean = '62' + clean.substring(1);
    const resolvedJid = `${clean}@s.whatsapp.net`;

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
            <ChatLayoutClient
                key={`${validSessionId}-${resolvedJid}`}
                sessionId={validSessionId}
                initialJid={resolvedJid}
            />
        </div>
    );
}

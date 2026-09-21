"use client";

import { createContext, useContext, useEffect, useRef, useState, ReactNode } from "react";
import { getCookie, setCookie } from "@/lib/client-cookie";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { WifiOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";

interface Session {
    id: string;
    sessionId: string;
    name: string;
    status: string;
}

interface SessionContextType {
    sessions: Session[];
    sessionId: string;
    setSessionId: (id: string) => void;
    refreshSessions: () => Promise<void>;
    loading: boolean;
}

const SessionContext = createContext<SessionContextType | undefined>(undefined);

export function SessionProvider({ children }: { children: ReactNode }) {
    const [sessions, setSessions] = useState<Session[]>([]);
    const [sessionId, setSessionIdState] = useState<string>("");
    const [loading, setLoading] = useState(true);
    const [showOfflineDialog, setShowOfflineDialog] = useState(false);
    const lastConnectionState = useRef<"online" | "offline" | null>(null);
    const router = useRouter();

    const fetchSessions = async () => {
        try {
            const res = await fetch('/api/sessions');
            if (res.ok) {
                const responseData = await res.json();
                const data = responseData?.data || [];
                const connectedSessions = data.filter((session: Session) => session.status === "CONNECTED");
                setSessions(data);

                const cookieId = getCookie("sessionId");
                const savedConnectedSession = connectedSessions.find((session: Session) => session.sessionId === cookieId);
                const preferredSession = savedConnectedSession || connectedSessions[0];

                if (preferredSession) {
                    setSessionIdState(preferredSession.sessionId);
                    setCookie("sessionId", preferredSession.sessionId);
                    setShowOfflineDialog(false);

                    if (lastConnectionState.current !== "online") {
                        window.setTimeout(() => {
                            toast.success(`${preferredSession.name} is online`, {
                                description: "WhatsApp features are ready to use.",
                            });
                        }, 250);
                    }
                    lastConnectionState.current = "online";
                } else {
                    const savedSession = data.find((session: Session) => session.sessionId === cookieId);
                    const fallbackSession = savedSession || data[0];
                    setSessionIdState(fallbackSession?.sessionId || "");
                    if (fallbackSession) setCookie("sessionId", fallbackSession.sessionId);
                    setShowOfflineDialog(true);
                    lastConnectionState.current = "offline";
                }
            }
        } catch (error) {
            console.error(error);
            toast.error("Failed to fetch sessions");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchSessions();
        // WhatsApp may need a few seconds to reconnect after the local app starts.
        // Recheck once so an initial offline notice can automatically clear.
        const reconnectCheck = window.setTimeout(fetchSessions, 6000);
        return () => window.clearTimeout(reconnectCheck);
    }, []);

    const setSessionId = (id: string) => {
        setSessionIdState(id);
        setCookie("sessionId", id); // Sync Cookie
        router.refresh(); // Sync Server Components
    };

    return (
        <SessionContext.Provider value={{ sessions, sessionId, setSessionId, refreshSessions: fetchSessions, loading }}>
            {children}
            <Dialog open={showOfflineDialog} onOpenChange={setShowOfflineDialog}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader className="items-center text-center sm:items-start sm:text-left">
                        <div className="mb-2 rounded-full bg-amber-100 p-3 text-amber-700">
                            <WifiOff className="h-6 w-6" />
                        </div>
                        <DialogTitle>No WhatsApp session is online</DialogTitle>
                        <DialogDescription>
                            Open Sessions and start or reconnect a session before using messaging and automation features.
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter className="sm:justify-end">
                        <Button
                            type="button"
                            onClick={() => {
                                setShowOfflineDialog(false);
                                router.push("/dashboard/sessions");
                            }}
                        >
                            Go to Sessions
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </SessionContext.Provider>
    );
}

export function useSession() {
    const context = useContext(SessionContext);
    if (!context) {
        throw new Error("useSession must be used within a SessionProvider");
    }
    return context;
}


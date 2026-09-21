import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { waManager } from "@/modules/whatsapp/manager";
import { getAuthenticatedUser, canAccessSession } from "@/lib/api-auth";
import type { AnyMessageContent } from "@whiskeysockets/baileys";
import { z } from "zod";

const broadcastBodySchema = z.object({
    recipients: z.array(z.string()).min(1),
    message: z.string().min(1),
    delay: z.number().optional()
});

export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ sessionId: string }> }
) {
    try {
        const user = await getAuthenticatedUser(request);

        if (!user) {
            return NextResponse.json(
                {
                    status: false,
                    message: "Unauthorized",
                    error: "Unauthorized"
                },
                { status: 401 }
            );
        }

        const { sessionId } = await params;
        const body = await request.json();

        const parseResult = broadcastBodySchema.safeParse(body);

        if (!parseResult.success) {
            return NextResponse.json(
                {
                    status: false,
                    message: "Invalid request",
                    error: parseResult.error.flatten()
                },
                { status: 400 }
            );
        }

        const { recipients, message, delay } = parseResult.data;

        const canAccess = await canAccessSession(
            user.id,
            user.role,
            sessionId
        );

        if (!canAccess) {
            return NextResponse.json(
                {
                    status: false,
                    message: "Forbidden",
                    error: "Forbidden"
                },
                { status: 403 }
            );
        }

        const instance = waManager.getInstance(sessionId);

        if (!instance?.socket) {
            return NextResponse.json(
                {
                    status: false,
                    message: "Session not ready",
                    error: "Session not ready"
                },
                { status: 503 }
            );
        }

        /*
         * Create Broadcast Log
         * and recipient records
         */
        const log = await prisma.broadcastlog.create({
    data: {
        id: crypto.randomUUID(),
        sessionId,
        message,
        total: recipients.length,
        delay: delay || 2000,
        status: "running",

        broadcastrecipient: {
            create: recipients.map((jid) => ({
                id: crypto.randomUUID(),
                jid,
                status: "pending"
            }))
        }
    },

    include: {
        broadcastrecipient: true
    }
});

        const messageContent: AnyMessageContent = {
            text: message
        };

        const io = (global as any).io;
        const broadcastId = log.id;

        /*
         * Emit initial broadcast state
         */
        if (io) {
            io.to(sessionId).emit("broadcast.progress", {
                broadcastId,
                status: "running",
                total: recipients.length,
                sent: 0,
                failed: 0,
                current: null,
                progress: 0,
                startedAt: log.startedAt.toISOString()
            });
        }

        /*
         * Process broadcast in background
         */
        (async () => {
            let sent = 0;
            let failed = 0;

            const errors: {
                jid: string;
                error: string;
            }[] = [];

            for (let i = 0; i < recipients.length; i++) {
                const jid = recipients[i];

                try {
                    /*
                     * Send WhatsApp message
                     */
                    await instance.socket!.sendMessage(
                        jid,
                        messageContent
                    );

                    sent++;

                    /*
                     * Update recipient status
                     */
                    await prisma.broadcastrecipient.updateMany({
                        where: {
                            broadcastLogId: broadcastId,
                            jid
                        },

                        data: {
                            status: "sent",
                            sentAt: new Date()
                        }
                    });

                } catch (e: any) {

                    failed++;

                    const errorMessage =
                        e?.message || "Unknown error";

                    errors.push({
                        jid,
                        error: errorMessage
                    });

                    console.error(
                        `Failed to send broadcast to ${jid}`,
                        e
                    );

                    /*
                     * Update failed recipient
                     */
                    await prisma.broadcastrecipient.updateMany({
                        where: {
                            broadcastLogId: broadcastId,
                            jid
                        },

                        data: {
                            status: "failed",
                            error: errorMessage
                        }
                    });
                }

                const progress = Math.round(
                    ((sent + failed) / recipients.length) * 100
                );

                /*
                 * Update Broadcast Log progress
                 */
                await prisma.broadcastlog.update({
                    where: {
                        id: broadcastId
                    },

                    data: {
                        sent,
                        failed
                    }
                });

                /*
                 * Real-time socket progress
                 */
                if (io) {
                    io.to(sessionId).emit(
                        "broadcast.progress",
                        {
                            broadcastId,
                            status: "running",
                            total: recipients.length,
                            sent,
                            failed,
                            current: jid,
                            progress
                        }
                    );
                }

                /*
                 * Delay between messages
                 */
                if (i < recipients.length - 1) {

                    const baseDelay =
                        delay || 2000;

                    const randomDelay =
                        baseDelay +
                        Math.floor(
                            Math.random() *
                            (baseDelay * 0.5)
                        );

                    await new Promise((resolve) =>
                        setTimeout(resolve, randomDelay)
                    );
                }
            }

            /*
             * Mark broadcast completed
             */
            const completedAt = new Date();

            await prisma.broadcastlog.update({
                where: {
                    id: broadcastId
                },

                data: {
                    status: "completed",
                    sent,
                    failed,
                    completedAt
                }
            });

            /*
             * Final socket update
             */
            if (io) {
                io.to(sessionId).emit(
                    "broadcast.progress",
                    {
                        broadcastId,
                        status: "completed",
                        total: recipients.length,
                        sent,
                        failed,
                        errors,
                        progress: 100,
                        completedAt:
                            completedAt.toISOString()
                    }
                );
            }

            console.log(
                `Broadcast ${broadcastId} completed: ` +
                `${sent} sent, ${failed} failed ` +
                `out of ${recipients.length}`
            );

        })().catch(async (backgroundError) => {

            /*
             * Prevent unhandled rejection
             * from background processing
             */
            console.error(
                `Broadcast ${broadcastId} background error:`,
                backgroundError
            );

            try {
                await prisma.broadcastlog.update({
                    where: {
                        id: broadcastId
                    },

                    data: {
                        status: "failed",
                        completedAt: new Date()
                    }
                });
            } catch (dbError) {
                console.error(
                    "Failed to update broadcast status:",
                    dbError
                );
            }
        });

        /*
         * Return immediately while
         * broadcast continues in background
         */
        return NextResponse.json({
            status: true,
            message: "Broadcast started",

            data: {
                broadcastId: log.id,
                total: recipients.length
            }
        });

    } catch (e) {

        console.error(
            "Broadcast error",
            e
        );

        return NextResponse.json(
            {
                status: false,
                message: "Failed to start broadcast",
                error: "Failed to start broadcast"
            },
            { status: 500 }
        );
    }
}
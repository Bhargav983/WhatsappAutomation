import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import type { WASocket, WAMessage } from "@whiskeysockets/baileys";
import { normalizeMessageContent } from "@whiskeysockets/baileys";
import { resolveToPhoneJid, isLidJid } from "@/lib/jid-utils";

type AiStatus = "ACTIVE" | "COMPLETED" | "NEEDS_HUMAN" | "MANUAL";

interface AiModelResult {
    reply: string;
    status: AiStatus;
    requirementDetails?: string | null;
    notes?: string | null;
    preferredMeetingTime?: string | null;
    summary?: string | null;
}

const DEFAULT_BUSINESS_PROMPT = [
    "You are a WhatsApp intake assistant for collecting project requirements.",
    "Follow this intake flow: greet the customer, ask for their requirements, acknowledge the requirement, ask if they have any other requirements, then close politely when they say no.",
    "Example: Contact says Hi. Reply: Hi, please let me know your requirements. Contact gives a requirement. Reply: Ok sure, are there any other requirements? Contact says No. Reply: Thanks, we will come back to you on this.",
    "Store every concrete requirement in requirementDetails so the team can work on it later.",
    "Collect any other useful notes in notes.",
    "If the customer asks for a meeting, ask for their preferred meeting time.",
    "Do not ask for budget details.",
    "Ask one short question at a time.",
    "When the customer says there are no more requirements, set status to COMPLETED, summarize the collected requirements, and close with the handoff message."
].join(" ");

const DEFAULT_HANDOFF_MESSAGE = "Thanks, we will come back to you on this.";

function getMessageText(msg: WAMessage) {
    const content = normalizeMessageContent(msg.message);
    return content?.conversation || content?.extendedTextMessage?.text || content?.imageMessage?.caption || content?.videoMessage?.caption || "";
}

function normalizeAllowedJids(value: unknown): string[] {
    if (Array.isArray(value)) {
        return value.filter((item): item is string => typeof item === "string");
    }

    if (typeof value !== "string" || !value.trim()) return [];

    try {
        const parsed = JSON.parse(value);
        if (Array.isArray(parsed)) {
            return parsed.filter((item): item is string => typeof item === "string");
        }
    } catch {
        return value.split(",").map(item => item.trim()).filter(Boolean);
    }

    return [];
}

function extractDigits(str: string): string {
    return str.split("@")[0].replace(/\D/g, "");
}

function isGreetingOnly(text: string) {
    return /^(hi|hii|hello|hey|hai|good morning|good afternoon|good evening)[!.\s]*$/i.test(text.trim());
}

function isNoMoreRequirements(text: string) {
    return /^(no|nope|nothing|nothing else|no other requirements|no more|that's all|thats all|done|done with sharing|shared all|finished)[!.\s]*$/i.test(text.trim());
}

function stripEmojiAndPunctuation(text: string) {
    return text
        .replace(/[👍😊🙂😀😃😄😁🙏👌✅❤❤️]/g, "")
        .replace(/[!.?\s]+/g, " ")
        .trim();
}

function isAffirmationOnly(text: string) {
    return /^(yes|yeah|yep|ya|sure|correct|ok yes|okay yes)$/i.test(stripEmojiAndPunctuation(text));
}

function isAcknowledgementOnly(text: string) {
    const normalized = stripEmojiAndPunctuation(text);
    if (!normalized) return true;
    return /^(ok|okay|k|thanks|thank you|good|this is good|nice|great|received|noted|fine|super|cool|done)$/i.test(normalized);
}

function isMeaningfulRequirement(text: string) {
    const normalized = text.trim();
    if (normalized.length < 3) return false;
    if (isGreetingOnly(normalized) || isNoMoreRequirements(normalized) || isAffirmationOnly(normalized) || isAcknowledgementOnly(normalized)) return false;
    return true;
}

function normalizeRequirementText(text: string) {
    return text
        .toLowerCase()
        .replace(/[“”"'`]/g, "")
        .replace(/[^a-z0-9]+/g, " ")
        .trim();
}

function requirementsSimilar(a: string, b: string) {
    const left = normalizeRequirementText(a);
    const right = normalizeRequirementText(b);
    if (!left || !right) return false;
    return left === right || left.includes(right) || right.includes(left);
}

function cleanExtractedRequirement(text: string) {
    return text
        .replace(/[?.!]+$/g, "")
        .replace(/^(the|a|an)\s+/i, "")
        .replace(/\s+/g, " ")
        .trim();
}

function extractFollowUpRequirement(text: string) {
    const normalized = text.trim();
    const patterns = [
        /(?:what\s+is\s+the\s+)?update\s+on\s+(.+)$/i,
        /status\s+of\s+(.+)$/i,
        /what\s+about\s+(.+)$/i,
        /any\s+update\s+on\s+(.+)$/i,
        /also\s+(?:need|add|do|update|check)?\s*(.+)$/i,
        /one\s+more\s+(?:thing|requirement|task)?\s*(.+)$/i,
        /please\s+(?:do|update|check|complete|add)\s+(.+)$/i,
        /need\s+(.+)$/i,
    ];

    for (const pattern of patterns) {
        const match = normalized.match(pattern);
        if (match?.[1]) return cleanExtractedRequirement(match[1]);
    }

    if (isAffirmationOnly(normalized) || isAcknowledgementOnly(normalized)) return "";
    const cleaned = cleanExtractedRequirement(normalized);
    return isMeaningfulRequirement(cleaned) ? cleaned : "";
}

function mergeRequirement(existing: string | null | undefined, incoming: string) {
    const cleanIncoming = incoming.trim();
    if (!existing?.trim()) return cleanIncoming;

    const existingItems = existing
        .split("\n")
        .map(item => item.replace(/^[-•]\s*/, "").trim())
        .filter(Boolean);

    if (existingItems.some(item => item.toLowerCase() === cleanIncoming.toLowerCase())) {
        return existing.trim();
    }

    return [...existingItems, cleanIncoming].map(item => `- ${item}`).join("\n");
}

function buildRequirementSummary(requirementDetails: string) {
    return `Requirement captured:\n${requirementDetails}`;
}


function titleFromRequirement(description: string) {
    const firstLine = description.split("\n").find(line => line.trim())?.replace(/^[-•]\s*/, "").trim() || "Requirement";
    return firstLine.length > 80 ? `${firstLine.slice(0, 77)}...` : firstLine;
}

async function syncRequirementWorkItem(input: {
    sessionDbId: string;
    conversationId: string;
    remoteJid: string;
    requirementDetails: string;
}) {
    const description = input.requirementDetails.trim();
    if (!description) return;

    const sameContactRequirements = await prisma.airequirement.findMany({
        where: {
            sessionId: input.sessionDbId,
            remoteJid: input.remoteJid,
            status: { not: "DONE" }
        },
        select: { id: true, description: true, conversationId: true }
    });

    const duplicateOpen = sameContactRequirements.find(item => requirementsSimilar(item.description, description));
    if (duplicateOpen) return;

    const existing = await prisma.airequirement.findFirst({
        where: {
            sessionId: input.sessionDbId,
            conversationId: input.conversationId
        },
        select: { id: true, description: true }
    });

    if (existing) {
        if (existing.description !== description) {
            await prisma.airequirement.update({
                where: { id: existing.id },
                data: {
                    title: titleFromRequirement(description),
                    description,
                    remoteJid: input.remoteJid
                }
            });
        }
        return;
    }

    await prisma.airequirement.create({
        data: {
            id: `req_${input.sessionDbId}_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
            sessionId: input.sessionDbId,
            conversationId: input.conversationId,
            remoteJid: input.remoteJid,
            title: titleFromRequirement(description),
            description,
            status: "NEW",
            updatedAt: new Date()
        }
    });
}


async function createFollowUpRequirementWorkItem(input: {
    sessionDbId: string;
    remoteJid: string;
    requirementText: string;
    originalMessage: string;
}) {
    const description = input.requirementText.trim();
    if (!description) return null;

    const normalizedNew = normalizeRequirementText(description);
    const openRequirements = await prisma.airequirement.findMany({
        where: {
            sessionId: input.sessionDbId,
            remoteJid: input.remoteJid,
            status: { not: "DONE" }
        },
        select: { id: true, description: true }
    });

    const duplicate = openRequirements.find(item => requirementsSimilar(item.description, description));
    if (duplicate) {
        await prisma.airequirement.update({
            where: { id: duplicate.id },
            data: { internalNotes: `Customer followed up: ${input.originalMessage}` }
        });
        return duplicate;
    }

    return await prisma.airequirement.create({
        data: {
            id: `req_${input.sessionDbId}_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
            sessionId: input.sessionDbId,
            remoteJid: input.remoteJid,
            title: titleFromRequirement(description),
            description,
            status: "NEW",
            internalNotes: `Customer asked: ${input.originalMessage}`,
            updatedAt: new Date()
        }
    });
}

async function getLatestDoneRequirement(sessionDbId: string, remoteJid: string) {
    return await prisma.airequirement.findFirst({
        where: {
            sessionId: sessionDbId,
            remoteJid,
            status: "DONE"
        },
        orderBy: { updatedAt: "desc" }
    });
}

function isAllowedForPilot(config: any, rawRemoteJid: string, effectiveRemoteJid?: string) {
    const mode = config?.audienceMode || "SPECIFIC";
    if (mode === "ALL_PRIVATE") return true;

    const allowedJids = normalizeAllowedJids(config?.allowedJids);
    if (allowedJids.length === 0) return false;

    const targets = [rawRemoteJid, effectiveRemoteJid].filter(Boolean) as string[];
    const targetDigits = targets.map(extractDigits).filter(d => d.length >= 7);

    for (const allowed of allowedJids) {
        // Direct string match or inclusion
        for (const target of targets) {
            if (target === allowed || target.includes(allowed) || allowed.includes(target)) {
                return true;
            }
        }
        // Digit match
        const allowedDigit = extractDigits(allowed);
        if (allowedDigit && targetDigits.some(td => td === allowedDigit || td.endsWith(allowedDigit) || allowedDigit.endsWith(td))) {
            return true;
        }
    }

    return false;
}

function extractJsonObject(raw: string): any | null {
    try {
        return JSON.parse(raw);
    } catch {}

    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return null;

    try {
        return JSON.parse(match[0]);
    } catch {
        return null;
    }
}

function sanitizeModelResult(raw: string): AiModelResult {
    const parsed = extractJsonObject(raw);
    if (!parsed || typeof parsed !== "object") {
        return {
            reply: "Thanks. Could you share your requirement details?",
            status: "ACTIVE"
        };
    }

    const status = ["ACTIVE", "COMPLETED", "NEEDS_HUMAN", "MANUAL"].includes(parsed.status)
        ? parsed.status
        : "ACTIVE";

    return {
        reply: typeof parsed.reply === "string" && parsed.reply.trim()
            ? parsed.reply.trim()
            : "Thanks. Could you share your requirement details?",
        status,
        requirementDetails: typeof parsed.requirementDetails === "string" ? parsed.requirementDetails.trim() : null,
        notes: typeof parsed.notes === "string" ? parsed.notes.trim() : null,
        preferredMeetingTime: typeof parsed.preferredMeetingTime === "string" ? parsed.preferredMeetingTime.trim() : null,
        summary: typeof parsed.summary === "string" ? parsed.summary.trim() : null,
    };
}

async function callAiModel(input: {
    businessPrompt: string;
    existing: {
        requirementDetails?: string | null;
        notes?: string | null;
        preferredMeetingTime?: string | null;
        summary?: string | null;
    };
    messages: Array<{ fromMe: boolean; content: string | null; timestamp: Date }>;
}) {
    const baseUrl = process.env.AI_CHAT_BASE_URL;
    const apiKey = process.env.AI_CHAT_API_KEY;
    const model = process.env.AI_CHAT_MODEL || "qwen2.5-coder:3b";

    if (!baseUrl || !apiKey) {
        throw new Error("AI chat is enabled but AI_CHAT_BASE_URL or AI_CHAT_API_KEY is missing");
    }

    const systemPrompt = [
        input.businessPrompt || DEFAULT_BUSINESS_PROMPT,
        "",
        "Return only JSON with this exact shape:",
        '{"reply":"message to send","status":"ACTIVE|COMPLETED|NEEDS_HUMAN","requirementDetails":"...","notes":"...","preferredMeetingTime":"...","summary":"..."}',
        "",
        "Rules:",
        "- Treat greetings like hi/hello as the start of intake and ask: Hi, please let me know your requirements.",
        "- When the customer gives a concrete requirement, save it in requirementDetails and ask if they have any other requirements.",
        "- If the latest customer reply is no/nope/nothing else/no other requirements and requirementDetails is present, set status to COMPLETED and reply with the handoff message tone: Thanks, we will come back to you on this.",
        "- Do not ask for budget.",
        "- If the user asks for a meeting and preferredMeetingTime is missing, ask for preferred meeting time.",
        "- Ask one concise question at a time.",
        "- If the user wants a human or the conversation is unclear, status should be NEEDS_HUMAN.",
        "- Completed records must include requirementDetails and a concise summary so they are visible in the dashboard.",
    ].join("\n");

    const history = input.messages.map(message => ({
        role: message.fromMe ? "assistant" : "user",
        content: message.content || ""
    })).filter(message => message.content.trim());

    const context = [
        "Current collected details:",
        `Requirement details: ${input.existing.requirementDetails || "missing"}`,
        `Notes: ${input.existing.notes || "missing"}`,
        `Preferred meeting time: ${input.existing.preferredMeetingTime || "missing"}`,
        `Summary: ${input.existing.summary || "missing"}`
    ].join("\n");

    const response = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${apiKey}`
        },
        body: JSON.stringify({
            model,
            temperature: 0.2,
            stream: false,
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: context },
                ...history
            ]
        }),
        signal: AbortSignal.timeout(45000)
    });

    if (!response.ok) {
        const body = await response.text().catch(() => "");
        throw new Error(`AI model returned ${response.status}: ${body.slice(0, 200)}`);
    }

    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content;
    return sanitizeModelResult(typeof content === "string" ? content : "");
}

export async function handleAiAutoChat(sock: WASocket | undefined, sessionId: string, msg: WAMessage) {
    if (!sock || !msg.message || msg.key.fromMe || !msg.key.remoteJid) return;

    const rawRemoteJid = msg.key.remoteJid;
    if (rawRemoteJid.endsWith("@g.us") || rawRemoteJid === "status@broadcast") {
        logger.debug("AIChat", `Skipped non-private message ${msg.key.id || "unknown"}`);
        return;
    }

    const incomingText = getMessageText(msg).trim();
    if (!incomingText) return;

    const session = await prisma.session.findUnique({
        where: { sessionId },
        include: { aichatconfig: true }
    });

    if (!session) {
        logger.warn("AIChat", `Skipped message because session ${sessionId} was not found`);
        return;
    }
    const config = session.aichatconfig;
    if (!config?.enabled) {
        logger.info("AIChat", `Skipped incoming private message because AI Auto Chat is disabled for session ${sessionId}`);
        return;
    }

    // Resolve LID to Phone JID if needed
    let effectiveRemoteJid = rawRemoteJid;
    if (isLidJid(rawRemoteJid)) {
        effectiveRemoteJid = await resolveToPhoneJid(rawRemoteJid, session.id, msg.key.remoteJidAlt);
    }

    if (!isAllowedForPilot(config, rawRemoteJid, effectiveRemoteJid)) {
        logger.info("AIChat", `Skipped incoming private message from ${effectiveRemoteJid}: contact is outside the pilot audience`);
        return;
    }

    logger.info("AIChat", `Processing incoming pilot message ${msg.key.id || "unknown"} from ${effectiveRemoteJid}`);

    // Find or upsert conversation record under effectiveRemoteJid
    let conversation = await prisma.aiconversation.findFirst({
        where: {
            sessionId: session.id,
            remoteJid: { in: [effectiveRemoteJid, rawRemoteJid] }
        }
    });

    if (!conversation) {
        conversation = await prisma.aiconversation.create({
            data: {
                id: `${session.id}_${effectiveRemoteJid}`,
                sessionId: session.id,
                remoteJid: effectiveRemoteJid,
                status: "ACTIVE",
                lastUserMessageAt: new Date(),
                updatedAt: new Date()
            }
        });
    } else {
        conversation = await prisma.aiconversation.update({
            where: { id: conversation.id },
            data: {
                remoteJid: effectiveRemoteJid,
                lastUserMessageAt: new Date()
            }
        });
    }

    if (conversation.status === "MANUAL") {
        logger.info("AIChat", `Skipped ${effectiveRemoteJid}: manual takeover is active`);
        return;
    }

    const emitConversationUpdate = (status: AiStatus) => {
        const io = (global as any).io;
        if (io) {
            io.to(sessionId).emit("ai.conversation.update", {
                conversationId: conversation.id,
                remoteJid: effectiveRemoteJid,
                status
            });
        }
    };

    const emitRequirementUpdate = (requirementId?: string) => {
        const io = (global as any).io;
        if (io) {
            io.to(sessionId).emit("ai.requirement.update", {
                requirementId,
                remoteJid: effectiveRemoteJid
            });
        }
    };

    const latestDoneRequirement = await getLatestDoneRequirement(session.id, effectiveRemoteJid);
    if (latestDoneRequirement && isMeaningfulRequirement(incomingText)) {
        const followUpRequirement = extractFollowUpRequirement(incomingText);
        if (followUpRequirement) {
            const requirement = await createFollowUpRequirementWorkItem({
                sessionDbId: session.id,
                remoteJid: effectiveRemoteJid,
                requirementText: followUpRequirement,
                originalMessage: incomingText
            });
            await prisma.aiconversation.update({
                where: { id: conversation.id },
                data: {
                    status: "ACTIVE",
                    requirementDetails: followUpRequirement,
                    summary: buildRequirementSummary(followUpRequirement),
                    lastAiReplyAt: new Date()
                }
            });
            emitRequirementUpdate(requirement?.id);
            emitConversationUpdate("ACTIVE");
            await sock.sendMessage(rawRemoteJid, { text: `Noted. I have added “${followUpRequirement}” as a new requirement and we will update you on this.` }, { quoted: msg });
            return;
        }
    }

    if (!conversation.requirementDetails && isGreetingOnly(incomingText)) {
        await prisma.aiconversation.update({
            where: { id: conversation.id },
            data: { status: "ACTIVE", lastAiReplyAt: new Date() }
        });
        await sock.sendMessage(rawRemoteJid, { text: "Hi, please let me know your requirements." }, { quoted: msg });
        emitConversationUpdate("ACTIVE");
        return;
    }

    if (conversation.requirementDetails && isNoMoreRequirements(incomingText)) {
        const summary = conversation.summary || buildRequirementSummary(conversation.requirementDetails);
        await prisma.aiconversation.update({
            where: { id: conversation.id },
            data: {
                status: "COMPLETED",
                summary,
                lastAiReplyAt: new Date()
            }
        });
        await sock.sendMessage(rawRemoteJid, { text: config.handoffMessage || DEFAULT_HANDOFF_MESSAGE }, { quoted: msg });
        emitConversationUpdate("COMPLETED");
        return;
    }

    if (isAffirmationOnly(incomingText)) {
        await sock.sendMessage(rawRemoteJid, { text: "Sure, please share the next requirement." }, { quoted: msg });
        emitConversationUpdate("ACTIVE");
        return;
    }

    if (isAcknowledgementOnly(incomingText)) {
        emitConversationUpdate("ACTIVE");
        return;
    }

    if (isMeaningfulRequirement(incomingText)) {
        const requirementDetails = mergeRequirement(conversation.requirementDetails, incomingText);
        await prisma.aiconversation.update({
            where: { id: conversation.id },
            data: {
                status: "ACTIVE",
                requirementDetails,
                summary: buildRequirementSummary(requirementDetails),
                lastAiReplyAt: new Date()
            }
        });
        await syncRequirementWorkItem({
            sessionDbId: session.id,
            conversationId: conversation.id,
            remoteJid: effectiveRemoteJid,
            requirementDetails
        });
        await sock.sendMessage(rawRemoteJid, { text: "Ok sure, are there any other requirements?" }, { quoted: msg });
        emitConversationUpdate("ACTIVE");
        return;
    }

    try {
        await sock.sendPresenceUpdate("composing", rawRemoteJid);
    } catch {}

    try {
        const recentMessages = await prisma.message.findMany({
            where: {
                sessionId: session.id,
                remoteJid: { in: [effectiveRemoteJid, rawRemoteJid] }
            },
            orderBy: { timestamp: "desc" },
            take: 12,
            select: { fromMe: true, content: true, timestamp: true }
        });

        const aiResult = await callAiModel({
            businessPrompt: config.businessPrompt || DEFAULT_BUSINESS_PROMPT,
            existing: {
                requirementDetails: conversation.requirementDetails,
                notes: conversation.notes,
                preferredMeetingTime: conversation.preferredMeetingTime,
                summary: conversation.summary
            },
            messages: recentMessages.reverse()
        });

        const nextRequirementDetails = aiResult.requirementDetails || conversation.requirementDetails;
        await prisma.aiconversation.update({
            where: { id: conversation.id },
            data: {
                status: aiResult.status,
                requirementDetails: nextRequirementDetails,
                notes: aiResult.notes || conversation.notes,
                preferredMeetingTime: aiResult.preferredMeetingTime || conversation.preferredMeetingTime,
                summary: aiResult.summary || conversation.summary,
                lastAiReplyAt: new Date()
            }
        });
        if (nextRequirementDetails) {
            await syncRequirementWorkItem({
                sessionDbId: session.id,
                conversationId: conversation.id,
                remoteJid: effectiveRemoteJid,
                requirementDetails: nextRequirementDetails
            });
        }

        const reply = aiResult.status === "COMPLETED"
            ? (config.handoffMessage || DEFAULT_HANDOFF_MESSAGE)
            : aiResult.reply;

        if (reply) {
            await sock.sendMessage(rawRemoteJid, { text: reply }, { quoted: msg });
        }

        // Notify frontend via Socket.io
        const io = (global as any).io;
        if (io) {
            io.to(sessionId).emit("ai.conversation.update", {
                conversationId: conversation.id,
                remoteJid: effectiveRemoteJid,
                status: aiResult.status
            });
        }
    } catch (error: any) {
        logger.error("AIChat", "Failed to run AI auto chat", error);
        // Only set NEEDS_HUMAN if it's not a temporary network timeout
        if (!error?.message?.includes("timeout") && !error?.message?.includes("aborted")) {
            await prisma.aiconversation.update({
                where: { id: conversation.id },
                data: { status: "NEEDS_HUMAN" }
            }).catch(() => {});
        }
    } finally {
        try {
            await sock.sendPresenceUpdate("paused", rawRemoteJid);
        } catch {}
    }
}


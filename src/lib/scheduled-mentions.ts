import type { WASocket } from "@whiskeysockets/baileys";

type MentionMode = "none" | "selected" | "everyone";

type MentionConfig = {
    mode?: MentionMode;
    jids?: string[];
};

export function normalizeMentionConfig(value: unknown): MentionConfig {
    if (!value || typeof value !== "object") return { mode: "none", jids: [] };
    const raw = value as MentionConfig;
    const mode = raw.mode === "selected" || raw.mode === "everyone" ? raw.mode : "none";
    const jids = Array.isArray(raw.jids)
        ? raw.jids.filter((jid): jid is string => typeof jid === "string" && jid.endsWith("@s.whatsapp.net"))
        : [];
    return { mode, jids };
}

export async function resolveScheduledMentions(socket: WASocket, groupJid: string, value: unknown): Promise<string[]> {
    if (!groupJid.endsWith("@g.us")) return [];

    const config = normalizeMentionConfig(value);
    if (config.mode === "selected") return [...new Set(config.jids || [])];
    if (config.mode !== "everyone") return [];

    try {
        const metadata = await socket.groupMetadata(groupJid);
        return [...new Set((metadata.participants || [])
            .map((participant: any) => participant?.id)
            .filter((jid: unknown): jid is string => typeof jid === "string" && jid.endsWith("@s.whatsapp.net")))];
    } catch {
        return [];
    }
}

export function applyMentionsToPayload(payload: any, mentionJids: string[]) {
    if (!mentionJids.length) return payload;

    // Standard Baileys structure expects contextInfo.mentionedJid on the content payload
    const updatedPayload = { 
        ...payload, 
        mentions: mentionJids,
        contextInfo: {
            ...(payload?.contextInfo || {}),
            mentionedJid: mentionJids
        }
    };

    // In WhatsApp, the JIDs must be explicitly tagged as "@<number>" in the message text or caption
    // so the receiver is highlighted and notified as a mention/tag.
    const tagsToAppend: string[] = [];
    for (const jid of mentionJids) {
        const number = jid.split("@")[0];
        const tag = `@${number}`;
        
        // Check if the tag already exists in the text or caption to avoid duplicate appending
        const hasTextTag = updatedPayload.text && typeof updatedPayload.text === "string" && updatedPayload.text.includes(tag);
        const hasCaptionTag = updatedPayload.caption && typeof updatedPayload.caption === "string" && updatedPayload.caption.includes(tag);

        if (!hasTextTag && !hasCaptionTag) {
            tagsToAppend.push(tag);
        }
    }

    if (tagsToAppend.length > 0) {
        const appendStr = "\n\n" + tagsToAppend.join(" ");
        if (typeof updatedPayload.text === "string") {
            updatedPayload.text += appendStr;
        } else if (typeof updatedPayload.caption === "string") {
            updatedPayload.caption += appendStr;
        } else if (!updatedPayload.text && !updatedPayload.caption) {
            // Default to caption if media is present, otherwise text
            if (updatedPayload.image || updatedPayload.video || updatedPayload.document || updatedPayload.audio) {
                updatedPayload.caption = tagsToAppend.join(" ");
            } else {
                updatedPayload.text = tagsToAppend.join(" ");
            }
        }
    }

    return updatedPayload;
}

import { prisma } from "@/lib/prisma";

export const isPhoneJid = (jid?: string | null) => Boolean(jid?.endsWith("@s.whatsapp.net"));
export const isLid = (jid?: string | null) => Boolean(jid?.endsWith("@lid"));

export function phoneFromJid(jid?: string | null) {
    return isPhoneJid(jid) ? jid!.slice(0, -"@s.whatsapp.net".length) : null;
}

export function contactIdentityFields(primaryJid: string, alternateJid?: string | null) {
    const phoneJid = [primaryJid, alternateJid].find(isPhoneJid) || null;
    const lid = [primaryJid, alternateJid].find(isLid) || null;
    return {
        phoneJid,
        lid,
        remoteJidAlt: phoneJid
    };
}

/**
 * Repairs explicit LID/phone relationships already present in the contact table.
 * It never treats the numeric part of a LID as a telephone number.
 */
export async function backfillContactIdentities(sessionId: string) {
    const contacts = await prisma.contact.findMany({
        where: { sessionId },
        select: { id: true, jid: true, lid: true, remoteJidAlt: true }
    });

    const phoneByLid = new Map<string, string>();
    for (const contact of contacts) {
        const phone = [contact.jid, contact.remoteJidAlt].find(isPhoneJid);
        const lid = [contact.jid, contact.lid, contact.remoteJidAlt].find(isLid);
        if (phone && lid) phoneByLid.set(lid, phone);
    }

    // A phone row can point at a LID while the separate LID row contains no phone.
    for (const contact of contacts) {
        if (isPhoneJid(contact.jid) && isLid(contact.lid)) {
            phoneByLid.set(contact.lid!, contact.jid);
        }
    }

    const updates: Array<{ id: string; lid: string | null; phone: string }> = [];
    const identities = new Map<string, boolean>();
    for (const contact of contacts) {
        const lid = [contact.jid, contact.lid, contact.remoteJidAlt].find(isLid) || null;
        const phone = [contact.jid, contact.remoteJidAlt].find(isPhoneJid)
            || (lid ? phoneByLid.get(lid) : null)
            || null;
        identities.set(phone || lid || contact.jid, Boolean(phone));
        if (!phone || (contact.lid === lid && contact.remoteJidAlt === phone)) continue;
        updates.push({ id: contact.id, lid, phone });
    }

    // Keep MySQL load bounded for large WhatsApp address books.
    for (let offset = 0; offset < updates.length; offset += 50) {
        await Promise.all(updates.slice(offset, offset + 50).map(update => prisma.contact.update({
            where: { id: update.id },
            data: { lid: update.lid || undefined, remoteJidAlt: update.phone }
        })));
    }

    const resolved = Array.from(identities.values()).filter(Boolean).length;
    return { total: identities.size, resolved, unavailable: identities.size - resolved };
}

/** Remove names copied from our own outgoing message push name in older syncs. */
export async function repairOutgoingNameContamination(sessionId: string) {
    const ownNames = await prisma.message.groupBy({
        by: ["pushName"],
        where: { sessionId, fromMe: true, pushName: { not: null } }
    });
    const senderNames = ownNames.map(item => item.pushName).filter((name): name is string => Boolean(name));
    if (!senderNames.length) return 0;

    const candidates = await prisma.contact.findMany({
        where: { sessionId, name: { in: senderNames }, notify: { not: null } },
        select: { id: true, jid: true, lid: true, remoteJidAlt: true, name: true, notify: true }
    });

    let repaired = 0;
    for (const contact of candidates) {
        if (!contact.notify || contact.notify === contact.name) continue;
        const jids = [contact.jid, contact.lid, contact.remoteJidAlt].filter((jid): jid is string => Boolean(jid));
        const matchingIncoming = await prisma.message.count({
            where: {
                sessionId,
                remoteJid: { in: jids },
                fromMe: false,
                pushName: contact.notify
            }
        });
        if (!matchingIncoming) continue;
        // Preserve notify as the incoming name; clear only the proven bad
        // address-book name. A later WhatsApp contact sync may supply one.
        await prisma.contact.update({ where: { id: contact.id }, data: { name: null } });
        repaired += 1;
    }
    return repaired;
}

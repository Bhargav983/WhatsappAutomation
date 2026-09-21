
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedUser, canAccessSession } from "@/lib/api-auth";
import { isLid, isPhoneJid, phoneFromJid } from "@/lib/contact-identity";

export async function GET(
    req: NextRequest,
    { params }: { params: Promise<{ sessionId: string }> }
) {
    try {
        const user = await getAuthenticatedUser(req);
        if (!user) {
            return NextResponse.json({ status: false, message: "Unauthorized", error: "Unauthorized" }, { status: 401 });
        }

        const { sessionId } = await params;
        const { searchParams } = new URL(req.url);
        const page = parseInt(searchParams.get("page") || "1");
        const limitParam = searchParams.get("limit") || "10";
        const isAll = limitParam === "all";
        const limit = isAll ? 0 : parseInt(limitParam) || 10;
        const search = searchParams.get("search") || "";
        const identity = searchParams.get("identity") || "resolved";

        // Check if user can access this session
        const canAccess = await canAccessSession(user.id, user.role, sessionId);
        if (!canAccess) {
            return NextResponse.json({ status: false, message: "Forbidden - Cannot access this session", error: "Forbidden - Cannot access this session" }, { status: 403 });
        }

        // Resolve sessionId string to database ID (CUID)
        const sessionData = await prisma.session.findUnique({
            where: { sessionId: sessionId },
            select: { id: true }
        });

        if (!sessionData) {
            return NextResponse.json({ status: false, message: "Session not found", error: "Session not found" }, { status: 404 });
        }

        const contacts = await prisma.contact.findMany({
            where: { sessionId: sessionData.id },
            orderBy: [{ name: "asc" }, { notify: "asc" }],
            include: { _count: { select: { message: true } } }
        });

        const phoneByLid = new Map<string, string>();
        for (const contact of contacts) {
            const phoneJid = [contact.jid, contact.remoteJidAlt].find(isPhoneJid);
            const lid = [contact.jid, contact.lid, contact.remoteJidAlt].find(isLid);
            if (phoneJid && lid) phoneByLid.set(lid, phoneJid);
        }

        const deduplicated = new Map<string, any>();
        for (const contact of contacts) {
            const lid = [contact.jid, contact.lid, contact.remoteJidAlt].find(isLid) || null;
            const phoneJid = [contact.jid, contact.remoteJidAlt].find(isPhoneJid)
                || (lid ? phoneByLid.get(lid) : null)
                || null;
            const key = phoneJid || lid || contact.jid;
            const current = deduplicated.get(key);
            const candidate = {
                ...contact,
                jid: phoneJid || contact.jid,
                lid,
                remoteJidAlt: phoneJid,
                phone: phoneFromJid(phoneJid),
                identityStatus: phoneJid ? "RESOLVED" : "UNAVAILABLE",
                _count: { message: (current?._count?.message || 0) + contact._count.message }
            };
            if (!current) {
                deduplicated.set(key, candidate);
            } else {
                deduplicated.set(key, {
                    ...current,
                    name: current.name || candidate.name,
                    notify: current.notify || candidate.notify,
                    verifiedName: current.verifiedName || candidate.verifiedName,
                    profilePic: current.profilePic || candidate.profilePic,
                    lid: current.lid || candidate.lid,
                    _count: candidate._count
                });
            }
        }

        const needle = search.trim().toLowerCase();
        const searched = Array.from(deduplicated.values()).filter(contact => !needle || [
            contact.name,
            contact.notify,
            contact.verifiedName,
            contact.jid,
            contact.lid,
            contact.remoteJidAlt,
            contact.phone
        ].some(value => String(value || "").toLowerCase().includes(needle)));
        const resolvedCount = searched.filter(contact => contact.identityStatus === "RESOLVED").length;
        const unavailableCount = searched.length - resolvedCount;
        const filtered = searched.filter(contact =>
            identity === "all"
            || (identity === "unavailable" && contact.identityStatus === "UNAVAILABLE")
            || (identity === "resolved" && contact.identityStatus === "RESOLVED")
        );
        const total = filtered.length;
        const pageContacts = isAll ? filtered : filtered.slice((page - 1) * limit, page * limit);

        return NextResponse.json({
            status: true,
            message: "Contacts retrieved successfully",
            data: pageContacts,
            meta: {
                total,
                page: isAll ? 1 : page,
                limit: isAll ? total : limit,
                totalPages: isAll ? 1 : Math.ceil(total / limit),
                resolved: resolvedCount,
                unavailable: unavailableCount
            }
        });
    } catch (error) {
        console.error("Error fetching contacts:", error);
        return NextResponse.json({ status: false, message: "Internal Server Error", error: "Internal Server Error" }, { status: 500 });
    }
}

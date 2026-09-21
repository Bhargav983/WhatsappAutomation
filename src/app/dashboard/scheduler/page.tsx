"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Trash2, Plus, CalendarClock, RefreshCw, Pencil, CheckCircle2, XCircle, Clock3, Users, AtSign, ChevronsUpDown, Search, X } from "lucide-react";
import { toast } from "sonner";
import moment from "moment-timezone";
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { SearchFilter } from "@/components/dashboard/search-filter";
import { useSession } from "@/components/dashboard/session-provider";
import { SessionGuard } from "@/components/dashboard/session-guard";

interface ScheduledMessage {
    id: string;
    jid: string;
    content: string | null;
    sendAt: string;
    status: string;
    mediaUrl?: string;
    mediaType?: string;
    cronExpression?: string;
    recurrenceRule?: string;
    mentions?: MentionConfig | null;
    recipientName?: string | null;
    processedAt?: string;
    messageKeyId?: string | null;
    error?: string | null;
    isRun?: boolean;
    lastRun?: { status: string; processedAt: string } | null;
}

interface GroupOption {
    jid: string;
    subject?: string | null;
}

interface ContactOption {
    jid: string;
    lid?: string | null;
    remoteJidAlt?: string | null;
    name?: string | null;
    notify?: string | null;
    verifiedName?: string | null;
}

const contactPhoneJid = (contact: ContactOption) => {
    const candidates = [contact.remoteJidAlt, contact.jid];
    return candidates.find(value => value?.endsWith("@s.whatsapp.net")) || null;
};

const contactPhone = (contact: ContactOption) => contactPhoneJid(contact)?.split("@")[0] || null;

interface GroupMember {
    jid: string;
    phone: string;
    name: string;
    admin?: string | null;
}

type MentionMode = "none" | "selected" | "everyone";

interface MentionConfig {
    mode: MentionMode;
    jids: string[];
}

export default function SchedulerPage() {
    const { sessionId: selectedSessionId } = useSession();

    const [messages, setMessages] = useState<ScheduledMessage[]>([]);
    const [loading, setLoading] = useState(false);
    const [searchTerm, setSearchTerm] = useState("");
    const [systemTimezone, setSystemTimezone] = useState("Asia/Jakarta");
    const [activeTab, setActiveTab] = useState("pending");

    // Form state
    const [showForm, setShowForm] = useState(false);
    const [newJidType, setNewJidType] = useState("personal");
    const [newJid, setNewJid] = useState("");
    const [newContent, setNewContent] = useState("Hi");
    const [newSendAt, setNewSendAt] = useState("");
    const [newSendTime, setNewSendTime] = useState("");
    const [newMediaUrl, setNewMediaUrl] = useState("");
    const [newMediaType, setNewMediaType] = useState("image");

    // Recurrence State for Create
    const [isRecurring, setIsRecurring] = useState("once");
    const [recurrenceType, setRecurrenceType] = useState("minutes");
    const [recurringMinutes, setRecurringMinutes] = useState(5);
    const [recurringHours, setRecurringHours] = useState(1);
    const [recurringDays, setRecurringDays] = useState<number[]>([]);
    const [customCron, setCustomCron] = useState("");
    const [catchUpMode, setCatchUpMode] = useState("send");

    const [groups, setGroups] = useState<GroupOption[]>([]);
    const [groupsLoading, setGroupsLoading] = useState(false);
    const [groupsError, setGroupsError] = useState("");
    const [contacts, setContacts] = useState<ContactOption[]>([]);

    const [newMentionMode, setNewMentionMode] = useState<MentionMode>("none");
    const [newMentionJids, setNewMentionJids] = useState<string[]>([]);
    const [newGroupMembers, setNewGroupMembers] = useState<GroupMember[]>([]);
    const [newMemberSearch, setNewMemberSearch] = useState("");
    const [newMembersLoading, setNewMembersLoading] = useState(false);
    const [newGroupSearch, setNewGroupSearch] = useState("");
    const [newGroupPickerOpen, setNewGroupPickerOpen] = useState(false);
    const [newMemberPickerOpen, setNewMemberPickerOpen] = useState(false);

    // Contact picker states
    const [newContactSearch, setNewContactSearch] = useState("");
    const [newContactPickerOpen, setNewContactPickerOpen] = useState(false);
    const [editContactSearch, setEditContactSearch] = useState("");
    const [editContactPickerOpen, setEditContactPickerOpen] = useState(false);

    // Delete state
    const [deleteId, setDeleteId] = useState<string | null>(null);

    // Edit state
    const [isEditOpen, setIsEditOpen] = useState(false);
    const [editId, setEditId] = useState<string | null>(null);
    const [editJidType, setEditJidType] = useState("personal");
    const [editJid, setEditJid] = useState("");
    const [editContent, setEditContent] = useState("");
    const [editSendAt, setEditSendAt] = useState("");
    const [editSendTime, setEditSendTime] = useState("");
    const [editMediaUrl, setEditMediaUrl] = useState("");
    const [editMediaType, setEditMediaType] = useState("image");

    const [editIsRecurring, setEditIsRecurring] = useState("once");
    const [editRecurrenceType, setEditRecurrenceType] = useState("minutes");
    const [editRecurringMinutes, setEditRecurringMinutes] = useState(5);
    const [editRecurringHours, setEditRecurringHours] = useState(1);
    const [editRecurringDays, setEditRecurringDays] = useState<number[]>([]);
    const [editCustomCron, setEditCustomCron] = useState("");
    const [editCatchUpMode, setEditCatchUpMode] = useState("send");
    const [editMentionMode, setEditMentionMode] = useState<MentionMode>("none");
    const [editMentionJids, setEditMentionJids] = useState<string[]>([]);
    const [editGroupMembers, setEditGroupMembers] = useState<GroupMember[]>([]);
    const [editMemberSearch, setEditMemberSearch] = useState("");
    const [editMembersLoading, setEditMembersLoading] = useState(false);
    const [editGroupSearch, setEditGroupSearch] = useState("");
    const [editGroupPickerOpen, setEditGroupPickerOpen] = useState(false);
    const [editMemberPickerOpen, setEditMemberPickerOpen] = useState(false);

    useEffect(() => {
        fetch('/api/settings/system')
            .then(res => res.json())
            .then(data => {
                if (data.status && data.data?.timezone) {
                    setSystemTimezone(data.data.timezone);
                }
            })
            .catch(() => { });
    }, []);

    useEffect(() => {
        if (selectedSessionId) {
            fetchMessages(selectedSessionId, activeTab);
        } else {
            setMessages([]);
        }
    }, [selectedSessionId, activeTab]);

    useEffect(() => {
        if (selectedSessionId) {
            fetchGroups(selectedSessionId);
            fetchContacts(selectedSessionId);
        } else {
            setGroups([]);
            setContacts([]);
        }
    }, [selectedSessionId]);

    useEffect(() => {
        if (selectedSessionId && newJidType === "group" && newJid) {
            fetchGroupMembers(selectedSessionId, newJid, setNewGroupMembers, setNewMembersLoading);
        } else {
            setNewGroupMembers([]);
            setNewMentionMode("none");
            setNewMentionJids([]);
        }
    }, [selectedSessionId, newJidType, newJid]);

    useEffect(() => {
        if (selectedSessionId && editJidType === "group" && editJid) {
            fetchGroupMembers(selectedSessionId, editJid, setEditGroupMembers, setEditMembersLoading);
        } else {
            setEditGroupMembers([]);
            setEditMentionMode("none");
            setEditMentionJids([]);
        }
    }, [selectedSessionId, editJidType, editJid]);

    const normalizeGroupJid = (jid: string) => {
        const trimmed = jid.trim();
        if (!trimmed) return "";
        return trimmed.includes("@") ? trimmed : `${trimmed}@g.us`;
    };

    const normalizeMentionConfig = (mentions?: MentionConfig | null): MentionConfig => {
        if (!mentions || typeof mentions !== "object") return { mode: "none", jids: [] };
        const mode = mentions.mode === "selected" || mentions.mode === "everyone" ? mentions.mode : "none";
        const jids = Array.isArray(mentions.jids) ? mentions.jids.filter(jid => typeof jid === "string") : [];
        return { mode, jids };
    };

    const buildMentionConfig = (jidType: string, mode: MentionMode, jids: string[]): MentionConfig | null => {
        if (jidType !== "group" || mode === "none") return null;
        return { mode, jids: mode === "selected" ? [...new Set(jids)] : [] };
    };

    const fetchGroups = async (sessionId: string, refresh = false) => {
        setGroupsLoading(true);
        setGroupsError("");
        try {
            const res = await fetch(`/api/groups/${sessionId}${refresh ? "?refresh=1" : ""}`, { cache: "no-store" });
            const data = await res.json();
            if (!res.ok) {
                setGroups([]);
                setGroupsError(data?.message || "Could not load groups");
                return;
            }
            setGroups(Array.isArray(data?.data) ? data.data : []);
            if (!Array.isArray(data?.data) || data.data.length === 0) setGroupsError("No WhatsApp groups were found for this session.");
        } catch {
            setGroups([]);
            setGroupsError("Could not load groups. Check the session and try again.");
        } finally {
            setGroupsLoading(false);
        }
    };

    const defaultSendAt = () => moment().tz(systemTimezone).add(2, "seconds").format("YYYY-MM-DDTHH:mm:ss");

    const openNewScheduleForm = () => {
        if (showForm) {
            setShowForm(false);
            return;
        }
        setNewContent("Hi");
        setNewSendAt(defaultSendAt());
        setShowForm(true);
    };

    const fetchContacts = async (sessionId: string) => {
        try {
            const res = await fetch(`/api/contacts/${sessionId}?limit=all`, { cache: "no-store" });
            if (!res.ok) return;
            const data = await res.json();
            const rows: ContactOption[] = Array.isArray(data?.data) ? data.data : [];
            const seen = new Set<string>();
            setContacts(rows.filter(contact => {
                if (contact.jid.endsWith("@g.us") || contact.jid.includes("@broadcast")) return false;
                const key = contactPhoneJid(contact) || contact.jid;
                if (seen.has(key)) return false;
                seen.add(key);
                return true;
            }));
        } catch {
            setContacts([]);
        }
    };

    const fetchGroupMembers = async (sessionId: string, rawJid: string, setMembers: (members: GroupMember[]) => void, setMemberLoading: (loading: boolean) => void) => {
        const groupJid = normalizeGroupJid(rawJid);
        if (!groupJid.endsWith("@g.us")) return;
        setMemberLoading(true);
        try {
            const res = await fetch(`/api/groups/${sessionId}/${encodeURIComponent(groupJid)}/members`, { cache: "no-store" });
            if (!res.ok) {
                setMembers([]);
                return;
            }
            const data = await res.json();
            setMembers(Array.isArray(data?.data) ? data.data : []);
        } catch {
            setMembers([]);
        } finally {
            setMemberLoading(false);
        }
    };

    const fetchMessages = async (sessionId: string, tab: string) => {
        setLoading(true);
        try {
            const res = await fetch(`/api/scheduler/${sessionId}?tab=${tab}`);
            if (res.ok) {
                const data = await res.json();
                setMessages(data?.data || []);
            } else {
                setMessages([]);
            }
        } catch (error) {
            toast.error("Failed to fetch scheduled messages");
        } finally {
            setLoading(false);
        }
    };

    const parseRecurrence = (ruleStr: string | undefined, cronExpr: string | undefined, setRecurring: any, setType: any, setMins: any, setHrs: any, setDays: any, setCron: any, setCatchUp: any) => {
        if (!cronExpr) {
            setRecurring("once");
            return;
        }
        setRecurring("recurring");
        setCron(cronExpr);
        if (ruleStr) {
            try {
                const rule = JSON.parse(ruleStr);
                setType(rule.type || "cron");
                if (rule.type === "minutes") setMins(rule.value);
                if (rule.type === "hours") setHrs(rule.value);
                if (rule.type === "days") setDays(Array.isArray(rule.value) ? rule.value : []);
                setCatchUp(rule.catchUpMode || "send");
            } catch(e) {
                setType("cron");
            }
        } else {
            setType("cron");
        }
    };

    const handleEdit = (msg: ScheduledMessage) => {
        setEditId(msg.id);
        const isGroup = msg.jid.includes("@g.us");
        const isNewsletter = msg.jid.includes("@newsletter");
        setEditJidType(isGroup ? "group" : isNewsletter ? "newsletter" : "personal");
        const jidUser = msg.jid.split('@')[0];
        setEditJid(jidUser);
        setEditContent(msg.content || "");
        setEditMediaUrl(msg.mediaUrl || "");
        setEditMediaType(msg.mediaType || "image");
        const mentionConfig = normalizeMentionConfig(msg.mentions);
        setEditMentionMode(mentionConfig.mode);
        setEditMentionJids(mentionConfig.jids);

        const localIso = moment.tz(msg.sendAt, systemTimezone).format('YYYY-MM-DDTHH:mm');
        setEditSendAt(localIso);

        const localTime = moment.tz(msg.sendAt, systemTimezone).format('HH:mm');
        setEditSendTime(localTime);

        parseRecurrence(msg.recurrenceRule, msg.cronExpression, setEditIsRecurring, setEditRecurrenceType, setEditRecurringMinutes, setEditRecurringHours, setEditRecurringDays, setEditCustomCron, setEditCatchUpMode);

        setIsEditOpen(true);
    };

    const buildCronData = (isRec: string, type: string, mins: number, hrs: number, days: number[], custom: string, finalSendAt: string, catchUp: string) => {
        if (isRec === "once") return { cronExpression: null, recurrenceRule: null };

        let cron = "";
        const rule: any = { type, catchUpMode: catchUp, timezone: systemTimezone };
        
        if (type === "minutes") {
            cron = `*/${mins} * * * *`;
            rule.value = mins;
        } else if (type === "hours") {
            cron = `0 */${hrs} * * *`;
            rule.value = hrs;
        } else if (type === "days") {
            const date = new Date(finalSendAt);
            const m = date.getMinutes();
            const h = date.getHours();
            const selectedDays = [...days].sort((a, b) => a - b);
            const dStr = selectedDays.join(',');
            cron = `${m} ${h} * * ${dStr}`;
            rule.value = selectedDays;
            rule.timeOfDay = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
        } else {
            cron = custom;
            rule.value = custom;
        }
        
        return { cronExpression: cron, recurrenceRule: JSON.stringify(rule) };
    };

    const handleSaveSchedule = async () => {
        if (!selectedSessionId || !newJid || (!newContent && !newMediaUrl)) {
            toast.error("Please fill required fields (JID, Content/Media)");
            return;
        }

        if (newJidType === "group" && newMentionMode === "selected" && newMentionJids.length === 0) {
            toast.error("Please select at least one group member to mention");
            return;
        }

        let finalSendAt = newSendAt;
        if (isRecurring === "recurring") {
            if (recurrenceType === "days") {
                if (!newSendTime) {
                    toast.error("Please specify a Time of Day");
                    return;
                }
                if (recurringDays.length === 0) {
                    toast.error("Please select at least one day");
                    return;
                }
                finalSendAt = `${moment().format('YYYY-MM-DD')}T${newSendTime}:00`;
            } else {
                finalSendAt = moment().tz(systemTimezone).format('YYYY-MM-DDTHH:mm:ss');
            }
        } else {
            if (!newSendAt) {
                toast.error("Please specify Send At");
                return;
            }
            if (moment.tz(newSendAt, systemTimezone).isSameOrBefore(moment().tz(systemTimezone))) {
                finalSendAt = defaultSendAt();
                setNewSendAt(finalSendAt);
                toast.info("Send time was in the past, so it was moved to two seconds from now.");
            }
        }

        let jid = newJid;
        if (!jid.includes("@")) {
            if (newJidType === "group") jid += "@g.us";
            else if (newJidType === "newsletter") jid += "@newsletter";
            else jid += "@s.whatsapp.net";
        }

        const cronData = buildCronData(isRecurring, recurrenceType, recurringMinutes, recurringHours, recurringDays, customCron, finalSendAt, catchUpMode);

        try {
            const res = await fetch(`/api/scheduler/${selectedSessionId}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    jid,
                    content: newContent,
                    sendAt: finalSendAt,
                    mediaUrl: newMediaUrl,
                    mediaType: newMediaType,
                    mentions: buildMentionConfig(newJidType, newMentionMode, newMentionJids),
                    ...cronData
                })
            });

            if (res.ok) {
                toast.success("Message scheduled");
                setShowForm(false);
                setNewJid("");
                setNewContent("Hi");
                setNewSendAt(defaultSendAt());
                setNewSendTime("");
                setNewMediaUrl("");
                setNewMediaType("image");
                setNewJidType("personal");
                setCatchUpMode("send");
                setNewMentionMode("none");
                setNewMentionJids([]);
                setNewMemberSearch("");
                setNewContactSearch("");
                fetchMessages(selectedSessionId, activeTab);
            } else {
                toast.error("Failed to schedule message");
            }
        } catch (error) {
            toast.error("An error occurred");
        }
    };

    const handleUpdateSchedule = async () => {
        if (!selectedSessionId || !editId || !editJid || (!editContent && !editMediaUrl)) {
            toast.error("Please fill required fields");
            return;
        }

        if (editJidType === "group" && editMentionMode === "selected" && editMentionJids.length === 0) {
            toast.error("Please select at least one group member to mention");
            return;
        }

        let finalSendAt = editSendAt;
        if (editIsRecurring === "recurring") {
            if (editRecurrenceType === "days") {
                if (!editSendTime) {
                    toast.error("Please specify a Time of Day");
                    return;
                }
                if (editRecurringDays.length === 0) {
                    toast.error("Please select at least one day");
                    return;
                }
                finalSendAt = `${moment().format('YYYY-MM-DD')}T${editSendTime}:00`;
            } else {
                finalSendAt = moment().tz(systemTimezone).format('YYYY-MM-DDTHH:mm:ss');
            }
        } else {
            if (!editSendAt) {
                toast.error("Please specify Send At");
                return;
            }
        }

        let jid = editJid;
        if (!jid.includes("@")) {
            if (editJidType === "group") jid += "@g.us";
            else if (editJidType === "newsletter") jid += "@newsletter";
            else jid += "@s.whatsapp.net";
        }

        const cronData = buildCronData(editIsRecurring, editRecurrenceType, editRecurringMinutes, editRecurringHours, editRecurringDays, editCustomCron, finalSendAt, editCatchUpMode);

        try {
            const res = await fetch(`/api/scheduler/${selectedSessionId}/${editId}`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    jid,
                    content: editContent,
                    sendAt: finalSendAt,
                    mediaUrl: editMediaUrl,
                    mediaType: editMediaType,
                    mentions: buildMentionConfig(editJidType, editMentionMode, editMentionJids),
                    ...cronData
                })
            });

            if (res.ok) {
                toast.success("Schedule updated");
                setIsEditOpen(false);
                setEditContactSearch("");
                fetchMessages(selectedSessionId, activeTab);
            } else {
                toast.error("Failed to update schedule");
            }
        } catch (error) {
            toast.error("An error occurred");
        }
    };

    const confirmDelete = async () => {
        if (!deleteId) return;
        try {
            const res = await fetch(`/api/scheduler/${selectedSessionId}/${deleteId}`, { method: "DELETE" });
            if (res.ok) {
                toast.success("Schedule deleted");
                fetchMessages(selectedSessionId, activeTab);
            } else {
                toast.error("Failed to delete schedule");
            }
        } catch (error) {
            toast.error("Failed to delete schedule");
        } finally {
            setDeleteId(null);
        }
    };

    const filteredMessages = messages.filter(m =>
        (m.content || "").toLowerCase().includes(searchTerm.toLowerCase()) ||
        (m.recipientName || "").toLowerCase().includes(searchTerm.toLowerCase()) ||
        m.jid.includes(searchTerm)
    );
    const parseRule = (ruleStr?: string) => {
        try { return ruleStr ? JSON.parse(ruleStr) : null; } catch { return null; }
    };

    const summarizeRule = (msg: ScheduledMessage) => {
        const rule = parseRule(msg.recurrenceRule);
        if (!msg.cronExpression) return "One-time message";
        if (!rule) return `Advanced cron: ${msg.cronExpression}`;
        if (rule.type === "minutes") return `Every ${rule.value} minute${rule.value === 1 ? "" : "s"}`;
        if (rule.type === "hours") return `Every ${rule.value} hour${rule.value === 1 ? "" : "s"}${rule.value === 24 ? " from last scheduled run" : ""}`;
        if (rule.type === "days") {
            const days = Array.isArray(rule.value) ? rule.value : [];
            const label = days.length === 7 ? "Every day" : days.join(",") === "1,2,3,4,5,6" ? "Daily except Sunday" : days.length ? days.map((d: number) => ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"][d]).join(", ") : "No days selected";
            return `${label} at ${rule.timeOfDay || moment(msg.sendAt).tz(systemTimezone).format("HH:mm")}`;
        }
        return `Advanced cron: ${msg.cronExpression}`;
    };

    const summarizeCatchUp = (msg: ScheduledMessage) => {
        const rule = parseRule(msg.recurrenceRule);
        if (!msg.cronExpression) return "Not applicable";
        return (rule?.catchUpMode || "send") === "send" ? "Send missed run when app starts" : "Skip missed run";
    };

    const summarizeMentions = (mentions?: MentionConfig | null) => {
        const config = normalizeMentionConfig(mentions);
        if (config.mode === "everyone") return "Everyone in group";
        if (config.mode === "selected") return `${config.jids.length} selected`;
        return "None";
    };

    const resolveRecipientName = (jid: string) => {
        if (jid.includes("@g.us")) {
            const normalizedJid = jid.trim().includes("@") ? jid.trim() : `${jid.trim()}@g.us`;
            const group = groups.find(g => g.jid === normalizedJid);
            if (group?.subject) return group.subject;
            return jid.split('@')[0];
        }

        const phone = jid.split('@')[0];
        const contact = contacts.find(c => c.jid.split('@')[0] === phone || c.jid === jid);
        if (contact) {
            return contact.name || contact.notify || contact.verifiedName || phone;
        }

        return jid.split('@')[0];
    };

    const renderMentionPicker = (
        jidType: string,
        jid: string,
        setJid: (value: string) => void,
        groupSearch: string,
        setGroupSearch: (value: string) => void,
        groupPickerOpen: boolean,
        setGroupPickerOpen: (value: boolean) => void,
        mode: MentionMode,
        setMode: (value: MentionMode) => void,
        selectedJids: string[],
        setSelectedJids: (value: string[]) => void,
        members: GroupMember[],
        memberSearch: string,
        setMemberSearch: (value: string) => void,
        membersLoading: boolean,
        memberPickerOpen: boolean,
        setMemberPickerOpen: (value: boolean) => void,
        isCreateForm = false
    ) => {
        if (jidType !== "group") return null;

        const normalizedJid = normalizeGroupJid(jid);
        const selectedGroup = groups.find(group => group.jid === normalizedJid);
        const groupQuery = groupSearch.trim().toLowerCase();
        const isGroupIdQuery = /^\d+(?:-\d+)?(?:@g\.us)?$/.test(groupQuery);
        const filteredGroups = groups.filter(group => {
            const label = group.subject || group.jid.split("@")[0];
            return label.toLowerCase().includes(groupQuery) || group.jid.toLowerCase().includes(groupQuery);
        });
        const filteredMembers = members.filter(member => {
            const q = memberSearch.toLowerCase();
            return member.name.toLowerCase().includes(q) || member.phone.includes(q) || member.jid.toLowerCase().includes(q);
        });

        const selectedSet = new Set(selectedJids);
        const toggleMember = (memberJid: string, checked: boolean) => {
            if (checked) setSelectedJids([...new Set([...selectedJids, memberJid])]);
            else setSelectedJids(selectedJids.filter(item => item !== memberJid));
        };

        return (
            <div className="rounded-lg border bg-slate-50 p-4 space-y-4">
                <div className="flex items-start gap-2">
                    <Users className="h-4 w-4 mt-1 text-muted-foreground" />
                    <div>
                        <Label className="font-semibold">Group recipient and mentions</Label>
                        <p className="text-xs text-muted-foreground">Search for a group, then choose who should be tagged in the message.</p>
                    </div>
                </div>

                <div className="space-y-2">
                    <Label>Pick Group</Label>
                    <Popover open={groupPickerOpen} onOpenChange={setGroupPickerOpen}>
                        <PopoverTrigger asChild>
                            <Button type="button" variant="outline" role="combobox" aria-expanded={groupPickerOpen} className="w-full justify-between font-normal">
                                <span className={selectedGroup || jid ? "truncate" : "truncate text-muted-foreground"}>
                                    {groupsLoading ? "Loading groups..." : selectedGroup?.subject || (jid ? `Group ${normalizedJid.split("@")[0]}` : "Search and select a group")}
                                </span>
                                <span className="flex items-center gap-1">
                                    {jid && (
                                        <span
                                            role="button"
                                            tabIndex={0}
                                            aria-label="Clear selected group"
                                            className="rounded-sm p-0.5 hover:bg-slate-100"
                                            onClick={(event) => { event.stopPropagation(); setJid(""); setGroupSearch(""); }}
                                            onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.stopPropagation(); setJid(""); setGroupSearch(""); } }}
                                        ><X className="h-4 w-4" /></span>
                                    )}
                                    <ChevronsUpDown className="h-4 w-4 opacity-50" />
                                </span>
                            </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-2" align="start">
                            <div className="mb-2 flex items-center justify-between gap-2 border-b pb-2">
                                <span className="text-xs text-muted-foreground">{groups.length} group{groups.length === 1 ? "" : "s"} available</span>
                                {isCreateForm && selectedSessionId && <Button type="button" variant="ghost" size="sm" onClick={() => fetchGroups(selectedSessionId, true)} disabled={groupsLoading}><RefreshCw className={`mr-1 h-3.5 w-3.5 ${groupsLoading ? "animate-spin" : ""}`} />Refresh groups</Button>}
                            </div>
                            <div className="relative mb-2">
                                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                                <Input autoFocus value={groupSearch} onChange={event => setGroupSearch(event.target.value)} placeholder="Search group name or ID" className="pl-8 pr-8" />
                                {groupSearch && <Button type="button" variant="ghost" size="icon" aria-label="Clear group search" className="absolute right-0 top-0 h-9 w-9" onClick={() => setGroupSearch("")}><X className="h-4 w-4" /></Button>}
                            </div>
                            <div className="max-h-60 overflow-y-auto space-y-1">
                                {isGroupIdQuery && (
                                    <button type="button" className="w-full rounded-md px-3 py-2 text-left hover:bg-slate-100 text-primary bg-primary/5 font-medium" onClick={() => { setJid(groupQuery.includes("@") ? groupQuery : `${groupQuery.replace(/\D/g, "")}@g.us`); setGroupSearch(""); setGroupPickerOpen(false); }}>
                                        <div className="text-sm">Use group ID: {groupQuery.includes("@") ? groupQuery : `${groupQuery.replace(/\D/g, "")}@g.us`}</div>
                                    </button>
                                )}
                                {groupsLoading ? (
                                    <div className="px-2 py-6 text-center text-sm text-muted-foreground">Loading groups...</div>
                                ) : filteredGroups.length === 0 && !groupQuery ? (
                                    <div className="px-2 py-6 text-center text-sm text-muted-foreground">{groupsError || "No matching groups found."}</div>
                                ) : filteredGroups.slice(0, 50).map(group => (
                                    <button type="button" key={group.jid} className={`w-full rounded-md px-3 py-2 text-left hover:bg-slate-100 ${group.jid === normalizedJid ? "bg-slate-100" : ""}`} onClick={() => { setJid(group.jid); setGroupSearch(""); setGroupPickerOpen(false); }}>
                                        <div className="truncate text-sm font-medium">{group.subject || `Group ${group.jid.split("@")[0]}`}</div>
                                        <div className="truncate text-xs text-muted-foreground">{group.jid}</div>
                                    </button>
                                ))}
                            </div>
                        </PopoverContent>
                    </Popover>
                </div>

                <div className="space-y-2">
                    <Label>Mention mode</Label>
                    <RadioGroup value={mode} onValueChange={(value) => setMode(value as MentionMode)} className="grid gap-2 sm:grid-cols-3">
                        <div className="flex items-center space-x-2 rounded-md border bg-white p-2">
                            <RadioGroupItem value="none" id={`mentions-none-${jid}`} />
                            <Label htmlFor={`mentions-none-${jid}`} className="cursor-pointer">No mentions</Label>
                        </div>
                        <div className="flex items-center space-x-2 rounded-md border bg-white p-2">
                            <RadioGroupItem value="selected" id={`mentions-selected-${jid}`} />
                            <Label htmlFor={`mentions-selected-${jid}`} className="cursor-pointer">Selected people</Label>
                        </div>
                        <div className="flex items-center space-x-2 rounded-md border bg-white p-2">
                            <RadioGroupItem value="everyone" id={`mentions-everyone-${jid}`} />
                            <Label htmlFor={`mentions-everyone-${jid}`} className="cursor-pointer">Everyone</Label>
                        </div>
                    </RadioGroup>
                </div>

                {mode === "selected" && (
                    <div className="space-y-3 rounded-md border bg-white p-3">
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                            <div className="flex items-center gap-2 text-sm font-medium"><AtSign className="h-4 w-4" /> {selectedJids.length} selected</div>
                            <div className="flex gap-2">
                                <Button type="button" variant="outline" size="sm" onClick={() => setSelectedJids([...new Set([...selectedJids, ...filteredMembers.map(member => member.jid)])])} disabled={!filteredMembers.length}>Select results</Button>
                                <Button type="button" variant="ghost" size="sm" onClick={() => setSelectedJids([])}>Clear</Button>
                            </div>
                        </div>
                        <Popover open={memberPickerOpen} onOpenChange={setMemberPickerOpen}>
                            <PopoverTrigger asChild>
                                <Button type="button" variant="outline" role="combobox" aria-expanded={memberPickerOpen} disabled={!jid || membersLoading} className="w-full justify-between font-normal">
                                    <span className="truncate">{membersLoading ? "Loading group members..." : !jid ? "Select a group first" : "Search and add people"}</span>
                                    <ChevronsUpDown className="h-4 w-4 opacity-50" />
                                </Button>
                            </PopoverTrigger>
                            <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-2" align="start">
                                <div className="relative mb-2">
                                    <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                                    <Input autoFocus value={memberSearch} onChange={event => setMemberSearch(event.target.value)} placeholder="Search name or phone" className="pl-8 pr-8" />
                                    {memberSearch && <Button type="button" variant="ghost" size="icon" aria-label="Clear people search" className="absolute right-0 top-0 h-9 w-9" onClick={() => setMemberSearch("")}><X className="h-4 w-4" /></Button>}
                                </div>
                                <div className="max-h-60 overflow-y-auto space-y-1">
                                    {filteredMembers.length === 0 ? (
                                        <div className="px-2 py-6 text-center text-sm text-muted-foreground">No matching people found.</div>
                                    ) : filteredMembers.map(member => (
                                        <label key={member.jid} className="flex cursor-pointer items-center justify-between gap-3 rounded-md px-3 py-2 hover:bg-slate-100">
                                            <div className="min-w-0"><div className="truncate text-sm font-medium">{member.name}</div><div className="truncate text-xs text-muted-foreground">{member.phone}{member.admin ? ` • ${member.admin}` : ""}</div></div>
                                            <Checkbox checked={selectedSet.has(member.jid)} onCheckedChange={(checked) => toggleMember(member.jid, checked === true)} />
                                        </label>
                                    ))}
                                </div>
                            </PopoverContent>
                        </Popover>
                        {selectedJids.length > 0 && (
                            <div className="flex flex-wrap gap-2" aria-label="Selected people">
                                {selectedJids.map(selectedJid => {
                                    const member = members.find(item => item.jid === selectedJid);
                                    return <span key={selectedJid} className="inline-flex max-w-full items-center gap-1 rounded-full bg-primary/10 px-2.5 py-1 text-xs text-primary"><span className="truncate">{member?.name || member?.phone || selectedJid.split("@")[0]}</span><button type="button" aria-label={`Remove ${member?.name || member?.phone || "person"}`} onClick={() => toggleMember(selectedJid, false)} className="rounded-full p-0.5 hover:bg-primary/10"><X className="h-3 w-3" /></button></span>;
                                })}
                            </div>
                        )}
                    </div>
                )}

                {mode === "everyone" && (
                    <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                        Everyone will be resolved at send time, so new group members are included and removed members are skipped.
                    </div>
                )}
            </div>
        );
    };

    const renderContactPicker = (
        jid: string,
        setJid: (value: string) => void,
        search: string,
        setSearch: (value: string) => void,
        isOpen: boolean,
        setIsOpen: (value: boolean) => void
    ) => {
        const cleanJid = jid.trim();
        const selectedContact = contacts.find(c => contactPhone(c) === cleanJid || contactPhoneJid(c) === cleanJid || c.jid === cleanJid || c.lid === cleanJid);
        const query = search.trim().toLowerCase();

        const filteredContacts = contacts.filter(contact => {
            const name = contact.name || contact.notify || contact.verifiedName || "";
            const phone = contactPhone(contact) || "";
            return name.toLowerCase().includes(query) || phone.includes(query) || contact.jid.toLowerCase().includes(query) || Boolean(contact.lid?.toLowerCase().includes(query));
        });

        const isQueryNumeric = /^[0-9]+$/.test(query);

        return (
            <div className="space-y-2">
                <Label>Recipient contact</Label>
                <Popover open={isOpen} onOpenChange={setIsOpen}>
                    <PopoverTrigger asChild>
                        <Button type="button" variant="outline" role="combobox" aria-expanded={isOpen} className="w-full justify-between font-normal">
                            <span className="truncate">
                                {selectedContact
                                    ? `${selectedContact.name || selectedContact.notify || selectedContact.verifiedName || contactPhone(selectedContact) || "WhatsApp contact"}${contactPhone(selectedContact) ? ` (+${contactPhone(selectedContact)})` : " (phone unavailable)"}`
                                    : (jid ? jid : "Search and select a contact")}
                            </span>
                            <span className="flex items-center gap-1">
                                {jid && (
                                    <span
                                        role="button"
                                        tabIndex={0}
                                        aria-label="Clear selected contact"
                                        className="rounded-sm p-0.5 hover:bg-slate-100"
                                        onClick={(event) => { event.stopPropagation(); setJid(""); setSearch(""); }}
                                        onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.stopPropagation(); setJid(""); setSearch(""); } }}
                                    ><X className="h-4 w-4" /></span>
                                )}
                                <ChevronsUpDown className="h-4 w-4 opacity-50" />
                            </span>
                        </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-2" align="start">
                        <div className="relative mb-2">
                            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                            <Input autoFocus value={search} onChange={event => setSearch(event.target.value)} placeholder="Search contact name or phone" className="pl-8 pr-8" />
                            {search && <Button type="button" variant="ghost" size="icon" aria-label="Clear contact search" className="absolute right-0 top-0 h-9 w-9" onClick={() => setSearch("")}><X className="h-4 w-4" /></Button>}
                        </div>
                        <div className="max-h-60 overflow-y-auto space-y-1">
                            {filteredContacts.length === 0 && !isQueryNumeric && (
                                <div className="px-2 py-6 text-center text-sm text-muted-foreground">No matching contacts found.</div>
                            )}
                            {isQueryNumeric && (
                                <button type="button" className="w-full rounded-md px-3 py-2 text-left hover:bg-slate-100 text-primary bg-primary/5 font-medium" onClick={() => { setJid(query); setSearch(""); setIsOpen(false); }}>
                                    <div className="text-sm">Use custom number: {query}</div>
                                </button>
                            )}
                            {filteredContacts.slice(0, 50).map(contact => {
                                const phone = contactPhone(contact);
                                const label = contact.name || contact.notify || contact.verifiedName || phone || "WhatsApp contact";
                                return (
                                    <button type="button" key={contact.jid} disabled={!phone} className={`w-full rounded-md px-3 py-2 text-left hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60 ${phone === jid ? "bg-slate-100" : ""}`} onClick={() => { if (!phone) return; setJid(phone); setSearch(""); setIsOpen(false); }}>
                                        <div className="truncate text-sm font-medium">{label}</div>
                                        <div className="truncate text-xs text-muted-foreground">{phone ? `+${phone}` : "Phone number unavailable · WhatsApp internal contact"}</div>
                                    </button>
                                );
                            })}
                        </div>
                    </PopoverContent>
                </Popover>
            </div>
        );
    };


    const renderRecurrenceForm = (
        isRec: string, setRec: any, 
        type: string, setType: any, 
        mins: number, setMins: any, 
        hrs: number, setHrs: any, 
        days: number[], setDays: any, 
        cron: string, setCron: any,
        sendAtStr: string, setSendAtStr: any,
        sendTimeStr: string, setSendTimeStr: any,
        catchUp: string, setCatchUp: any
    ) => (
        <div className="space-y-4 border p-4 rounded-md bg-slate-50 mt-4">
            <Label className="font-semibold text-base">Schedule Type</Label>
            <RadioGroup value={isRec} onValueChange={setRec} className="flex gap-4">
                <div className="flex items-center space-x-2">
                    <RadioGroupItem value="once" id={`r-once-${type}`} />
                    <Label htmlFor={`r-once-${type}`}>One-time</Label>
                </div>
                <div className="flex items-center space-x-2">
                    <RadioGroupItem value="recurring" id={`r-rec-${type}`} />
                    <Label htmlFor={`r-rec-${type}`}>Recurring</Label>
                </div>
            </RadioGroup>

            {isRec === "once" && (
                <div className="space-y-2 mt-4 pt-4 border-t border-slate-200">
                    <Label>Send At (Date & Time)</Label>
                    <Input type="datetime-local" step="1" value={sendAtStr} onChange={e => setSendAtStr(e.target.value)} />
                    <p className="text-xs text-muted-foreground">The exact date and time this message will be sent.</p>
                </div>
            )}

            {isRec === "recurring" && (
                <div className="space-y-4 mt-4 pt-4 border-t border-slate-200">
                    <div className="space-y-2">
                        <Label>Recurrence Rule</Label>
                        <Select value={type} onValueChange={setType}>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                                <SelectItem value="minutes">Every N minutes</SelectItem>
                                <SelectItem value="hours">Every N hours</SelectItem>
                                <SelectItem value="days">Specific days of week</SelectItem>
                                <SelectItem value="cron">Advanced (Cron Expression)</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>

                    {type === "minutes" && (
                        <div className="space-y-2">
                            <Label>Interval (Minutes)</Label>
                            <Input type="number" min={1} value={mins} onChange={e => setMins(parseInt(e.target.value) || 1)} />
                        </div>
                    )}

                    {type === "hours" && (
                        <div className="space-y-2">
                            <Label>Interval (Hours)</Label>
                            <Input type="number" min={1} value={hrs} onChange={e => setHrs(parseInt(e.target.value) || 1)} />
                        </div>
                    )}

                    {type === "days" && (
                        <div className="space-y-3">
                            <Label>Select Days</Label>
                            <div className="grid grid-cols-4 gap-2">
                                {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day, idx) => {
                                    const checked = days.includes(idx);
                                    return (
                                        <label key={day} className="flex items-center gap-2 cursor-pointer border rounded bg-white p-2 text-sm justify-center hover:bg-slate-50">
                                            <Checkbox checked={checked} onCheckedChange={(val) => {
                                                if (val) setDays([...days, idx]);
                                                else setDays(days.filter(d => d !== idx));
                                            }} />
                                            <span>{day}</span>
                                        </label>
                                    );
                                })}
                            </div>
                            <div className="space-y-2 mt-2">
                                <Label>Time of Day to Send</Label>
                                <Input type="time" value={sendTimeStr} onChange={e => setSendTimeStr(e.target.value)} />
                                <p className="text-xs text-muted-foreground">The message will send at this exact time on the selected days.</p>
                            </div>
                        </div>
                    )}

                    {type === "cron" && (
                        <div className="space-y-2">
                            <Label>Cron Expression</Label>
                            <Input value={cron} onChange={e => setCron(e.target.value)} placeholder="* * * * *" />
                            <p className="text-xs text-muted-foreground">Standard 5-field cron syntax (Min Hour DayOfMonth Month DayOfWeek)</p>
                        </div>
                    )}

                    <div className="space-y-2 pt-2 border-t border-slate-200">
                        <Label>Missed Runs (Catch-up Mode)</Label>
                        <RadioGroup value={catchUp} onValueChange={setCatchUp} className="flex gap-4">
                            <div className="flex items-center space-x-2">
                                <RadioGroupItem value="send" id={`cu-send-${type}`} />
                                <Label htmlFor={`cu-send-${type}`}>Send immediately</Label>
                            </div>
                            <div className="flex items-center space-x-2">
                                <RadioGroupItem value="skip" id={`cu-skip-${type}`} />
                                <Label htmlFor={`cu-skip-${type}`}>Skip</Label>
                            </div>
                        </RadioGroup>
                        <p className="text-xs text-muted-foreground">What happens if the app was offline when the message was scheduled to send.</p>
                    </div>
                </div>
            )}
        </div>
    );

    return (
        <SessionGuard>
            <div className="space-y-6">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                    <div>
                        <h1 className="text-3xl font-bold tracking-tight">Message Scheduler</h1>
                        <p className="text-muted-foreground">Plan and automate messaging queues for contacts, groups, and news channels.</p>
                    </div>
                    <div className="flex gap-2 w-full sm:w-auto">
                        <Button variant="outline" size="sm" className="flex-1 sm:flex-none" onClick={() => selectedSessionId && fetchMessages(selectedSessionId, activeTab)} disabled={loading || !selectedSessionId}>
                            <RefreshCw className={`h-4 w-4 mr-1 sm:mr-2 ${loading ? 'animate-spin' : ''}`} />
                            Refresh
                        </Button>
                        <Button size="sm" className="flex-1 sm:flex-none" onClick={openNewScheduleForm} disabled={!selectedSessionId}>
                            <Plus className="h-4 w-4 mr-1 sm:mr-2" /> Schedule
                        </Button>
                    </div>
                </div>

                <SearchFilter
                    placeholder="Search schedules..."
                    onSearch={setSearchTerm}
                />

                {showForm && (
                    <Card className="border-2 border-primary/20">
                        <CardHeader>
                            <CardTitle>Schedule New Message</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="space-y-3">
                                <div className="flex justify-between items-center">
                                    <Label>Recipient</Label>
                                    <RadioGroup value={newJidType} onValueChange={(value) => { setNewJidType(value); setNewJid(""); setNewGroupSearch(""); setNewMentionMode("none"); setNewMentionJids([]); setNewContactSearch(""); }} className="flex gap-4">
                                        <div className="flex items-center space-x-2">
                                            <RadioGroupItem value="personal" id="new-personal" />
                                            <Label htmlFor="new-personal" className="cursor-pointer">Personal</Label>
                                        </div>
                                        <div className="flex items-center space-x-2">
                                            <RadioGroupItem value="group" id="new-group" />
                                            <Label htmlFor="new-group" className="cursor-pointer">Group</Label>
                                        </div>
                                        <div className="flex items-center space-x-2">
                                            <RadioGroupItem value="newsletter" id="new-newsletter" />
                                            <Label htmlFor="new-newsletter" className="cursor-pointer">Newsletter</Label>
                                        </div>
                                    </RadioGroup>
                                </div>
                                {newJidType === "personal" && renderContactPicker(
                                    newJid,
                                    setNewJid,
                                    newContactSearch,
                                    setNewContactSearch,
                                    newContactPickerOpen,
                                    setNewContactPickerOpen
                                )}
                                {newJidType === "newsletter" && (
                                    <Input value={newJid} onChange={e => setNewJid(e.target.value)} placeholder="120363... (Channel ID)" />
                                )}
                            </div>

                            {renderMentionPicker(
                                newJidType,
                                newJid,
                                setNewJid,
                                newGroupSearch,
                                setNewGroupSearch,
                                newGroupPickerOpen,
                                setNewGroupPickerOpen,
                                newMentionMode,
                                setNewMentionMode,
                                newMentionJids,
                                setNewMentionJids,
                                newGroupMembers,
                                newMemberSearch,
                                setNewMemberSearch,
                                newMembersLoading,
                                newMemberPickerOpen,
                                setNewMemberPickerOpen,
                                true
                            )}
                            
                            {renderRecurrenceForm(
                                isRecurring, setIsRecurring, 
                                recurrenceType, setRecurrenceType, 
                                recurringMinutes, setRecurringMinutes, 
                                recurringHours, setRecurringHours, 
                                recurringDays, setRecurringDays, 
                                customCron, setCustomCron,
                                newSendAt, setNewSendAt,
                                newSendTime, setNewSendTime,
                                catchUpMode, setCatchUpMode
                            )}

                            <div className="space-y-2 mt-4">
                                <Label>Message (Optional)</Label>
                                <Textarea value={newContent} onChange={e => setNewContent(e.target.value)} placeholder="Hello!" />
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <Label>Media URL (Optional)</Label>
                                    <Input value={newMediaUrl} onChange={e => setNewMediaUrl(e.target.value)} placeholder="https://..." />
                                </div>
                                <div className="space-y-2">
                                    <Label>Media Type</Label>
                                    <Select value={newMediaType} onValueChange={setNewMediaType}>
                                        <SelectTrigger><SelectValue /></SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="image">Image</SelectItem>
                                            <SelectItem value="video">Video</SelectItem>
                                            <SelectItem value="document">Document</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                            </div>
                            <div className="flex justify-end gap-2 mt-4">
                                <Button variant="ghost" onClick={() => setShowForm(false)}>Cancel</Button>
                                <Button onClick={handleSaveSchedule} disabled={(!newContent && !newMediaUrl) || !newJid}>Schedule</Button>
                            </div>
                        </CardContent>
                    </Card>
                )}

                <Tabs value={activeTab} onValueChange={setActiveTab}>
                    <TabsList className="mb-4">
                        <TabsTrigger value="pending">Pending Queue</TabsTrigger>
                        <TabsTrigger value="history">History Logs</TabsTrigger>
                    </TabsList>
                    <TabsContent value="pending" className="mt-0">
                        {loading ? <div className="text-center p-8">Loading...</div> : filteredMessages.length === 0 ? <div className="text-center p-8 text-muted-foreground border rounded bg-slate-50">No pending messages.</div> : (
                            <div className="grid gap-4">
                                {filteredMessages.map(msg => (
                                    <Card key={msg.id}>
                                        <CardContent className="flex flex-col sm:flex-row justify-between p-4 gap-4">
                                            <div>
                                                <div className="font-bold flex items-center gap-2">
                                                    {msg.recipientName || resolveRecipientName(msg.jid)}
                                                    {msg.jid.includes("@g.us") ? <span className="text-xs px-2 py-0.5 rounded font-normal bg-purple-100 text-purple-800">Group</span> : null}
                                                    {msg.jid.includes("@newsletter") ? <span className="text-xs px-2 py-0.5 rounded font-normal bg-orange-100 text-orange-800">Channel</span> : null}
                                                    <span className="text-xs px-2 py-0.5 rounded font-normal bg-yellow-100 text-yellow-800">{msg.status}</span>
                                                    {msg.cronExpression && <span className="text-xs px-2 py-0.5 rounded font-normal bg-blue-100 text-blue-800">Recurring</span>}
                                                </div>
                                                <div className="text-sm font-medium mt-1">{msg.content || "[Media Only]"}</div>
                                                <div className="text-xs text-muted-foreground mt-1 flex items-center gap-1"><Clock3 className="h-3 w-3" /> Rule: {summarizeRule(msg)}</div>
                                                <div className="text-xs text-muted-foreground mt-1">Catch-up: {summarizeCatchUp(msg)}</div>
                                                {msg.jid.includes("@g.us") && <div className="text-xs text-muted-foreground mt-1">Mentions: {summarizeMentions(msg.mentions)}</div>}
                                                <div className="text-xs text-muted-foreground mt-1">Next Run: {moment(msg.sendAt).tz(systemTimezone).format('YYYY-MM-DD HH:mm:ss')}</div>
                                                {msg.lastRun && <div className="text-xs text-muted-foreground mt-1">Last run: {msg.lastRun.status} · {moment(msg.lastRun.processedAt).tz(systemTimezone).format('YYYY-MM-DD HH:mm:ss')}</div>}
                                            </div>
                                            <div className="flex gap-2">
                                                <Button variant="ghost" size="sm" onClick={() => handleEdit(msg)}>Edit</Button>
                                                <Button variant="ghost" size="icon" onClick={() => setDeleteId(msg.id)} className="text-red-500 hover:bg-red-50"><Trash2 className="w-4 h-4" /></Button>
                                            </div>
                                        </CardContent>
                                    </Card>
                                ))}
                            </div>
                        )}
                    </TabsContent>
                    <TabsContent value="history" className="mt-0">
                        {loading ? <div className="text-center p-8">Loading...</div> : filteredMessages.length === 0 ? <div className="text-center p-8 text-muted-foreground border rounded bg-slate-50">No history found.</div> : (
                            <div className="grid gap-4">
                                {filteredMessages.map(msg => (
                                    <Card key={msg.id} className="opacity-80">
                                        <CardContent className="flex flex-col sm:flex-row justify-between p-4 gap-4">
                                            <div>
                                                <div className="font-bold flex items-center gap-2">
                                                    {msg.recipientName || resolveRecipientName(msg.jid)}
                                                    {msg.jid.includes("@g.us") ? <span className="text-xs px-2 py-0.5 rounded font-normal bg-purple-100 text-purple-800">Group</span> : null}
                                                    {msg.jid.includes("@newsletter") ? <span className="text-xs px-2 py-0.5 rounded font-normal bg-orange-100 text-orange-800">Channel</span> : null}
                                                    {msg.status === 'SENT' ? <span className="text-xs px-2 py-0.5 rounded font-normal bg-green-100 text-green-800 flex items-center gap-1"><CheckCircle2 className="w-3 h-3"/> Sent</span> : <span className="text-xs px-2 py-0.5 rounded font-normal bg-red-100 text-red-800 flex items-center gap-1"><XCircle className="w-3 h-3"/> {msg.status === 'UNCONFIRMED' ? 'Unconfirmed' : 'Failed'}</span>}
                                                </div>
                                                <div className="text-sm font-medium mt-1">{msg.content || "[Media Only]"}</div>
                                                <div className="text-xs text-muted-foreground mt-1">Processed: {moment(msg.processedAt || msg.sendAt).tz(systemTimezone).format('YYYY-MM-DD HH:mm:ss')}</div>
                                                {msg.error && <div className="text-xs text-red-700 mt-1">{msg.error}</div>}
                                            </div>
                                            <div className="flex gap-2">
                                                {!msg.isRun && <Button variant="ghost" size="icon" onClick={() => setDeleteId(msg.id)} className="text-red-500 hover:bg-red-50"><Trash2 className="w-4 h-4" /></Button>}
                                            </div>
                                        </CardContent>
                                    </Card>
                                ))}
                            </div>
                        )}
                    </TabsContent>
                </Tabs>

                <AlertDialog open={!!deleteId} onOpenChange={(o) => !o && setDeleteId(null)}>
                    <AlertDialogContent>
                        <AlertDialogHeader>
                            <AlertDialogTitle>Delete Record?</AlertDialogTitle>
                            <AlertDialogDescription>Are you sure you want to delete this schedule record?</AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction onClick={confirmDelete} className="bg-red-600">Delete</AlertDialogAction>
                        </AlertDialogFooter>
                    </AlertDialogContent>
                </AlertDialog>

                <Dialog open={isEditOpen} onOpenChange={o => !o && setIsEditOpen(false)}>
                    <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
                        <DialogHeader>
                            <DialogTitle>Edit Schedule</DialogTitle>
                        </DialogHeader>
                        <div className="space-y-4 py-4">
                            <div className="space-y-3">
                                <div className="flex justify-between items-center">
                                    <Label>Recipient</Label>
                                    <RadioGroup value={editJidType} onValueChange={(value) => { setEditJidType(value); setEditJid(""); setEditGroupSearch(""); setEditMentionMode("none"); setEditMentionJids([]); setEditContactSearch(""); }} className="flex gap-4">
                                        <div className="flex items-center space-x-2">
                                            <RadioGroupItem value="personal" id="edit-personal" />
                                            <Label htmlFor="edit-personal" className="cursor-pointer">Personal</Label>
                                        </div>
                                        <div className="flex items-center space-x-2">
                                            <RadioGroupItem value="group" id="edit-group" />
                                            <Label htmlFor="edit-group" className="cursor-pointer">Group</Label>
                                        </div>
                                        <div className="flex items-center space-x-2">
                                            <RadioGroupItem value="newsletter" id="edit-newsletter" />
                                            <Label htmlFor="edit-newsletter" className="cursor-pointer">Newsletter</Label>
                                        </div>
                                    </RadioGroup>
                                </div>
                                {editJidType === "personal" && renderContactPicker(
                                    editJid,
                                    setEditJid,
                                    editContactSearch,
                                    setEditContactSearch,
                                    editContactPickerOpen,
                                    setEditContactPickerOpen
                                )}
                                {editJidType === "newsletter" && (
                                    <Input value={editJid} onChange={e => setEditJid(e.target.value)} placeholder="120363... (Channel ID)" />
                                )}
                            </div>

                            {renderMentionPicker(
                                editJidType,
                                editJid,
                                setEditJid,
                                editGroupSearch,
                                setEditGroupSearch,
                                editGroupPickerOpen,
                                setEditGroupPickerOpen,
                                editMentionMode,
                                setEditMentionMode,
                                editMentionJids,
                                setEditMentionJids,
                                editGroupMembers,
                                editMemberSearch,
                                setEditMemberSearch,
                                editMembersLoading,
                                editMemberPickerOpen,
                                setEditMemberPickerOpen
                            )}
                            
                            {renderRecurrenceForm(
                                editIsRecurring, setEditIsRecurring, 
                                editRecurrenceType, setEditRecurrenceType, 
                                editRecurringMinutes, setEditRecurringMinutes, 
                                editRecurringHours, setEditRecurringHours, 
                                editRecurringDays, setEditRecurringDays, 
                                editCustomCron, setEditCustomCron,
                                editSendAt, setEditSendAt,
                                editSendTime, setEditSendTime,
                                editCatchUpMode, setEditCatchUpMode
                            )}

                            <div className="space-y-2 mt-4">
                                <Label>Message (Optional)</Label>
                                <Textarea value={editContent} onChange={e => setEditContent(e.target.value)} />
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <Label>Media URL (Optional)</Label>
                                    <Input value={editMediaUrl} onChange={e => setEditMediaUrl(e.target.value)} />
                                </div>
                                <div className="space-y-2">
                                    <Label>Media Type</Label>
                                    <Select value={editMediaType} onValueChange={setEditMediaType}>
                                        <SelectTrigger><SelectValue /></SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="image">Image</SelectItem>
                                            <SelectItem value="video">Video</SelectItem>
                                            <SelectItem value="document">Document</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                            </div>
                        </div>
                        <DialogFooter>
                            <Button variant="ghost" onClick={() => setIsEditOpen(false)}>Cancel</Button>
                            <Button onClick={handleUpdateSchedule} disabled={(!editContent && !editMediaUrl) || !editJid}>Save Changes</Button>
                        </DialogFooter>
                    </DialogContent>
                </Dialog>
            </div>
        </SessionGuard>
    );
}

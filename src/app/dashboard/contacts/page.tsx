
"use client";

import { useState, useEffect } from "react";
import { useSession } from "@/components/dashboard/session-provider";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow
} from "@/components/ui/table";
import {
    Pagination,
    PaginationContent,
    PaginationItem,
    PaginationLink,
    PaginationNext,
    PaginationPrevious
} from "@/components/ui/pagination";

import { Search, Loader2, User, RefreshCw, Copy, CheckCircle2, AlertCircle, MessageCircle } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { SessionGuard } from "@/components/dashboard/session-guard";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import Link from "next/link";

interface Contact {
    id: string;
    jid: string;
    name?: string;
    notify?: string;
    verifiedName?: string;
    profilePic?: string;
    remoteJidAlt?: string;
    lid?: string;
    phone?: string;
    identityStatus: "RESOLVED" | "UNAVAILABLE";
}

const formatPhone = (phone?: string) => {
    if (!phone) return null;
    const digits = phone.replace(/\D/g, "");
    if (digits.startsWith("91") && digits.length === 12) {
        return `+91 ${digits.slice(2, 7)} ${digits.slice(7)}`;
    }
    return `+${digits}`;
};

export default function ContactListPage() {
    const { sessionId } = useSession();
    const [contacts, setContacts] = useState<Contact[]>([]);
    const [loading, setLoading] = useState(false);
    const [syncing, setSyncing] = useState(false);

    // Filters
    const [search, setSearch] = useState("");
    const [page, setPage] = useState(1);
    const [limit, setLimit] = useState("10");
    const [identityFilter, setIdentityFilter] = useState<"resolved" | "unavailable">("resolved");
    const [meta, setMeta] = useState({ total: 0, totalPages: 1, resolved: 0, unavailable: 0 });

    // Debounce Search
    useEffect(() => {
        const timer = setTimeout(() => {
            setPage(1); // Reset to page 1 on search
            fetchContacts();
        }, 500);
        return () => clearTimeout(timer);
    }, [search]);

    // Fetch on page/session/limit change
    useEffect(() => {
        fetchContacts();
    }, [page, sessionId, limit, identityFilter]);

    const fetchContacts = async () => {
        if (!sessionId) return;
        setLoading(true);
        try {
            const params = new URLSearchParams({
                page: page.toString(),
                limit: limit,
                search: search,
                identity: identityFilter
            });

            const res = await fetch(`/api/contacts/${sessionId}?${params}`);
            const data = await res.json();

            if (res.ok) {
                setContacts(data.data);
                setMeta(data.meta);
            } else {
                setContacts([]);
            }
        } catch (error) {
            console.error(error);
        } finally {
            setLoading(false);
        }
    };

    const handleSyncContacts = async () => {
        if (!sessionId) return;
        setSyncing(true);
        try {
            const res = await fetch(`/api/contacts/${sessionId}/sync`, {
                method: "POST"
            });
            const data = await res.json();
            if (res.ok && data.status) {
                toast.success(data.message || "Contacts synced successfully");
                fetchContacts();
            } else {
                toast.error(data.message || "Failed to sync contacts");
            }
        } catch (error) {
            console.error(error);
            toast.error("Error syncing contacts to database");
        } finally {
            setSyncing(false);
        }
    };

    return (
        <SessionGuard>
            <div className="space-y-6">
                <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                    <div>
                        <h2 className="text-3xl font-bold tracking-tight">Contacts</h2>
                        <p className="text-muted-foreground">
                            Manage and view your saved contacts.
                        </p>
                    </div>
                    <Button onClick={handleSyncContacts} disabled={syncing || !sessionId}>
                        {syncing ? (
                            <>
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                Syncing Contacts...
                            </>
                        ) : (
                            <>
                                <RefreshCw className="mr-2 h-4 w-4" />
                                Sync Contacts to DB
                            </>
                        )}
                    </Button>
                </div>

                <Card>
                    <CardHeader>
                        <div className="flex flex-col md:flex-row justify-between items-center gap-4">
                            <div className="space-y-1">
                                <CardTitle>Contact List</CardTitle>
                                <CardDescription>
                                    Total: {meta.total} contacts found
                                </CardDescription>
                            </div>
                            <div className="flex items-center gap-2 w-full md:w-auto">
                                <Select value={limit} onValueChange={(val) => { setLimit(val); setPage(1); }}>
                                    <SelectTrigger className="w-[120px]">
                                        <SelectValue placeholder="Per page" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {[10, 25, 50, 100].map((l) => (
                                            <SelectItem key={l} value={l.toString()}>
                                                {l} / page
                                            </SelectItem>
                                        ))}
                                        <SelectItem value="all">Show All</SelectItem>
                                    </SelectContent>
                                </Select>
                                <div className="relative w-full md:w-64">
                                    <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                                    <Input
                                        placeholder="Search contacts..."
                                        className="pl-8"
                                        value={search}
                                        onChange={(e) => setSearch(e.target.value)}
                                    />
                                </div>
                            </div>
                        </div>
                    </CardHeader>
                    <CardContent>
                        <div className="mb-4 flex flex-wrap gap-2" role="group" aria-label="Contact resolution filter">
                            <Button
                                type="button"
                                variant={identityFilter === "resolved" ? "default" : "outline"}
                                size="sm"
                                onClick={() => { setIdentityFilter("resolved"); setPage(1); }}
                            >
                                Contacts with phone ({meta.resolved})
                            </Button>
                            <Button
                                type="button"
                                variant={identityFilter === "unavailable" ? "default" : "outline"}
                                size="sm"
                                onClick={() => { setIdentityFilter("unavailable"); setPage(1); }}
                            >
                                Needs resolution ({meta.unavailable})
                            </Button>
                        </div>
                        <div className="rounded-md border">
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead className="w-[80px]">Image</TableHead>
                                        <TableHead>Contact</TableHead>
                                        <TableHead>Phone number</TableHead>
                                        <TableHead className="hidden md:table-cell">Resolution</TableHead>
                                        <TableHead className="text-right">Actions</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {loading ? (
                                        <TableRow>
                                            <TableCell colSpan={5} className="h-24 text-center">
                                                <div className="flex justify-center items-center gap-2">
                                                    <Loader2 className="h-4 w-4 animate-spin" />
                                                    Loading...
                                                </div>
                                            </TableCell>
                                        </TableRow>
                                    ) : contacts.length === 0 ? (
                                        <TableRow>
                                            <TableCell colSpan={5} className="h-24 text-center">
                                                No contacts found.
                                            </TableCell>
                                        </TableRow>
                                    ) : (
                                        contacts.map((contact) => (
                                            <TableRow key={contact.id}>
                                                <TableCell>
                                                    <Avatar>
                                                        <AvatarImage src={contact.profilePic || ""} />
                                                        <AvatarFallback><User className="h-4 w-4" /></AvatarFallback>
                                                    </Avatar>
                                                </TableCell>
                                                <TableCell>
                                                    <div className="flex flex-col">
                                                        <span className="font-medium">{contact.name || contact.notify || "Unknown"}</span>
                                                        {contact.name && contact.notify && contact.name !== contact.notify && (
                                                            <span className="text-xs text-muted-foreground">{contact.notify}</span>
                                                        )}
                                                        {contact.verifiedName && (
                                                            <span className="text-xs text-green-600 flex items-center gap-1">
                                                                ✓ {contact.verifiedName}
                                                            </span>
                                                        )}
                                                    </div>
                                                </TableCell>
                                                <TableCell>
                                                    {contact.phone ? (
                                                        <div className="flex items-center gap-1.5">
                                                            <span className="font-medium tabular-nums">{formatPhone(contact.phone)}</span>
                                                            <Button
                                                                type="button"
                                                                variant="ghost"
                                                                size="icon"
                                                                className="h-7 w-7"
                                                                aria-label={`Copy ${formatPhone(contact.phone)}`}
                                                                onClick={() => {
                                                                    navigator.clipboard.writeText(`+${contact.phone}`);
                                                                    toast.success("Phone number copied");
                                                                }}
                                                            >
                                                                <Copy className="h-3.5 w-3.5" />
                                                            </Button>
                                                        </div>
                                                    ) : (
                                                        <span className="text-sm text-muted-foreground">Phone unavailable</span>
                                                    )}
                                                </TableCell>
                                                <TableCell className="hidden md:table-cell">
                                                    {contact.identityStatus === "RESOLVED" ? (
                                                        <Badge variant="secondary" className="gap-1 text-green-700">
                                                            <CheckCircle2 className="h-3 w-3" /> Resolved
                                                        </Badge>
                                                    ) : (
                                                        <Badge variant="outline" className="gap-1 text-muted-foreground">
                                                            <AlertCircle className="h-3 w-3" /> Unavailable
                                                        </Badge>
                                                    )}
                                                </TableCell>
                                                <TableCell className="text-right">
                                                    {contact.phone ? (
                                                        <Button asChild variant="outline" size="sm">
                                                            <Link href={`/dashboard/chat?jid=${encodeURIComponent(contact.jid)}`}>
                                                                <MessageCircle className="mr-1.5 h-3.5 w-3.5" />
                                                                Open chat
                                                            </Link>
                                                        </Button>
                                                    ) : (
                                                        <span className="text-xs text-muted-foreground">Waiting for mapping</span>
                                                    )}
                                                </TableCell>
                                            </TableRow>
                                        ))
                                    )}
                                </TableBody>
                            </Table>
                        </div>

                        {/* Pagination */}
                        {meta.totalPages > 1 && (
                            <div className="mt-4">
                                <Pagination>
                                    <PaginationContent>
                                        <PaginationItem>
                                            <Button
                                                variant="ghost"
                                                disabled={page <= 1}
                                                onClick={() => setPage(p => Math.max(1, p - 1))}
                                            >
                                                Previous
                                            </Button>
                                        </PaginationItem>

                                        <PaginationItem>
                                            <span className="text-sm text-muted-foreground mx-4">
                                                Page {page} of {meta.totalPages}
                                            </span>
                                        </PaginationItem>

                                        <PaginationItem>
                                            <Button
                                                variant="ghost"
                                                disabled={page >= meta.totalPages}
                                                onClick={() => setPage(p => Math.min(meta.totalPages, p + 1))}
                                            >
                                                Next
                                            </Button>
                                        </PaginationItem>
                                    </PaginationContent>
                                </Pagination>
                            </div>
                        )}
                    </CardContent>
                </Card>
            </div>
        </SessionGuard>
    );
}


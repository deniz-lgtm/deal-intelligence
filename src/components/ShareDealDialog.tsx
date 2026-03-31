"use client";

import { useState, useEffect, useCallback } from "react";
import { UserPlus, X, Crown, Eye, Edit2, Loader2, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { toast } from "sonner";

interface ShareEntry {
  id: string;
  user_id: string;
  user_email: string;
  user_name: string | null;
  permission: "view" | "edit";
}

interface ShareDealDialogProps {
  dealId: string;
  dealName: string;
  ownerId: string | null;
  currentUserId: string;
}

export default function ShareDealDialog({
  dealId,
  dealName,
  ownerId,
  currentUserId,
}: ShareDealDialogProps) {
  const [open, setOpen] = useState(false);
  const [shares, setShares] = useState<ShareEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState("");
  const [permission, setPermission] = useState<"view" | "edit">("edit");
  const [adding, setAdding] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);

  const isOwner = !ownerId || ownerId === currentUserId;

  const fetchShares = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/deals/${dealId}/share`);
      const json = await res.json();
      if (json.data) setShares(json.data);
    } catch {
      toast.error("Failed to load shares");
    } finally {
      setLoading(false);
    }
  }, [dealId]);

  useEffect(() => {
    if (open) fetchShares();
  }, [open, fetchShares]);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setAdding(true);
    try {
      const res = await fetch(`/api/deals/${dealId}/share`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), permission }),
      });
      const json = await res.json();
      if (!res.ok) {
        toast.error(json.error ?? "Failed to share deal");
        return;
      }
      setShares((prev) => [...prev, json.data]);
      setEmail("");
      toast.success(`Shared with ${email.trim()}`);
    } catch {
      toast.error("Failed to share deal");
    } finally {
      setAdding(false);
    }
  }

  async function handleRemove(userId: string, userEmail: string) {
    setRemovingId(userId);
    try {
      const res = await fetch(`/api/deals/${dealId}/share?userId=${userId}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const json = await res.json();
        toast.error(json.error ?? "Failed to remove access");
        return;
      }
      setShares((prev) => prev.filter((s) => s.user_id !== userId));
      toast.success(`Removed ${userEmail}`);
    } catch {
      toast.error("Failed to remove access");
    } finally {
      setRemovingId(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5 h-7 text-xs">
          <Users className="h-3.5 w-3.5" />
          Share
        </Button>
      </DialogTrigger>

      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-sm font-semibold">
            <UserPlus className="h-4 w-4 text-primary" />
            Share &ldquo;{dealName}&rdquo;
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 pt-1">
          {/* Add user form — only owners can share */}
          {isOwner && (
            <form onSubmit={handleAdd} className="space-y-2">
              <div className="flex gap-2">
                <input
                  type="email"
                  placeholder="teammate@company.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="flex-1 h-8 px-3 text-xs rounded-md border border-border bg-background focus:outline-none focus:ring-1 focus:ring-primary"
                  disabled={adding}
                />
                <select
                  value={permission}
                  onChange={(e) => setPermission(e.target.value as "view" | "edit")}
                  className="h-8 px-2 text-xs rounded-md border border-border bg-background focus:outline-none focus:ring-1 focus:ring-primary"
                  disabled={adding}
                >
                  <option value="edit">Can edit</option>
                  <option value="view">Can view</option>
                </select>
                <Button type="submit" size="sm" className="h-8 text-xs" disabled={adding || !email.trim()}>
                  {adding ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Invite"}
                </Button>
              </div>
              <p className="text-2xs text-muted-foreground">
                The person must have signed in at least once before you can share with them.
              </p>
            </form>
          )}

          {/* Current access list */}
          <div className="space-y-1">
            <p className="text-2xs font-medium text-muted-foreground uppercase tracking-wide">
              People with access
            </p>

            {loading ? (
              <div className="flex items-center justify-center py-4">
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              </div>
            ) : shares.length === 0 ? (
              <p className="text-xs text-muted-foreground py-3 text-center">
                Only you have access to this deal.
              </p>
            ) : (
              <div className="divide-y divide-border/40 rounded-lg border border-border/40 overflow-hidden">
                {shares.map((share) => (
                  <div
                    key={share.user_id}
                    className="flex items-center gap-3 px-3 py-2 bg-card/50"
                  >
                    {/* Avatar placeholder */}
                    <div className="h-6 w-6 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0">
                      <span className="text-2xs font-medium text-primary">
                        {(share.user_name ?? share.user_email)[0].toUpperCase()}
                      </span>
                    </div>

                    <div className="flex-1 min-w-0">
                      {share.user_name && (
                        <p className="text-xs font-medium truncate">{share.user_name}</p>
                      )}
                      <p className="text-2xs text-muted-foreground truncate">{share.user_email}</p>
                    </div>

                    <div className="flex items-center gap-1.5">
                      <span className="flex items-center gap-1 text-2xs text-muted-foreground">
                        {share.permission === "edit" ? (
                          <Edit2 className="h-3 w-3" />
                        ) : (
                          <Eye className="h-3 w-3" />
                        )}
                        {share.permission === "edit" ? "Editor" : "Viewer"}
                      </span>

                      {(isOwner || share.user_id === currentUserId) && (
                        <button
                          onClick={() => handleRemove(share.user_id, share.user_email)}
                          disabled={removingId === share.user_id}
                          className="ml-1 h-5 w-5 rounded flex items-center justify-center text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                          title="Remove access"
                        >
                          {removingId === share.user_id ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <X className="h-3 w-3" />
                          )}
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Owner badge */}
          <div className="flex items-center gap-2 text-2xs text-muted-foreground">
            <Crown className="h-3 w-3 text-amber-400" />
            <span>
              {ownerId
                ? ownerId === currentUserId
                  ? "You own this deal"
                  : "You have shared access"
                : "This is a shared workspace deal"}
            </span>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

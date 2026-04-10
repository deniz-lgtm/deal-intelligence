"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import type { SiteWalk, SiteWalkStatus } from "@/lib/types";

interface Props {
  dealId: string;
  walk: SiteWalk | null;
  onSaved: (walk: SiteWalk) => void;
  onCancel: () => void;
}

const STATUS_OPTIONS: SiteWalkStatus[] = ["draft", "in_progress", "completed"];

export default function SiteWalkForm({ dealId, walk, onSaved, onCancel }: Props) {
  const [title, setTitle] = useState(walk?.title ?? "");
  const [walkDate, setWalkDate] = useState(
    walk?.walk_date ? walk.walk_date.slice(0, 10) : new Date().toISOString().slice(0, 10)
  );
  const [status, setStatus] = useState<SiteWalkStatus>(walk?.status ?? "draft");
  const [attendeesText, setAttendeesText] = useState((walk?.attendees ?? []).join(", "));
  const [propertyContact, setPropertyContact] = useState(walk?.property_contact ?? "");
  const [weather, setWeather] = useState(walk?.weather ?? "");
  const [summary, setSummary] = useState(walk?.summary ?? "");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!title.trim()) {
      toast.error("Title is required");
      return;
    }
    setSaving(true);
    try {
      const attendees = attendeesText
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);

      const payload = {
        title: title.trim(),
        walk_date: walkDate,
        status,
        attendees,
        property_contact: propertyContact.trim() || null,
        weather: weather.trim() || null,
        summary: summary.trim() || null,
      };

      const url = walk
        ? `/api/deals/${dealId}/site-walks/${walk.id}`
        : `/api/deals/${dealId}/site-walks`;
      const method = walk ? "PATCH" : "POST";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) throw new Error("Failed");
      const json = await res.json();
      toast.success(walk ? "Site walk updated" : "Site walk created");
      onSaved(json.data);
    } catch (err) {
      console.error(err);
      toast.error("Failed to save");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3">
      <h3 className="font-semibold text-sm">{walk ? "Edit Site Walk" : "New Site Walk"}</h3>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-medium text-muted-foreground">Title *</label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g., Initial walk with listing broker"
            className="w-full text-sm border rounded-md px-3 py-1.5 bg-background mt-1 outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground">Walk Date</label>
          <input
            type="date"
            value={walkDate}
            onChange={(e) => setWalkDate(e.target.value)}
            className="w-full text-sm border rounded-md px-3 py-1.5 bg-background mt-1 outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground">Status</label>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as SiteWalkStatus)}
            className="w-full text-sm border rounded-md px-3 py-1.5 bg-background mt-1 outline-none focus:ring-2 focus:ring-ring"
          >
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {s.replace("_", " ")}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground">Weather</label>
          <input
            type="text"
            value={weather}
            onChange={(e) => setWeather(e.target.value)}
            placeholder="e.g., 75°F sunny"
            className="w-full text-sm border rounded-md px-3 py-1.5 bg-background mt-1 outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground">Property Contact</label>
          <input
            type="text"
            value={propertyContact}
            onChange={(e) => setPropertyContact(e.target.value)}
            placeholder="Name of touring contact"
            className="w-full text-sm border rounded-md px-3 py-1.5 bg-background mt-1 outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground">Attendees (comma separated)</label>
          <input
            type="text"
            value={attendeesText}
            onChange={(e) => setAttendeesText(e.target.value)}
            placeholder="e.g., John, Maria, Sarah"
            className="w-full text-sm border rounded-md px-3 py-1.5 bg-background mt-1 outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
      </div>
      <div>
        <label className="text-xs font-medium text-muted-foreground">Summary (optional)</label>
        <textarea
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
          rows={2}
          placeholder="Overall impression or key takeaways"
          className="w-full text-sm border rounded-md px-3 py-1.5 bg-background mt-1 outline-none focus:ring-2 focus:ring-ring resize-none"
        />
      </div>
      <div className="flex gap-2 justify-end pt-1">
        <Button variant="outline" size="sm" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
        <Button size="sm" onClick={save} disabled={saving}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : walk ? "Update" : "Create"}
        </Button>
      </div>
    </div>
  );
}

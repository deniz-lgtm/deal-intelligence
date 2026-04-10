"use client";

import { useState, useEffect, useCallback } from "react";
import { Plus, Footprints, Loader2, Calendar, AlertTriangle, Mic, Camera, FileText, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import type { SiteWalk, SiteWalkRecording, SiteWalkPhoto, SiteWalkDeficiency } from "@/lib/types";
import SiteWalkForm from "@/components/site-walk/SiteWalkForm";
import SiteWalkRecordings from "@/components/site-walk/SiteWalkRecordings";
import SiteWalkPhotos from "@/components/site-walk/SiteWalkPhotos";
import SiteWalkDeficiencies from "@/components/site-walk/SiteWalkDeficiencies";
import SiteWalkReport from "@/components/site-walk/SiteWalkReport";

type Tab = "recordings" | "photos" | "deficiencies" | "report";

interface WalkDetail {
  walk: SiteWalk;
  recordings: SiteWalkRecording[];
  photos: SiteWalkPhoto[];
  deficiencies: SiteWalkDeficiency[];
}

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-zinc-500/20 text-zinc-300",
  in_progress: "bg-blue-500/20 text-blue-300",
  completed: "bg-emerald-500/20 text-emerald-300",
};

export default function SiteWalkPage({ params }: { params: { id: string } }) {
  const [walks, setWalks] = useState<SiteWalk[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingWalk, setEditingWalk] = useState<SiteWalk | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<WalkDetail | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>("recordings");
  const [detailLoading, setDetailLoading] = useState(false);

  const loadWalks = useCallback(async () => {
    try {
      const res = await fetch(`/api/deals/${params.id}/site-walks`);
      const json = await res.json();
      setWalks(json.data || []);
    } catch (err) {
      console.error(err);
      toast.error("Failed to load site walks");
    } finally {
      setLoading(false);
    }
  }, [params.id]);

  const loadDetail = useCallback(async (walkId: string) => {
    setDetailLoading(true);
    try {
      const res = await fetch(`/api/deals/${params.id}/site-walks/${walkId}`);
      const json = await res.json();
      setDetail(json.data);
    } catch (err) {
      console.error(err);
      toast.error("Failed to load walk details");
    } finally {
      setDetailLoading(false);
    }
  }, [params.id]);

  useEffect(() => {
    loadWalks();
  }, [loadWalks]);

  useEffect(() => {
    if (selectedId) loadDetail(selectedId);
    else setDetail(null);
  }, [selectedId, loadDetail]);

  const handleCreated = (walk: SiteWalk) => {
    setWalks((prev) => [walk, ...prev]);
    setShowForm(false);
    setEditingWalk(null);
    setSelectedId(walk.id);
  };

  const handleUpdated = (walk: SiteWalk) => {
    setWalks((prev) => prev.map((w) => (w.id === walk.id ? walk : w)));
    if (detail && detail.walk.id === walk.id) {
      setDetail({ ...detail, walk });
    }
    setEditingWalk(null);
    setShowForm(false);
  };

  const deleteWalk = async (id: string) => {
    if (!confirm("Delete this site walk and all associated recordings, photos, and deficiencies?")) return;
    try {
      await fetch(`/api/deals/${params.id}/site-walks/${id}`, { method: "DELETE" });
      setWalks((prev) => prev.filter((w) => w.id !== id));
      if (selectedId === id) setSelectedId(null);
      toast.success("Site walk deleted");
    } catch (err) {
      console.error(err);
      toast.error("Failed to delete");
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-xl font-bold flex items-center gap-2">
            <Footprints className="h-5 w-5 text-teal-400" />
            Site Walks
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            Record audio/video from property tours, transcribe to structured notes, and track deficiencies by area.
          </p>
        </div>
        <Button
          onClick={() => {
            setEditingWalk(null);
            setShowForm(true);
          }}
          size="sm"
          className="gap-1.5"
        >
          <Plus className="h-4 w-4" /> New Walk
        </Button>
      </div>

      {showForm && (
        <div className="rounded-lg border border-border/60 bg-card/40 backdrop-blur-sm p-4">
          <SiteWalkForm
            dealId={params.id}
            walk={editingWalk}
            onSaved={editingWalk ? handleUpdated : handleCreated}
            onCancel={() => {
              setShowForm(false);
              setEditingWalk(null);
            }}
          />
        </div>
      )}

      {walks.length === 0 && !showForm ? (
        <div className="rounded-lg border border-dashed border-border/60 p-10 text-center">
          <Footprints className="h-8 w-8 mx-auto text-muted-foreground/50 mb-3" />
          <p className="text-sm text-muted-foreground">No site walks yet. Create one to start capturing tour observations.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Walk list */}
          <div className="lg:col-span-1 space-y-2">
            {walks.map((walk) => {
              const isSelected = selectedId === walk.id;
              return (
                <button
                  key={walk.id}
                  onClick={() => setSelectedId(isSelected ? null : walk.id)}
                  className={`w-full text-left rounded-lg border p-3 transition-colors ${
                    isSelected
                      ? "border-primary/60 bg-primary/5"
                      : "border-border/60 bg-card/40 hover:bg-muted/30"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <h3 className="font-medium text-sm truncate">
                          {walk.title || "Untitled walk"}
                        </h3>
                        <span
                          className={`text-[10px] px-1.5 py-0.5 rounded font-medium shrink-0 ${
                            STATUS_COLORS[walk.status] ?? "bg-muted"
                          }`}
                        >
                          {walk.status.replace("_", " ")}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                        <Calendar className="h-3 w-3" />
                        {new Date(walk.walk_date).toLocaleDateString()}
                      </p>
                      {walk.property_contact && (
                        <p className="text-xs text-muted-foreground mt-0.5">
                          Contact: {walk.property_contact}
                        </p>
                      )}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>

          {/* Detail pane */}
          <div className="lg:col-span-2">
            {!selectedId ? (
              <div className="rounded-lg border border-dashed border-border/60 p-10 text-center h-full flex flex-col items-center justify-center">
                <p className="text-sm text-muted-foreground">
                  Select a walk to view recordings, photos, and deficiencies.
                </p>
              </div>
            ) : detailLoading || !detail ? (
              <div className="rounded-lg border border-border/60 p-10 text-center">
                <Loader2 className="h-5 w-5 animate-spin mx-auto text-muted-foreground" />
              </div>
            ) : (
              <div className="rounded-lg border border-border/60 bg-card/40 backdrop-blur-sm">
                <div className="border-b border-border/60 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="font-semibold text-base">{detail.walk.title || "Untitled walk"}</h3>
                      <div className="text-xs text-muted-foreground mt-1 flex flex-wrap gap-x-3 gap-y-1">
                        <span className="flex items-center gap-1">
                          <Calendar className="h-3 w-3" />
                          {new Date(detail.walk.walk_date).toLocaleDateString()}
                        </span>
                        {detail.walk.weather && <span>Weather: {detail.walk.weather}</span>}
                        {detail.walk.property_contact && <span>Contact: {detail.walk.property_contact}</span>}
                      </div>
                      {detail.walk.attendees.length > 0 && (
                        <p className="text-xs text-muted-foreground mt-1">
                          Attendees: {detail.walk.attendees.join(", ")}
                        </p>
                      )}
                      {detail.walk.summary && (
                        <p className="text-xs mt-2">{detail.walk.summary}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setEditingWalk(detail.walk);
                          setShowForm(true);
                        }}
                      >
                        Edit
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => deleteWalk(detail.walk.id)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                </div>

                <div className="border-b border-border/60 flex gap-1 px-2">
                  {([
                    { key: "recordings", label: "Recordings", icon: Mic, count: detail.recordings.length },
                    { key: "photos", label: "Photos", icon: Camera, count: detail.photos.length },
                    { key: "deficiencies", label: "Deficiencies", icon: AlertTriangle, count: detail.deficiencies.length },
                    { key: "report", label: "Report", icon: FileText, count: detail.walk.ai_report ? 1 : 0 },
                  ] as const).map((tab) => {
                    const Icon = tab.icon;
                    const isActive = activeTab === tab.key;
                    return (
                      <button
                        key={tab.key}
                        onClick={() => setActiveTab(tab.key)}
                        className={`px-3 py-2.5 text-xs font-medium flex items-center gap-1.5 border-b-2 transition-colors ${
                          isActive
                            ? "border-primary text-primary"
                            : "border-transparent text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        <Icon className="h-3.5 w-3.5" />
                        {tab.label}
                        {tab.count > 0 && (
                          <span className="text-[10px] bg-muted/70 px-1.5 rounded">{tab.count}</span>
                        )}
                      </button>
                    );
                  })}
                </div>

                <div className="p-4">
                  {activeTab === "recordings" && (
                    <SiteWalkRecordings
                      dealId={params.id}
                      walkId={detail.walk.id}
                      recordings={detail.recordings}
                      onChanged={() => loadDetail(detail.walk.id)}
                    />
                  )}
                  {activeTab === "photos" && (
                    <SiteWalkPhotos
                      dealId={params.id}
                      walkId={detail.walk.id}
                      photos={detail.photos}
                      onChanged={() => loadDetail(detail.walk.id)}
                    />
                  )}
                  {activeTab === "deficiencies" && (
                    <SiteWalkDeficiencies
                      dealId={params.id}
                      walkId={detail.walk.id}
                      deficiencies={detail.deficiencies}
                      photos={detail.photos}
                      onChanged={() => loadDetail(detail.walk.id)}
                    />
                  )}
                  {activeTab === "report" && (
                    <SiteWalkReport
                      dealId={params.id}
                      walk={detail.walk}
                      onReportGenerated={(report) =>
                        setDetail({ ...detail, walk: { ...detail.walk, ai_report: report } })
                      }
                    />
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

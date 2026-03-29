"use client";

import { useState, useEffect } from "react";
import {
  Loader2,
  DollarSign,
  Cpu,
  Hash,
  FileText,
  MessageSquare,
  Calculator,
  FileSearch,
  Activity,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface ActivityEvent {
  type: string;
  description: string;
  timestamp: string;
  cost?: number;
  model?: string;
  tokens?: number;
}

interface Summary {
  total_cost: number;
  total_tokens: number;
  models_used: string[];
  event_count: number;
}

const TYPE_ICONS: Record<string, React.ElementType> = {
  om_analysis: FileSearch,
  chat: MessageSquare,
  underwriting: Calculator,
  document: FileText,
};

const TYPE_COLORS: Record<string, string> = {
  om_analysis: "bg-indigo-500/10 text-indigo-400",
  chat: "bg-blue-500/10 text-blue-400",
  underwriting: "bg-purple-500/10 text-purple-400",
  document: "bg-emerald-500/10 text-emerald-400",
};

function formatDate(date: string): string {
  return new Date(date).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function DealLogPage({ params }: { params: { id: string } }) {
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/deals/${params.id}/activity`)
      .then((r) => r.json())
      .then((data) => {
        setEvents(data.events || []);
        setSummary(data.summary || null);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [params.id]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-up">
      <div>
        <h1 className="font-display text-xl">Deal Log</h1>
        <p className="text-sm text-muted-foreground">
          Activity and AI processing history
        </p>
      </div>

      {/* Summary cards */}
      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="border border-border/60 rounded-xl bg-card p-4 shadow-card">
            <div className="flex items-center gap-2 text-muted-foreground mb-2">
              <DollarSign className="h-4 w-4 text-emerald-400" />
              <span className="text-xs font-medium">Total AI Cost</span>
            </div>
            <p className="text-2xl font-bold tabular-nums">
              ${summary.total_cost.toFixed(4)}
            </p>
          </div>
          <div className="border border-border/60 rounded-xl bg-card p-4 shadow-card">
            <div className="flex items-center gap-2 text-muted-foreground mb-2">
              <Hash className="h-4 w-4 text-blue-400" />
              <span className="text-xs font-medium">Total Tokens</span>
            </div>
            <p className="text-2xl font-bold tabular-nums">
              {summary.total_tokens.toLocaleString()}
            </p>
          </div>
          <div className="border border-border/60 rounded-xl bg-card p-4 shadow-card">
            <div className="flex items-center gap-2 text-muted-foreground mb-2">
              <Cpu className="h-4 w-4 text-purple-400" />
              <span className="text-xs font-medium">Models Used</span>
            </div>
            <p className="text-sm font-semibold">
              {summary.models_used.length > 0
                ? summary.models_used.join(", ")
                : "None"}
            </p>
          </div>
          <div className="border border-border/60 rounded-xl bg-card p-4 shadow-card">
            <div className="flex items-center gap-2 text-muted-foreground mb-2">
              <Activity className="h-4 w-4 text-primary" />
              <span className="text-xs font-medium">Total Events</span>
            </div>
            <p className="text-2xl font-bold tabular-nums">
              {summary.event_count}
            </p>
          </div>
        </div>
      )}

      {/* Activity feed */}
      <div className="border border-border/60 rounded-xl bg-card overflow-hidden shadow-card">
        <div className="px-4 py-3 border-b border-border/30 bg-muted/10">
          <h3 className="font-display text-sm">Activity Feed</h3>
        </div>
        {events.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">
            No activity recorded yet
          </div>
        ) : (
          <div className="divide-y divide-border/20">
            {events.map((event, i) => {
              const Icon = TYPE_ICONS[event.type] || Activity;
              const color = TYPE_COLORS[event.type] || "bg-muted/30 text-muted-foreground";
              return (
                <div key={i} className="flex items-start gap-3 px-4 py-3 hover:bg-muted/10 transition-colors">
                  <div
                    className={cn(
                      "w-8 h-8 rounded-lg flex items-center justify-center shrink-0",
                      color
                    )}
                  >
                    <Icon className="h-4 w-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm">{event.description}</p>
                    <div className="flex items-center gap-3 mt-0.5 text-xs text-muted-foreground">
                      <span>{formatDate(event.timestamp)}</span>
                      {event.model && <span>{event.model}</span>}
                      {event.tokens && (
                        <span>{event.tokens.toLocaleString()} tokens</span>
                      )}
                      {event.cost != null && event.cost > 0 && (
                        <span>${event.cost.toFixed(4)}</span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

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
  om_analysis: "bg-indigo-100 text-indigo-700",
  chat: "bg-blue-100 text-blue-700",
  underwriting: "bg-purple-100 text-purple-700",
  document: "bg-emerald-100 text-emerald-700",
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
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Deal Log</h1>
        <p className="text-sm text-muted-foreground">
          Activity and AI processing history
        </p>
      </div>

      {/* Summary cards */}
      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="border rounded-xl bg-card p-4">
            <div className="flex items-center gap-2 text-muted-foreground mb-2">
              <DollarSign className="h-4 w-4" />
              <span className="text-xs font-medium">Total AI Cost</span>
            </div>
            <p className="text-2xl font-bold tabular-nums">
              ${summary.total_cost.toFixed(4)}
            </p>
          </div>
          <div className="border rounded-xl bg-card p-4">
            <div className="flex items-center gap-2 text-muted-foreground mb-2">
              <Hash className="h-4 w-4" />
              <span className="text-xs font-medium">Total Tokens</span>
            </div>
            <p className="text-2xl font-bold tabular-nums">
              {summary.total_tokens.toLocaleString()}
            </p>
          </div>
          <div className="border rounded-xl bg-card p-4">
            <div className="flex items-center gap-2 text-muted-foreground mb-2">
              <Cpu className="h-4 w-4" />
              <span className="text-xs font-medium">Models Used</span>
            </div>
            <p className="text-sm font-semibold">
              {summary.models_used.length > 0
                ? summary.models_used.join(", ")
                : "None"}
            </p>
          </div>
          <div className="border rounded-xl bg-card p-4">
            <div className="flex items-center gap-2 text-muted-foreground mb-2">
              <Activity className="h-4 w-4" />
              <span className="text-xs font-medium">Total Events</span>
            </div>
            <p className="text-2xl font-bold tabular-nums">
              {summary.event_count}
            </p>
          </div>
        </div>
      )}

      {/* Activity feed */}
      <div className="border rounded-xl bg-card overflow-hidden">
        <div className="px-4 py-3 border-b bg-muted/30">
          <h3 className="font-semibold text-sm">Activity Feed</h3>
        </div>
        {events.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">
            No activity recorded yet
          </div>
        ) : (
          <div className="divide-y">
            {events.map((event, i) => {
              const Icon = TYPE_ICONS[event.type] || Activity;
              const color = TYPE_COLORS[event.type] || "bg-gray-100 text-gray-700";
              return (
                <div key={i} className="flex items-start gap-3 px-4 py-3">
                  <div
                    className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${color}`}
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

"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { BookOpen, CalendarDays, FileText, Loader2, Presentation } from "lucide-react";
import UniversalChatbot from "@/components/UniversalChatbot";
import { useSetPageContext } from "@/lib/page-context";

export default function ChatPage({ params }: { params: { id: string } }) {
  const searchParams = useSearchParams();
  const initialPrompt = searchParams.get("prompt");
  const [dealName, setDealName] = useState("This Deal");
  const [loading, setLoading] = useState(true);

  useSetPageContext(
    {
      dealId: params.id,
      dealName,
      route: "deal_chat",
      screenSummary:
        "Dedicated Deal Intelligence chat page. User is asking deal questions, saving context, creating follow-up work, and using the same assistant history as the floating chatbot.",
    },
    [params.id, dealName]
  );

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/deals/${params.id}`)
      .then((res) => res.json())
      .then((json) => {
        if (!cancelled && json.data?.name) setDealName(json.data.name);
      })
      .catch(console.error)
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [params.id]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const promptStarters = [
    {
      label: "Files Review",
      icon: FileText,
      prompt:
        "Review this deal's files. What matters, what is missing, and what should be updated next? Keep it concise.",
    },
    {
      label: "Schedule Gaps",
      icon: CalendarDays,
      prompt:
        "Review the schedule and ask any prep questions needed before suggesting missing tasks, owners, and dates.",
    },
    {
      label: "IC Prep",
      icon: Presentation,
      prompt:
        "Prepare me for IC. Give the top risks, open decisions, missing backup, and next schedule items. Keep it concise.",
    },
    {
      label: "Playbook Check",
      icon: BookOpen,
      prompt:
        "Compare this deal to the Development Playbook. What best practices or lessons learned apply, and what follow-up items should we consider?",
    },
  ];

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
        {promptStarters.map((starter) => {
          const Icon = starter.icon;
          return (
            <Link
              key={starter.label}
              href={`/deals/${params.id}/chat?prompt=${encodeURIComponent(starter.prompt)}`}
              className="group flex items-center gap-2 rounded-lg border bg-card/70 px-3 py-2.5 text-sm hover:bg-muted/40 transition-colors"
            >
              <Icon className="h-4 w-4 text-muted-foreground group-hover:text-foreground" />
              <span className="font-medium truncate">{starter.label}</span>
            </Link>
          );
        })}
      </div>
      <div className="h-[calc(100vh-230px)] min-h-[520px] overflow-hidden rounded-xl border bg-card">
        <UniversalChatbot
          variant="embedded"
          dealId={params.id}
          dealName={dealName}
          route="deal_chat"
          screenSummary="Dedicated Deal Intelligence chat page. User is asking deal questions, saving context, creating follow-up work, and using the same assistant history as the floating chatbot."
          initialPrompt={initialPrompt}
        />
      </div>
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
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

  return (
    <div className="h-[calc(100vh-180px)] overflow-hidden rounded-xl border bg-card">
      <UniversalChatbot
        variant="embedded"
        dealId={params.id}
        dealName={dealName}
        route="deal_chat"
        screenSummary="Dedicated Deal Intelligence chat page. User is asking deal questions, saving context, creating follow-up work, and using the same assistant history as the floating chatbot."
        initialPrompt={initialPrompt}
      />
    </div>
  );
}

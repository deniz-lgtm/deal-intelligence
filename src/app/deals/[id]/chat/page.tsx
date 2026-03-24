"use client";

import { useState, useEffect, useCallback } from "react";
import { Loader2 } from "lucide-react";
import ChatInterface from "@/components/ChatInterface";

export default function ChatPage({ params }: { params: { id: string } }) {
  const [deal, setDeal] = useState<{ name: string; context_notes?: string | null } | null>(null);
  const [loading, setLoading] = useState(true);

  const loadDeal = useCallback(async () => {
    const res = await fetch(`/api/deals/${params.id}`);
    const json = await res.json();
    if (json.data) setDeal(json.data);
    setLoading(false);
  }, [params.id]);

  useEffect(() => {
    loadDeal();
  }, [loadDeal]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="h-[calc(100vh-180px)] border rounded-xl overflow-hidden bg-card">
      <ChatInterface
        dealId={params.id}
        dealName={deal?.name ?? "This Deal"}
        contextNotes={deal?.context_notes}
        onContextUpdated={loadDeal}
      />
    </div>
  );
}

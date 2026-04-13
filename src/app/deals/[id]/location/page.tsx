"use client";

import { useState, useEffect, useCallback } from "react";
import dynamic from "next/dynamic";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

const LocationIntelligence = dynamic(
  () => import("@/components/LocationIntelligence"),
  {
    ssr: false,
    loading: () => (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    ),
  }
);

interface SubjectDeal {
  id: string;
  name: string;
  address: string | null;
  city: string | null;
  state: string | null;
  lat: number | null;
  lng: number | null;
}

export default function LocationPage({
  params,
}: {
  params: { id: string };
}) {
  const [loading, setLoading] = useState(true);
  const [subject, setSubject] = useState<SubjectDeal | null>(null);

  const loadDeal = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/deals/${params.id}`);
      const json = await res.json();
      setSubject(json.data || null);
    } catch (err) {
      console.error(err);
      toast.error("Failed to load deal");
    } finally {
      setLoading(false);
    }
  }, [params.id]);

  useEffect(() => {
    loadDeal();
  }, [loadDeal]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto pb-24">
      <LocationIntelligence
        dealId={params.id}
        dealLat={subject?.lat ? Number(subject.lat) : null}
        dealLng={subject?.lng ? Number(subject.lng) : null}
        dealAddress={
          subject
            ? [subject.address, subject.city, subject.state]
                .filter(Boolean)
                .join(", ") || null
            : null
        }
      />
    </div>
  );
}

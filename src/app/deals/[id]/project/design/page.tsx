"use client";

import Link from "next/link";
import { BookOpen } from "lucide-react";
import DevelopmentSchedule from "@/components/DevelopmentSchedule";
import { OtherTrackLinks } from "@/components/schedule/TrackSchedule";
import { Button } from "@/components/ui/button";

export default function DesignPage({ params }: { params: { id: string } }) {
  return (
    <div className="space-y-8">
      <OtherTrackLinks dealId={params.id} current="development" />
      <div>
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-bold">Design</h2>
            <p className="text-sm text-muted-foreground mt-1">
              AIA design phases (SD / DD / CDs) and utility coordination. Track
              submittal packages, design review responses, and will-serve letters
              as child tasks under each phase.
            </p>
          </div>
          <Link
            href={`/deals/${params.id}/chat?prompt=${encodeURIComponent("Use the Development Playbook for this multifamily design workflow. What standards, common misses, and architect review comments should we check before the next design submission?")}`}
          >
            <Button variant="outline" size="sm" className="gap-1.5 flex-shrink-0">
              <BookOpen className="h-3.5 w-3.5" />
              Playbook
            </Button>
          </Link>
        </div>
        <DevelopmentSchedule dealId={params.id} workstreams={["design"]} hideBudget />
      </div>
    </div>
  );
}

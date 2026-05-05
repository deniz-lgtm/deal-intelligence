"use client";

import { useState } from "react";
import Link from "next/link";
import { BookOpen, UploadCloud } from "lucide-react";
import { Button } from "@/components/ui/button";
import { OtherTrackLinks } from "@/components/schedule/TrackSchedule";
import AcqScheduleImportDialog from "@/components/schedule/AcqScheduleImportDialog";
import DevelopmentSchedule from "@/components/DevelopmentSchedule";

export default function AcquisitionSchedulePage({
  params,
}: {
  params: { id: string };
}) {
  const [importOpen, setImportOpen] = useState(false);
  // Force a remount of the schedule after a successful import so the
  // freshly applied dates show up without a manual refresh — same
  // pattern as the GC importer on the Construction page.
  const [scheduleKey, setScheduleKey] = useState(0);

  return (
    <div className="space-y-8">
      <OtherTrackLinks dealId={params.id} current="acquisition" />
      <div>
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-bold">Acquisition Schedule</h2>
            <p className="text-sm text-muted-foreground mt-1">
              Deal-stage milestones from call-for-offers through close. Each
              milestone date anchors the downstream Development and Construction
              timelines automatically. Upload an LOI, PSA, or broker timeline to
              auto-fill dates; or use the DD Checklist for document-completeness
              tracking.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href={`/deals/${params.id}/chat?prompt=${encodeURIComponent("Use the Development Playbook for this acquisition schedule. What checkpoints, sequencing risks, and handoff items should we verify before the next milestone?")}`}
            >
              <Button variant="outline" size="sm" className="gap-1.5">
                <BookOpen className="h-3.5 w-3.5" />
                Playbook
              </Button>
            </Link>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setImportOpen(true)}
              className="gap-1.5 flex-shrink-0"
            >
              <UploadCloud className="h-3.5 w-3.5" />
              Upload acq doc
            </Button>
          </div>
        </div>
        <DevelopmentSchedule
          key={scheduleKey}
          dealId={params.id}
          track="acquisition"
        />
        <AcqScheduleImportDialog
          dealId={params.id}
          open={importOpen}
          onOpenChange={setImportOpen}
          onCommitted={() => setScheduleKey((k) => k + 1)}
        />
      </div>
    </div>
  );
}

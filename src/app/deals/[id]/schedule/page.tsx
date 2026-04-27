"use client";

import { useState } from "react";
import { UploadCloud } from "lucide-react";
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

"use client";

import { useState } from "react";
import { UploadCloud } from "lucide-react";
import { Button } from "@/components/ui/button";
import { OtherTrackLinks } from "@/components/schedule/TrackSchedule";
import GcScheduleImportDialog from "@/components/schedule/GcScheduleImportDialog";
import DevelopmentSchedule from "@/components/DevelopmentSchedule";

export default function ConstructionSchedulePage({
  params,
}: {
  params: { id: string };
}) {
  const [importOpen, setImportOpen] = useState(false);
  // DevelopmentSchedule refetches internally on its mutation handlers,
  // but the GC importer writes outside that flow. Bumping this key
  // forces a remount so the new rows show up without a page reload.
  const [scheduleKey, setScheduleKey] = useState(0);

  return (
    <div className="space-y-8">
      <OtherTrackLinks dealId={params.id} current="construction" />
      <div>
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-bold">Construction Schedule</h2>
            <p className="text-sm text-muted-foreground mt-1">
              Activities from mobilization through certificate of occupancy.
              Upload a GC schedule PDF to extract phases and dependencies in
              bulk.
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setImportOpen(true)}
            className="gap-1.5 flex-shrink-0"
          >
            <UploadCloud className="h-3.5 w-3.5" />
            Upload GC schedule
          </Button>
        </div>
        <DevelopmentSchedule key={scheduleKey} dealId={params.id} track="construction" />
        <GcScheduleImportDialog
          dealId={params.id}
          open={importOpen}
          onOpenChange={setImportOpen}
          onCommitted={() => setScheduleKey((k) => k + 1)}
        />
      </div>
    </div>
  );
}

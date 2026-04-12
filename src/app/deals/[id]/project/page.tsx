"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { HardHat, ArrowRight, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import ProjectManagement from "@/components/ProjectManagement";
import DevelopmentSchedule from "@/components/DevelopmentSchedule";
import type { DealStatus, ExecutionPhase } from "@/lib/types";

interface DealSummary {
  status: DealStatus;
  execution_phase: ExecutionPhase | null;
}

export default function ProjectPage({ params }: { params: { id: string } }) {
  const router = useRouter();
  const [deal, setDeal] = useState<DealSummary | null>(null);
  const [handoffOpen, setHandoffOpen] = useState(false);
  const [handing, setHanding] = useState(false);

  useEffect(() => {
    fetch(`/api/deals/${params.id}`)
      .then((r) => r.json())
      .then((j) => setDeal(j.data))
      .catch(console.error);
  }, [params.id]);

  const handleHandoff = async () => {
    setHanding(true);
    try {
      const res = await fetch(`/api/deals/${params.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          execution_phase: "preconstruction",
          execution_started_at: new Date().toISOString(),
        }),
      });
      if (!res.ok) throw new Error("Failed to hand off");
      toast.success("Deal handed off to Execution");
      setHandoffOpen(false);
      router.refresh();
      // Reload deal state
      const updated = await fetch(`/api/deals/${params.id}`).then((r) => r.json());
      setDeal(updated.data);
    } catch (err) {
      toast.error("Handoff failed");
      console.error(err);
    } finally {
      setHanding(false);
    }
  };

  const showHandoff = deal?.status === "closed" && !deal?.execution_phase;

  return (
    <div className="space-y-8">
      {showHandoff && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-amber-500/20 flex items-center justify-center flex-shrink-0">
              <HardHat className="h-5 w-5 text-amber-400" />
            </div>
            <div>
              <p className="text-sm font-medium text-foreground">Ready for Execution?</p>
              <p className="text-xs text-muted-foreground">
                This deal is closed. Hand it off to the execution team to begin construction management.
              </p>
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="border-amber-500/30 text-amber-400 hover:bg-amber-500/10 flex-shrink-0"
            onClick={() => setHandoffOpen(true)}
          >
            Hand Off to Execution
            <ArrowRight className="h-3.5 w-3.5 ml-1.5" />
          </Button>

          <Dialog open={handoffOpen} onOpenChange={setHandoffOpen}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Hand Off to Execution</DialogTitle>
                <DialogDescription>
                  This will transition the deal into the Execution workspace. The acquisition team
                  will still have full access, but the deal will now appear in the Construction
                  dashboard with budget tracking, draw scheduling, permits, and vendor management.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button variant="outline" onClick={() => setHandoffOpen(false)}>
                  Cancel
                </Button>
                <Button onClick={handleHandoff} disabled={handing}>
                  {handing && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
                  Confirm Handoff
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      )}

      {deal?.execution_phase && (
        <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-4 flex items-center gap-3">
          <HardHat className="h-5 w-5 text-emerald-400 flex-shrink-0" />
          <div>
            <p className="text-sm font-medium text-foreground">In Execution</p>
            <p className="text-xs text-muted-foreground">
              This deal has been handed off.{" "}
              <a href={`/deals/${params.id}/construction`} className="text-primary hover:underline">
                Go to Construction Dashboard &rarr;
              </a>
            </p>
          </div>
        </div>
      )}

      <div>
        <div className="mb-6">
          <h2 className="text-xl font-bold">Project Management</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Track milestones, tasks, and deadlines for this deal.
          </p>
        </div>
        <ProjectManagement dealId={params.id} />
      </div>

      <div>
        <div className="mb-6">
          <h2 className="text-xl font-bold">Development Schedule & Pre-Dev Budget</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Phase-by-phase development timeline and itemized pre-development spend with approval gates.
          </p>
        </div>
        <DevelopmentSchedule dealId={params.id} />
      </div>
    </div>
  );
}

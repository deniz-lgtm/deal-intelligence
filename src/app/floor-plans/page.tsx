import { AppShell } from "@/components/AppShell";
import { FloorPlanEditor } from "@/components/floor-plan/FloorPlanEditor";

export const metadata = {
  title: "Floor Plans · Deal Intel",
};

export default function FloorPlansPage() {
  return (
    <AppShell>
      <div className="flex flex-col flex-1 min-h-0">
        <header className="border-b border-border/40 px-6 py-3 shrink-0">
          <div className="flex items-baseline justify-between">
            <div>
              <h1 className="font-nameplate text-xl leading-none tracking-tight">
                Floor Plans
              </h1>
              <p className="text-2xs uppercase tracking-[0.18em] text-muted-foreground/60 mt-1">
                Sketchpad &middot; for sharing with the team and architects
              </p>
            </div>
          </div>
        </header>
        <div className="flex-1 min-h-0">
          <FloorPlanEditor />
        </div>
      </div>
    </AppShell>
  );
}

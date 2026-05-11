"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, Loader2 } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  UNIT_TYPES,
  UNIT_CATEGORY_LABELS,
  type UnitCategory,
  type UnitTypeDef,
} from "@/lib/floor-plan-unit-types";

// Two-step wizard before we drop the user into the editor:
//   Step 1 — pick a unit type (grouped by category)
//   Step 2 — name the plan (pre-filled from the unit type) + optional SF
// Submitting POSTs to /api/floor-plans and routes to the new editor page.

export default function NewFloorPlanWizard() {
  const router = useRouter();
  const [step, setStep] = useState<1 | 2>(1);
  const [selected, setSelected] = useState<UnitTypeDef | null>(null);
  const [name, setName] = useState("");
  const [squareFootage, setSquareFootage] = useState<string>("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const choose = (def: UnitTypeDef) => {
    setSelected(def);
    setName(`${def.label} — New`);
    setSquareFootage(String(Math.round((def.sfRange[0] + def.sfRange[1]) / 2)));
    setStep(2);
  };

  const submit = async () => {
    if (!selected) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/floor-plans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim() || selected.label,
          unit_type: selected.id,
          square_footage: squareFootage ? Number(squareFootage) : null,
          description: description.trim() || null,
          plan_data: { els: [], title: name.trim() || selected.label },
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to create plan");
      router.push(`/floor-plans/${json.data.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create plan");
      setSubmitting(false);
    }
  };

  return (
    <AppShell>
      <div className="flex min-h-0 flex-1 flex-col">
        <header className="shrink-0 border-b border-border/40 px-6 py-4 sm:px-8">
          <Link href="/floor-plans" className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-3.5 w-3.5" />
            Back to library
          </Link>
          <div className="mt-2 flex items-baseline justify-between">
            <h1 className="font-nameplate text-2xl leading-none tracking-tight">New Floor Plan</h1>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <StepDot active={step === 1} done={step > 1} label="Type" />
              <span className="h-px w-6 bg-border" />
              <StepDot active={step === 2} done={false} label="Details" />
            </div>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto px-6 py-8 sm:px-8">
          {step === 1 ? (
            <Step1 onChoose={choose} />
          ) : (
            <Step2
              def={selected!}
              name={name}
              setName={setName}
              squareFootage={squareFootage}
              setSquareFootage={setSquareFootage}
              description={description}
              setDescription={setDescription}
              error={error}
              submitting={submitting}
              onBack={() => setStep(1)}
              onSubmit={submit}
            />
          )}
        </div>
      </div>
    </AppShell>
  );
}

function StepDot({ active, done, label }: { active: boolean; done: boolean; label: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5", (active || done) && "text-foreground")}>
      <span
        className={cn(
          "h-2 w-2 rounded-full",
          done ? "bg-primary" : active ? "bg-foreground" : "bg-muted-foreground/30"
        )}
      />
      {label}
    </span>
  );
}

function Step1({ onChoose }: { onChoose: (def: UnitTypeDef) => void }) {
  const grouped: Record<UnitCategory, UnitTypeDef[]> = {
    multifamily: UNIT_TYPES.filter((u) => u.category === "multifamily"),
    townhouse:   UNIT_TYPES.filter((u) => u.category === "townhouse"),
    sfr:         UNIT_TYPES.filter((u) => u.category === "sfr"),
  };

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <p className="text-sm text-muted-foreground">
        Pick the unit type you&apos;re designing. This determines the bedroom / bath count
        stored with the plan and groups it in the library.
      </p>

      {(Object.keys(grouped) as UnitCategory[]).map((cat) => (
        <section key={cat}>
          <h2 className="font-display text-lg tracking-tight mb-3">{UNIT_CATEGORY_LABELS[cat]}</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {grouped[cat].map((def) => (
              <button
                key={def.id}
                type="button"
                onClick={() => onChoose(def)}
                className="group rounded-xl border border-border/50 bg-card/40 p-4 text-left transition-all hover:-translate-y-0.5 hover:border-primary/45 hover:bg-card/70"
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="text-sm font-semibold text-foreground group-hover:text-primary">{def.label}</span>
                  <span className="rounded-full border border-border/60 bg-muted/40 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                    {def.shortLabel}
                  </span>
                </div>
                <div className="mt-2 text-xs text-muted-foreground">
                  {def.bedrooms === 0 ? "Studio" : `${def.bedrooms} BR`} · {def.bathrooms} BA
                </div>
                <div className="mt-1 text-xs text-muted-foreground/70">
                  Typical {def.sfRange[0].toLocaleString()}–{def.sfRange[1].toLocaleString()} SF
                </div>
              </button>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function Step2(props: {
  def: UnitTypeDef;
  name: string;
  setName: (v: string) => void;
  squareFootage: string;
  setSquareFootage: (v: string) => void;
  description: string;
  setDescription: (v: string) => void;
  error: string | null;
  submitting: boolean;
  onBack: () => void;
  onSubmit: () => void;
}) {
  const { def, name, setName, squareFootage, setSquareFootage, description, setDescription, error, submitting, onBack, onSubmit } = props;
  return (
    <div className="mx-auto max-w-xl space-y-5">
      <div className="rounded-lg border border-border/50 bg-card/40 p-4">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground/70">Selected unit type</div>
        <div className="mt-1 text-base font-semibold">{def.label}</div>
        <div className="mt-1 text-xs text-muted-foreground">
          {def.bedrooms === 0 ? "Studio" : `${def.bedrooms} BR`} · {def.bathrooms} BA · typical {def.sfRange[0]}–{def.sfRange[1]} SF
        </div>
      </div>

      <div className="space-y-3">
        <div>
          <label className="text-xs font-medium text-muted-foreground">Plan name</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="mt-1 w-full rounded-md border border-border/50 bg-background/60 px-3 py-2 text-sm focus:border-primary/50 focus:outline-none focus:ring-2 focus:ring-primary/15"
            placeholder={def.label}
          />
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground">Square footage (optional)</label>
          <input
            type="number"
            min={0}
            value={squareFootage}
            onChange={(e) => setSquareFootage(e.target.value)}
            className="mt-1 w-full rounded-md border border-border/50 bg-background/60 px-3 py-2 text-sm focus:border-primary/50 focus:outline-none focus:ring-2 focus:ring-primary/15"
          />
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground">Description (optional)</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            className="mt-1 w-full rounded-md border border-border/50 bg-background/60 px-3 py-2 text-sm focus:border-primary/50 focus:outline-none focus:ring-2 focus:ring-primary/15"
            placeholder="Notes on the layout, target market, design intent…"
          />
        </div>
      </div>

      {error && <p className="text-sm text-red-500">{error}</p>}

      <div className="flex items-center justify-between pt-2">
        <Button variant="ghost" size="sm" onClick={onBack} disabled={submitting}>
          <ArrowLeft className="mr-1.5 h-3.5 w-3.5" />
          Change unit type
        </Button>
        <Button size="sm" onClick={onSubmit} disabled={submitting || !name.trim()}>
          {submitting ? (
            <><Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> Creating…</>
          ) : (
            <>Open editor <ArrowRight className="ml-1.5 h-3.5 w-3.5" /></>
          )}
        </Button>
      </div>
    </div>
  );
}

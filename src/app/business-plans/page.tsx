"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Plus,
  BookOpen,
  Star,
  StarOff,
  Pencil,
  Trash2,
  Check,
  X,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

interface BusinessPlan {
  id: string;
  name: string;
  description: string;
  is_default: boolean;
  created_at: string;
  updated_at: string;
}

function PlanForm({
  initial,
  onSave,
  onCancel,
  saving,
}: {
  initial?: { name: string; description: string; is_default: boolean };
  onSave: (data: { name: string; description: string; is_default: boolean }) => Promise<void>;
  onCancel: () => void;
  saving: boolean;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [isDefault, setIsDefault] = useState(initial?.is_default ?? false);

  async function handleSave() {
    if (!name.trim() || !description.trim()) return;
    await onSave({ name: name.trim(), description: description.trim(), is_default: isDefault });
  }

  return (
    <div className="flex flex-col gap-4 pt-2">
      <div className="flex flex-col gap-1.5">
        <label className="text-2xs font-semibold text-muted-foreground uppercase tracking-wider">
          Plan Name
        </label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Industrial Value-Add Strategy"
          className="input-field"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label className="text-2xs font-semibold text-muted-foreground uppercase tracking-wider">
          Business Plan / Investment Strategy
        </label>
        <p className="text-2xs text-muted-foreground">
          Describe your strategy so the AI calibrates its analysis to your approach. This text will be
          prepended to every OM analysis for this plan.
        </p>
        <Textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder={`e.g. We are a value-add industrial real estate investor focused on flex/light industrial assets in secondary and tertiary markets. Our strategy is to acquire vacant or under-occupied properties, perform gut renovations, and reposition them to multi-tenant flex users. We typically hold 5–7 years.

Vacancy is always intentional at acquisition — we will never have a rent roll at purchase. Do not flag this as a risk. We source our own CapEx budgets and do not rely on broker estimates. Standard due diligence items like environmental Phase I, title, and survey are handled post-LOI, not pre-offer.`}
          className="min-h-[180px] resize-none text-sm"
        />
        <p className="text-2xs text-muted-foreground text-right tabular-nums">{description.length} chars</p>
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setIsDefault((v) => !v)}
          className={cn(
            "flex items-center gap-2 text-xs px-3 py-1.5 rounded-lg border transition-all duration-150",
            isDefault
              ? "bg-amber-500/10 border-amber-500/20 text-amber-400"
              : "bg-muted/30 border-border/40 text-muted-foreground hover:bg-muted/50"
          )}
        >
          {isDefault ? (
            <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
          ) : (
            <StarOff className="h-3.5 w-3.5" />
          )}
          {isDefault ? "Default plan" : "Not default"}
        </button>
        <span className="text-2xs text-muted-foreground">
          Default plan is auto-selected when uploading an OM.
        </span>
      </div>

      <div className="flex items-center gap-2">
        <Button size="sm" onClick={handleSave} disabled={saving || !name.trim() || !description.trim()}>
          {saving ? (
            "Saving..."
          ) : (
            <>
              <Check className="h-3.5 w-3.5 mr-1.5" />
              Save Plan
            </>
          )}
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

function PlanCard({
  plan,
  onUpdate,
  onDelete,
  onSetDefault,
}: {
  plan: BusinessPlan;
  onUpdate: (id: string, data: Partial<BusinessPlan>) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onSetDefault: (id: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [settingDefault, setSettingDefault] = useState(false);

  async function handleSave(data: { name: string; description: string; is_default: boolean }) {
    setSaving(true);
    await onUpdate(plan.id, data);
    setSaving(false);
    setEditing(false);
  }

  async function handleDelete() {
    if (!confirm(`Delete "${plan.name}"? This cannot be undone.`)) return;
    setDeleting(true);
    await onDelete(plan.id);
  }

  async function handleSetDefault() {
    setSettingDefault(true);
    await onSetDefault(plan.id);
    setSettingDefault(false);
  }

  return (
    <Card className={cn("transition-all duration-200", plan.is_default && "ring-1 ring-amber-500/30 shadow-lifted")}>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-2.5 min-w-0">
            <div className={cn(
              "h-8 w-8 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5",
              plan.is_default ? "bg-primary/10" : "bg-muted/30"
            )}>
              <BookOpen className={cn("h-4 w-4", plan.is_default ? "text-primary" : "text-muted-foreground")} />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <CardTitle className="text-base leading-tight font-display">{plan.name}</CardTitle>
                {plan.is_default && (
                  <span className="inline-flex items-center gap-1 text-2xs font-semibold px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20">
                    <Star className="h-3 w-3 fill-amber-400 text-amber-400" />
                    Default
                  </span>
                )}
              </div>
              <p className="text-2xs text-muted-foreground mt-0.5">
                Updated {new Date(plan.updated_at).toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                })}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-0.5 flex-shrink-0">
            {!plan.is_default && (
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-muted-foreground hover:text-amber-400"
                onClick={handleSetDefault}
                disabled={settingDefault}
                title="Set as default"
              >
                <Star className="h-3.5 w-3.5" />
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-muted-foreground hover:text-foreground"
              onClick={() => setEditing((v) => !v)}
              title="Edit"
            >
              <Pencil className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-muted-foreground hover:text-red-400"
              onClick={handleDelete}
              disabled={deleting}
              title="Delete"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="pt-0">
        {editing ? (
          <PlanForm
            initial={{ name: plan.name, description: plan.description, is_default: plan.is_default }}
            onSave={handleSave}
            onCancel={() => setEditing(false)}
            saving={saving}
          />
        ) : (
          <div>
            <div
              className={cn(
                "text-sm text-muted-foreground leading-relaxed whitespace-pre-wrap",
                !expanded && "line-clamp-3"
              )}
            >
              {plan.description}
            </div>
            {plan.description.length > 200 && (
              <button
                onClick={() => setExpanded((v) => !v)}
                className="flex items-center gap-1 text-xs text-primary mt-1.5 hover:underline"
              >
                {expanded ? (
                  <>
                    <ChevronUp className="h-3 w-3" />
                    Show less
                  </>
                ) : (
                  <>
                    <ChevronDown className="h-3 w-3" />
                    Show more
                  </>
                )}
              </button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function BusinessPlansPage() {
  const [plans, setPlans] = useState<BusinessPlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadPlans();
  }, []);

  async function loadPlans() {
    try {
      const res = await fetch("/api/business-plans");
      const json = await res.json();
      if (json.data) setPlans(json.data);
    } catch (err) {
      console.error("Failed to load business plans:", err);
    } finally {
      setLoading(false);
    }
  }

  async function handleCreate(data: { name: string; description: string; is_default: boolean }) {
    setSaving(true);
    try {
      const res = await fetch("/api/business-plans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      if (data.is_default) {
        await loadPlans();
      } else {
        setPlans((prev) => [json.data, ...prev]);
      }
      setCreating(false);
    } catch (err) {
      console.error("Failed to create plan:", err);
    } finally {
      setSaving(false);
    }
  }

  async function handleUpdate(id: string, data: Partial<BusinessPlan>) {
    try {
      const res = await fetch(`/api/business-plans/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      if ("is_default" in data) {
        await loadPlans();
      } else {
        setPlans((prev) =>
          prev.map((p) => (p.id === id ? { ...p, ...json.data } : p))
        );
      }
    } catch (err) {
      console.error("Failed to update plan:", err);
    }
  }

  async function handleDelete(id: string) {
    try {
      const res = await fetch(`/api/business-plans/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Delete failed");
      setPlans((prev) => prev.filter((p) => p.id !== id));
    } catch (err) {
      console.error("Failed to delete plan:", err);
    }
  }

  async function handleSetDefault(id: string) {
    try {
      const res = await fetch(`/api/business-plans/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "setDefault" }),
      });
      if (!res.ok) throw new Error("Failed to set default");
      await loadPlans();
    } catch (err) {
      console.error("Failed to set default:", err);
    }
  }

  return (
    <div className="min-h-screen bg-background noise">
      {/* ── Header ── */}
      <header className="sticky top-0 z-20 border-b border-border/40 bg-card/80 backdrop-blur-xl">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 flex items-center justify-between h-14">
          <div className="flex items-center gap-3">
            <Link
              href="/"
              className="h-8 w-8 rounded-lg bg-muted/30 flex items-center justify-center hover:bg-muted/50 transition-colors"
            >
              <ArrowLeft className="h-4 w-4 text-muted-foreground" />
            </Link>
            <div>
              <h1 className="font-display text-sm leading-none">Business Plans</h1>
              <p className="text-2xs text-muted-foreground mt-0.5">Investment strategy library</p>
            </div>
          </div>
          {!creating && (
            <Button
              size="sm"
              className="font-semibold h-8 text-xs"
              onClick={() => setCreating(true)}
            >
              <Plus className="h-3.5 w-3.5 mr-1.5" />
              New Plan
            </Button>
          )}
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 sm:px-6 py-8 flex flex-col gap-5">
        {/* Explainer */}
        <div className="bg-primary/[0.05] border border-primary/15 rounded-xl p-4 text-sm text-muted-foreground leading-relaxed">
          <p className="font-display text-foreground mb-1">What are Business Plans?</p>
          <p>
            Save your investment strategy once and attach it to every OM analysis. The AI uses your plan
            to calibrate its analysis — so it doesn&apos;t flag intentional conditions (like vacant
            buildings or missing rent rolls) as risks. The <strong className="text-foreground">default plan</strong> is
            auto-selected whenever you upload an OM.
          </p>
        </div>

        {/* Create form */}
        {creating && (
          <Card className="border-primary/20 bg-primary/[0.03]">
            <CardHeader className="pb-0">
              <CardTitle className="flex items-center gap-2 text-base font-display">
                <Plus className="h-4 w-4 text-primary" />
                New Business Plan
              </CardTitle>
            </CardHeader>
            <CardContent>
              <PlanForm
                onSave={handleCreate}
                onCancel={() => setCreating(false)}
                saving={saving}
              />
            </CardContent>
          </Card>
        )}

        {/* Plans list */}
        {loading ? (
          <div className="flex flex-col gap-4">
            {[1, 2].map((i) => (
              <div key={i} className="h-36 rounded-xl border border-border/40 bg-card/30 animate-pulse shadow-card" />
            ))}
          </div>
        ) : plans.length === 0 && !creating ? (
          <div className="text-center py-20">
            <div className="w-16 h-16 rounded-2xl bg-muted/30 flex items-center justify-center mx-auto mb-4">
              <BookOpen className="h-7 w-7 text-muted-foreground/30" />
            </div>
            <h2 className="font-display text-lg mb-1.5">No business plans yet</h2>
            <p className="text-sm text-muted-foreground mb-6 max-w-sm mx-auto">
              Create a plan to pre-fill deal context on every OM analysis. Your investment thesis,
              strategy, and constraints — written once, applied everywhere.
            </p>
            <Button onClick={() => setCreating(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Create your first plan
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {plans.map((plan) => (
              <PlanCard
                key={plan.id}
                plan={plan}
                onUpdate={handleUpdate}
                onDelete={handleDelete}
                onSetDefault={handleSetDefault}
              />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

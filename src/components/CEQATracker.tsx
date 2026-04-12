"use client";

import React, { useState, useEffect, useCallback } from "react";
import { v4 as uuidv4 } from "uuid";
import {
  ChevronDown, ChevronUp, Plus, Trash2, Save, Loader2,
  Scale, AlertTriangle, Calendar, FileText, CheckCircle2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import type {
  CEQAData, CEQAPathway, CEQAStep, CEQAMitigation, CEQAHearing, CEQAStepStatus,
} from "@/lib/types";
import {
  CEQA_PATHWAY_LABELS, CEQA_STEP_STATUS_CONFIG, CEQA_PATHWAY_STEPS,
  CEQA_MITIGATION_CATEGORIES,
} from "@/lib/types";

const DEFAULT_CEQA: CEQAData = {
  pathway: "not_applicable",
  steps: [],
  mitigations: [],
  hearings: [],
  consultant_name: "",
  consultant_contact: "",
  estimated_total_cost: 0,
  estimated_duration_months: 0,
  notes: "",
};

const fc = (n: number) => n || n === 0 ? "$" + Math.round(n).toLocaleString("en-US") : "—";
const fn = (n: number) => n || n === 0 ? Math.round(n).toLocaleString("en-US") : "—";

function StatusBadge({ status, onClick }: { status: CEQAStepStatus; onClick?: () => void }) {
  const cfg = CEQA_STEP_STATUS_CONFIG[status];
  return (
    <button onClick={onClick} className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${cfg.color} hover:opacity-80 transition-opacity`}>
      {cfg.label}
    </button>
  );
}

const STATUS_CYCLE: CEQAStepStatus[] = ["not_started", "in_progress", "complete", "blocked", "na"];

export default function CEQATracker({ dealId }: { dealId: string }) {
  const [data, setData] = useState<CEQAData>(DEFAULT_CEQA);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    steps: true, mitigations: true, hearings: false, consultant: false,
  });

  const toggle = (key: string) => setExpandedSections(p => ({ ...p, [key]: !p[key] }));

  // Load CEQA data from deal's underwriting JSONB (ceqa field)
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/deals/${dealId}/ceqa`);
        if (res.ok) {
          const json = await res.json();
          if (json.data) setData({ ...DEFAULT_CEQA, ...json.data });
        }
      } catch { /* first load, no data yet */ }
      setLoading(false);
    })();
  }, [dealId]);

  const save = useCallback(async () => {
    setSaving(true);
    try {
      const res = await fetch(`/api/deals/${dealId}/ceqa`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data }),
      });
      if (!res.ok) throw new Error("Save failed");
      toast.success("CEQA tracker saved");
    } catch {
      toast.error("Failed to save CEQA tracker");
    }
    setSaving(false);
  }, [dealId, data]);

  // Auto-save on changes (debounced)
  useEffect(() => {
    if (loading) return;
    const t = setTimeout(save, 2000);
    return () => clearTimeout(t);
  }, [data, loading, save]);

  const setPathway = (pathway: CEQAPathway) => {
    const steps: CEQAStep[] = CEQA_PATHWAY_STEPS[pathway].map((label, i) => ({
      id: uuidv4(), label, status: "not_started", due_date: null, completed_date: null, notes: null, sort_order: i,
    }));
    setData(p => ({ ...p, pathway, steps }));
  };

  const cycleStatus = (stepId: string) => {
    setData(p => ({
      ...p,
      steps: p.steps.map(s => {
        if (s.id !== stepId) return s;
        const idx = STATUS_CYCLE.indexOf(s.status);
        const next = STATUS_CYCLE[(idx + 1) % STATUS_CYCLE.length];
        return { ...s, status: next, completed_date: next === "complete" ? new Date().toISOString().split("T")[0] : s.completed_date };
      }),
    }));
  };

  const cycleMitigationStatus = (id: string) => {
    setData(p => ({
      ...p,
      mitigations: p.mitigations.map(m => {
        if (m.id !== id) return m;
        const idx = STATUS_CYCLE.indexOf(m.status);
        return { ...m, status: STATUS_CYCLE[(idx + 1) % STATUS_CYCLE.length] };
      }),
    }));
  };

  const addMitigation = () => {
    setData(p => ({
      ...p,
      mitigations: [...p.mitigations, {
        id: uuidv4(), category: "Traffic & Transportation", measure: "", estimated_cost: 0,
        status: "not_started", responsible_party: "", notes: null, sort_order: p.mitigations.length,
      }],
    }));
  };

  const addHearing = () => {
    setData(p => ({
      ...p,
      hearings: [...p.hearings, {
        id: uuidv4(), hearing_type: "Planning Commission", date: null,
        location: "", status: "not_started", outcome: null, notes: null,
      }],
    }));
  };

  if (loading) return <div className="flex items-center justify-center py-12"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;

  const completedSteps = data.steps.filter(s => s.status === "complete").length;
  const totalSteps = data.steps.length;
  const totalMitigationCost = data.mitigations.reduce((s, m) => s + m.estimated_cost, 0);
  const isExempt = data.pathway.startsWith("exempt_") || data.pathway.startsWith("streamlined_");

  return (
    <div className="space-y-4">
      {/* Pathway selector */}
      <div className="border rounded-lg p-4 bg-card">
        <div className="flex items-center gap-2 mb-3">
          <Scale className="h-4 w-4 text-amber-400" />
          <h3 className="text-sm font-semibold">CEQA Pathway</h3>
          {saving && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground ml-auto" />}
        </div>
        <select
          value={data.pathway}
          onChange={e => setPathway(e.target.value as CEQAPathway)}
          className="w-full bg-background border rounded-md px-3 py-2 text-sm outline-none mb-3"
        >
          <optgroup label="Exemptions">
            <option value="exempt_categorical">Categorical Exemption</option>
            <option value="exempt_statutory">Statutory Exemption</option>
            <option value="exempt_common_sense">Common Sense Exemption</option>
            <option value="exempt_class_32_infill">Class 32 — Infill Development</option>
          </optgroup>
          <optgroup label="Environmental Review">
            <option value="negative_declaration">Negative Declaration (ND)</option>
            <option value="mitigated_neg_dec">Mitigated Negative Declaration (MND)</option>
            <option value="eir">Environmental Impact Report (EIR)</option>
          </optgroup>
          <optgroup label="Streamlined">
            <option value="streamlined_sb35">SB 35 Streamlining</option>
            <option value="streamlined_sb423">SB 423 (Builder&apos;s Remedy)</option>
          </optgroup>
          <option value="not_applicable">Not Applicable (Non-CA)</option>
        </select>

        {isExempt && (
          <div className="flex items-center gap-2 text-emerald-400 text-sm bg-emerald-500/10 rounded-md px-3 py-2">
            <CheckCircle2 className="h-4 w-4" />
            {data.pathway.startsWith("streamlined_") ? "Ministerial approval — CEQA review not required" : "Exempt pathway — reduced environmental review"}
          </div>
        )}
        {data.pathway === "eir" && (
          <div className="flex items-center gap-2 text-amber-400 text-sm bg-amber-500/10 rounded-md px-3 py-2">
            <AlertTriangle className="h-4 w-4" />
            Full EIR typically adds 12-24 months and $200K-$1M+ to project timeline and budget
          </div>
        )}
      </div>

      {/* Process overview */}
      {data.pathway !== "not_applicable" && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="border rounded-md p-3 bg-card">
            <p className="text-xs text-muted-foreground">Progress</p>
            <p className="text-lg font-semibold">{completedSteps}/{totalSteps}</p>
            {totalSteps > 0 && (
              <div className="h-1.5 rounded-full bg-muted/30 mt-1 overflow-hidden">
                <div className="h-full bg-emerald-500 rounded-full transition-all" style={{ width: `${(completedSteps / totalSteps) * 100}%` }} />
              </div>
            )}
          </div>
          <div className="border rounded-md p-3 bg-card">
            <p className="text-xs text-muted-foreground">Est. Duration</p>
            <p className="text-lg font-semibold">{data.estimated_duration_months || "—"} <span className="text-sm font-normal text-muted-foreground">months</span></p>
          </div>
          <div className="border rounded-md p-3 bg-card">
            <p className="text-xs text-muted-foreground">Est. Cost</p>
            <p className="text-lg font-semibold">{fc(data.estimated_total_cost)}</p>
          </div>
          <div className="border rounded-md p-3 bg-card">
            <p className="text-xs text-muted-foreground">Mitigation Cost</p>
            <p className="text-lg font-semibold">{fc(totalMitigationCost)}</p>
          </div>
        </div>
      )}

      {/* Process Steps */}
      {data.steps.length > 0 && (
        <div className="border rounded-lg bg-card overflow-hidden">
          <button onClick={() => toggle("steps")} className="w-full flex items-center justify-between px-4 py-3 hover:bg-muted/10 transition-colors">
            <div className="flex items-center gap-2">
              <FileText className="h-4 w-4 text-blue-400" />
              <h3 className="text-sm font-semibold">Process Steps</h3>
              <span className="text-xs text-muted-foreground">({completedSteps}/{totalSteps} complete)</span>
            </div>
            {expandedSections.steps ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>
          {expandedSections.steps && (
            <div className="px-4 pb-4">
              <table className="w-full text-sm">
                <tbody>
                  {data.steps.map((step, i) => (
                    <tr key={step.id} className="border-t hover:bg-muted/5">
                      <td className="py-2 pr-2 text-muted-foreground text-xs w-[24px]">{i + 1}</td>
                      <td className="py-2 pr-2">{step.label}</td>
                      <td className="py-2 pr-2 w-[120px]">
                        <input type="date" value={step.due_date || ""} onChange={e => setData(p => ({ ...p, steps: p.steps.map(s => s.id === step.id ? { ...s, due_date: e.target.value || null } : s) }))} className="bg-transparent text-xs outline-none text-muted-foreground" />
                      </td>
                      <td className="py-2 w-[100px]">
                        <StatusBadge status={step.status} onClick={() => cycleStatus(step.id)} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Mitigation Measures */}
      {(data.pathway === "mitigated_neg_dec" || data.pathway === "eir" || data.mitigations.length > 0) && (
        <div className="border rounded-lg bg-card overflow-hidden">
          <button onClick={() => toggle("mitigations")} className="w-full flex items-center justify-between px-4 py-3 hover:bg-muted/10 transition-colors">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-400" />
              <h3 className="text-sm font-semibold">Mitigation Measures</h3>
              {data.mitigations.length > 0 && <span className="text-xs text-muted-foreground">({data.mitigations.length} measures, {fc(totalMitigationCost)} total)</span>}
            </div>
            {expandedSections.mitigations ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>
          {expandedSections.mitigations && (
            <div className="px-4 pb-4">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="bg-muted/30 border-b">
                    <th className="text-left px-2 py-1.5 text-xs font-medium text-muted-foreground">Category</th>
                    <th className="text-left px-2 py-1.5 text-xs font-medium text-muted-foreground">Measure</th>
                    <th className="text-right px-2 py-1.5 text-xs font-medium text-muted-foreground w-[100px]">Est. Cost</th>
                    <th className="text-left px-2 py-1.5 text-xs font-medium text-muted-foreground w-[120px]">Responsible</th>
                    <th className="text-center px-2 py-1.5 text-xs font-medium text-muted-foreground w-[90px]">Status</th>
                    <th className="w-[28px]" />
                  </tr>
                </thead>
                <tbody>
                  {data.mitigations.map(mit => (
                    <tr key={mit.id} className="border-b hover:bg-muted/5 group">
                      <td className="px-2 py-1.5">
                        <select value={mit.category} onChange={e => setData(p => ({ ...p, mitigations: p.mitigations.map(m => m.id === mit.id ? { ...m, category: e.target.value } : m) }))} className="bg-transparent text-xs outline-none w-full">
                          {CEQA_MITIGATION_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                        </select>
                      </td>
                      <td className="px-2 py-1.5">
                        <input type="text" value={mit.measure} onChange={e => setData(p => ({ ...p, mitigations: p.mitigations.map(m => m.id === mit.id ? { ...m, measure: e.target.value } : m) }))} placeholder="Describe mitigation..." className="w-full bg-transparent text-sm outline-none" />
                      </td>
                      <td className="px-2 py-1.5">
                        <input type="text" inputMode="decimal" value={mit.estimated_cost || ""} onChange={e => setData(p => ({ ...p, mitigations: p.mitigations.map(m => m.id === mit.id ? { ...m, estimated_cost: parseFloat(e.target.value.replace(/,/g, "")) || 0 } : m) }))} placeholder="$0" className="w-full bg-transparent text-sm outline-none text-right tabular-nums" />
                      </td>
                      <td className="px-2 py-1.5">
                        <input type="text" value={mit.responsible_party} onChange={e => setData(p => ({ ...p, mitigations: p.mitigations.map(m => m.id === mit.id ? { ...m, responsible_party: e.target.value } : m) }))} placeholder="Who" className="w-full bg-transparent text-sm outline-none" />
                      </td>
                      <td className="px-2 py-1.5 text-center">
                        <StatusBadge status={mit.status} onClick={() => cycleMitigationStatus(mit.id)} />
                      </td>
                      <td className="px-1 py-1.5">
                        <button onClick={() => setData(p => ({ ...p, mitigations: p.mitigations.filter(m => m.id !== mit.id) }))} className="text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity"><Trash2 className="h-3.5 w-3.5" /></button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <Button variant="ghost" size="sm" className="mt-2" onClick={addMitigation}>
                <Plus className="h-3.5 w-3.5 mr-1" /> Add Mitigation
              </Button>
            </div>
          )}
        </div>
      )}

      {/* Public Hearings */}
      {data.pathway !== "not_applicable" && (
        <div className="border rounded-lg bg-card overflow-hidden">
          <button onClick={() => toggle("hearings")} className="w-full flex items-center justify-between px-4 py-3 hover:bg-muted/10 transition-colors">
            <div className="flex items-center gap-2">
              <Calendar className="h-4 w-4 text-purple-400" />
              <h3 className="text-sm font-semibold">Public Hearings & Comment Periods</h3>
            </div>
            {expandedSections.hearings ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>
          {expandedSections.hearings && (
            <div className="px-4 pb-4">
              {data.hearings.length === 0 && <p className="text-sm text-muted-foreground py-2">No hearings scheduled yet.</p>}
              {data.hearings.map(h => (
                <div key={h.id} className="border rounded-md p-3 mb-2 bg-muted/5 group relative">
                  <button onClick={() => setData(p => ({ ...p, hearings: p.hearings.filter(hr => hr.id !== h.id) }))} className="absolute top-2 right-2 text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100"><Trash2 className="h-3.5 w-3.5" /></button>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <div>
                      <label className="block text-xs text-muted-foreground mb-1">Type</label>
                      <select value={h.hearing_type} onChange={e => setData(p => ({ ...p, hearings: p.hearings.map(hr => hr.id === h.id ? { ...hr, hearing_type: e.target.value } : hr) }))} className="w-full bg-background border rounded-md px-2 py-1.5 text-sm outline-none">
                        <option>Planning Commission</option>
                        <option>City Council</option>
                        <option>Public Comment Period</option>
                        <option>Scoping Meeting</option>
                        <option>Community Meeting</option>
                        <option>Appeals Hearing</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs text-muted-foreground mb-1">Date</label>
                      <input type="date" value={h.date || ""} onChange={e => setData(p => ({ ...p, hearings: p.hearings.map(hr => hr.id === h.id ? { ...hr, date: e.target.value || null } : hr) }))} className="w-full bg-background border rounded-md px-2 py-1.5 text-sm outline-none" />
                    </div>
                    <div>
                      <label className="block text-xs text-muted-foreground mb-1">Location</label>
                      <input type="text" value={h.location} onChange={e => setData(p => ({ ...p, hearings: p.hearings.map(hr => hr.id === h.id ? { ...hr, location: e.target.value } : hr) }))} placeholder="City Hall, Rm 200" className="w-full bg-background border rounded-md px-2 py-1.5 text-sm outline-none" />
                    </div>
                    <div>
                      <label className="block text-xs text-muted-foreground mb-1">Outcome</label>
                      <input type="text" value={h.outcome || ""} onChange={e => setData(p => ({ ...p, hearings: p.hearings.map(hr => hr.id === h.id ? { ...hr, outcome: e.target.value } : hr) }))} placeholder="Approved / Denied / Continued" className="w-full bg-background border rounded-md px-2 py-1.5 text-sm outline-none" />
                    </div>
                  </div>
                </div>
              ))}
              <Button variant="ghost" size="sm" className="mt-1" onClick={addHearing}>
                <Plus className="h-3.5 w-3.5 mr-1" /> Add Hearing
              </Button>
            </div>
          )}
        </div>
      )}

      {/* Consultant & Cost */}
      {data.pathway !== "not_applicable" && (
        <div className="border rounded-lg bg-card overflow-hidden">
          <button onClick={() => toggle("consultant")} className="w-full flex items-center justify-between px-4 py-3 hover:bg-muted/10 transition-colors">
            <div className="flex items-center gap-2">
              <DollarSign className="h-4 w-4 text-green-400" />
              <h3 className="text-sm font-semibold">Consultant & Budget</h3>
            </div>
            {expandedSections.consultant ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>
          {expandedSections.consultant && (
            <div className="px-4 pb-4 space-y-3">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1">CEQA Consultant</label>
                  <input type="text" value={data.consultant_name} onChange={e => setData(p => ({ ...p, consultant_name: e.target.value }))} placeholder="Firm name" className="w-full border rounded-md px-2 py-1.5 text-sm bg-background outline-none" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1">Contact</label>
                  <input type="text" value={data.consultant_contact} onChange={e => setData(p => ({ ...p, consultant_contact: e.target.value }))} placeholder="Name / phone / email" className="w-full border rounded-md px-2 py-1.5 text-sm bg-background outline-none" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1">Estimated CEQA Cost</label>
                  <input type="text" inputMode="decimal" value={data.estimated_total_cost || ""} onChange={e => setData(p => ({ ...p, estimated_total_cost: parseFloat(e.target.value.replace(/[^0-9.]/g, "")) || 0 }))} placeholder="$0" className="w-full border rounded-md px-2 py-1.5 text-sm bg-background outline-none" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1">Estimated Duration (months)</label>
                  <input type="number" value={data.estimated_duration_months || ""} onChange={e => setData(p => ({ ...p, estimated_duration_months: parseInt(e.target.value) || 0 }))} className="w-full border rounded-md px-2 py-1.5 text-sm bg-background outline-none" />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">Notes</label>
                <textarea value={data.notes} onChange={e => setData(p => ({ ...p, notes: e.target.value }))} rows={3} placeholder="Strategy notes, exemption basis, timeline risks..." className="w-full border rounded-md px-2 py-1.5 text-sm bg-background outline-none resize-none" />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

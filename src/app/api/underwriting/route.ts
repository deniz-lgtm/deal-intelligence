import { NextResponse } from "next/server";
import { underwritingQueries, underwritingPerMassingQueries } from "@/lib/db";
import { v4 as uuidv4 } from "uuid";
import { requireAuth, requireDealAccess, syncCurrentUser } from "@/lib/auth";

// Opt out of static analysis at `next build`. Routes that call requireAuth()
// hit Clerk's auth() which reads headers(), which fails Next.js's static-page
// generation phase unless the route is explicitly marked dynamic.
export const dynamic = "force-dynamic";

type LegacyUw = { id: string; deal_id: string; data: unknown; updated_at: string };
type MassingRow = {
  id: string;
  deal_id: string;
  site_plan_scenario_id: string;
  data: unknown;
  updated_at: string;
};

function parseData(data: unknown): Record<string, unknown> {
  if (!data) return {};
  if (typeof data === "string") {
    try { return JSON.parse(data); } catch { return {}; }
  }
  return data as Record<string, unknown>;
}

function massingsFromLegacy(legacyData: Record<string, unknown>): Array<{ id: string; name?: string; is_base_case?: boolean }> {
  const sp = (legacyData.site_plan as { scenarios?: Array<{ id?: string; name?: string; is_base_case?: boolean }> } | undefined);
  const scenarios = Array.isArray(sp?.scenarios) ? sp!.scenarios! : [];
  return scenarios
    .map(s => ({ id: String(s.id || ""), name: s.name, is_base_case: s.is_base_case }))
    .filter(s => s.id.length > 0);
}

function pickBaseCaseId(massings: Array<{ id: string; is_base_case?: boolean }>): string | null {
  if (massings.length === 0) return null;
  const flagged = massings.find(m => m.is_base_case);
  return (flagged || massings[0]).id;
}

// Shape a legacy UWData blob into a per-massing snapshot: narrow
// building_program.scenarios to just those tied to this massing, and
// flag active_scenario_id accordingly. If the legacy blob has a matching
// `uw_scenarios[]` entry (old pre-per-massing storage) use that as the
// richer starting point — otherwise copy the legacy blob verbatim.
function projectLegacyToMassing(legacyData: Record<string, unknown>, massingId: string): Record<string, unknown> {
  const uwScenarios = Array.isArray((legacyData as { uw_scenarios?: Array<{ site_plan_scenario_id?: string; state?: Record<string, unknown> }> }).uw_scenarios)
    ? (legacyData as { uw_scenarios: Array<{ site_plan_scenario_id?: string; state?: Record<string, unknown> }> }).uw_scenarios
    : [];
  const prior = uwScenarios.find(x => x.site_plan_scenario_id === massingId && x.state);
  const starting = prior?.state ? { ...prior.state } : { ...legacyData };
  // Never let a per-massing snapshot carry the shared site_plan or the
  // deal-wide `uw_scenarios` list (that's a legacy multi-massing store
  // we're replacing). Always re-sync site_plan from the legacy row.
  if (legacyData.site_plan !== undefined) starting.site_plan = legacyData.site_plan;
  delete (starting as Record<string, unknown>).uw_scenarios;

  const bp = starting.building_program as { scenarios?: Array<{ id?: string; site_plan_scenario_id?: string }>; active_scenario_id?: string } | undefined;
  const scenarios = Array.isArray(bp?.scenarios) ? bp!.scenarios! : [];
  const ownScenarios = scenarios.filter(s => (s.site_plan_scenario_id || "") === massingId);
  const activeForMassing = ownScenarios.some(s => s.id === bp?.active_scenario_id)
    ? bp!.active_scenario_id!
    : (ownScenarios[0]?.id || null);
  return {
    ...starting,
    building_program: {
      ...(bp || {}),
      scenarios: ownScenarios,
      active_scenario_id: activeForMassing,
    },
  };
}

// Lazy migration: if the deal has no per-massing rows yet but does have
// a legacy `underwriting` blob with site_plan.scenarios[], split the
// legacy data into one row per massing. Idempotent — returns the list
// of rows present after the call.
async function ensurePerMassingRows(dealId: string, legacy: LegacyUw | null): Promise<MassingRow[]> {
  const existing = (await underwritingPerMassingQueries.listByDealId(dealId)) as MassingRow[];
  if (existing.length > 0) return existing;
  if (!legacy) return [];
  const legacyData = parseData(legacy.data);
  const massings = massingsFromLegacy(legacyData);
  if (massings.length === 0) return [];
  for (const m of massings) {
    const projected = projectLegacyToMassing(legacyData, m.id);
    await underwritingPerMassingQueries.upsert(dealId, m.id, uuidv4(), JSON.stringify(projected));
  }
  return (await underwritingPerMassingQueries.listByDealId(dealId)) as MassingRow[];
}

export async function GET(req: Request) {
  const { userId, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  await syncCurrentUser(userId);

  try {
    const { searchParams } = new URL(req.url);
    const dealId = searchParams.get("deal_id");
    const massingId = searchParams.get("massing_id");
    if (!dealId) {
      return NextResponse.json({ error: "deal_id is required" }, { status: 400 });
    }

    const { errorResponse: accessError } = await requireDealAccess(dealId, userId);
    if (accessError) return accessError;

    const legacy = (await underwritingQueries.getByDealId(dealId)) as LegacyUw | null;

    // No massing requested → legacy shape for backward compatibility.
    // Every existing caller (background routes, other pages that haven't
    // migrated to massing-awareness yet) keeps working against the
    // legacy blob.
    if (!massingId) {
      // Best effort: lazy-migrate so next per-massing GET is fast.
      await ensurePerMassingRows(dealId, legacy).catch(() => {});
      return NextResponse.json({ data: legacy || null });
    }

    // Per-massing path. Try the row first, then lazy-migrate, then
    // synthesize a projected row from the legacy blob if the analyst is
    // opening a massing that was never saved under the new schema.
    let row = (await underwritingPerMassingQueries.getByDealAndMassing(dealId, massingId)) as MassingRow | null;
    if (!row) {
      await ensurePerMassingRows(dealId, legacy).catch(() => {});
      row = (await underwritingPerMassingQueries.getByDealAndMassing(dealId, massingId)) as MassingRow | null;
    }

    // Even after ensurePerMassingRows, a freshly created massing (added
    // after the deal was migrated) won't have a row. Return null so the
    // UI can trigger its first-open prompt.
    return NextResponse.json({
      data: row,
      legacy: legacy || null,
      massings: legacy ? massingsFromLegacy(parseData(legacy.data)) : [],
      base_case_massing_id: legacy ? pickBaseCaseId(massingsFromLegacy(parseData(legacy.data))) : null,
    });
  } catch (err) {
    console.error("Error fetching underwriting:", err);
    return NextResponse.json({ error: "Failed to fetch underwriting" }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  const { userId, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  await syncCurrentUser(userId);

  try {
    const body = await req.json();
    const { deal_id, massing_id, data } = body;
    if (!deal_id) {
      return NextResponse.json({ error: "deal_id is required" }, { status: 400 });
    }

    const { errorResponse: accessError } = await requireDealAccess(deal_id, userId);
    if (accessError) return accessError;

    const dataStr = typeof data === "string" ? data : JSON.stringify(data);

    // Per-massing write. Override `site_plan` in the incoming payload
    // with whatever the legacy row already holds — site_plan is shared
    // across all massings and only Site & Zoning is allowed to mutate
    // it (via a legacy PUT). Also mirror this snapshot into the legacy
    // row when it's the base-case massing (or when there's no base case
    // yet) so background routes that haven't been taught about
    // `massing_id` keep returning sensible numbers.
    if (massing_id) {
      const legacy = (await underwritingQueries.getByDealId(deal_id)) as LegacyUw | null;
      const legacyData = legacy ? parseData(legacy.data) : {};
      const incomingData = parseData(dataStr);
      // Narrow building_program.scenarios to just this massing's own
      // scenarios so per-massing snapshots stay self-contained (and the
      // UW page's massing tab strip doesn't leak Other Massings' floor
      // stacks into the current view).
      const bp = incomingData.building_program as { scenarios?: Array<{ id?: string; site_plan_scenario_id?: string }>; active_scenario_id?: string } | undefined;
      const ownScenarios = Array.isArray(bp?.scenarios)
        ? bp!.scenarios!.filter(s => (s.site_plan_scenario_id || "") === massing_id)
        : [];
      const sanitized = {
        ...incomingData,
        ...(legacyData.site_plan !== undefined ? { site_plan: legacyData.site_plan } : {}),
        ...(bp !== undefined
          ? {
              building_program: {
                ...bp,
                scenarios: ownScenarios,
                active_scenario_id: ownScenarios.some(s => s.id === bp.active_scenario_id)
                  ? bp.active_scenario_id
                  : (ownScenarios[0]?.id || null),
              },
            }
          : {}),
      };
      const sanitizedStr = JSON.stringify(sanitized);

      const existingRow = (await underwritingPerMassingQueries.getByDealAndMassing(deal_id, massing_id)) as MassingRow | null;
      const id = existingRow?.id || uuidv4();
      const result = await underwritingPerMassingQueries.upsert(deal_id, massing_id, id, sanitizedStr);

      const baseId = pickBaseCaseId(massingsFromLegacy(legacyData));
      if (!legacy || !baseId || baseId === massing_id) {
        const legacyId = legacy?.id || uuidv4();
        await underwritingQueries.upsert(deal_id, legacyId, sanitizedStr);
      }
      return NextResponse.json({ data: result });
    }

    // Legacy write (no massing). Upsert the legacy row, then:
    //  - mirror the same blob into the base-case per-massing row (if any)
    //  - patch just `site_plan` onto every other per-massing row so the
    //    massings list, parcel footprints, etc. stay consistent across
    //    snapshots without overwriting analyst-tuned massing fields.
    const existing = (await underwritingQueries.getByDealId(deal_id)) as LegacyUw | null;
    const id = existing?.id || uuidv4();
    const result = await underwritingQueries.upsert(deal_id, id, dataStr);
    const parsedLegacy = parseData(dataStr);
    const baseId = pickBaseCaseId(massingsFromLegacy(parsedLegacy));
    if (baseId) {
      const baseRow = (await underwritingPerMassingQueries.getByDealAndMassing(deal_id, baseId)) as MassingRow | null;
      const baseRowId = baseRow?.id || uuidv4();
      await underwritingPerMassingQueries.upsert(deal_id, baseId, baseRowId, JSON.stringify(projectLegacyToMassing(parsedLegacy, baseId)));
    }
    if (parsedLegacy.site_plan !== undefined) {
      await underwritingPerMassingQueries.patchAll(deal_id, { site_plan: parsedLegacy.site_plan });
    }
    return NextResponse.json({ data: result });
  } catch (err) {
    console.error("Error saving underwriting:", err);
    return NextResponse.json({ error: "Failed to save underwriting" }, { status: 500 });
  }
}

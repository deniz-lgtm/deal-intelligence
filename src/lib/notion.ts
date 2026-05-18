/**
 * Notion integration
 *
 * Notion is the team-facing source of truth. Deal Intelligence keeps local
 * workbench data and only pushes approved records into Notion once a deal is
 * linked to a Pipeline project.
 */

import { Client } from "@notionhq/client";
import { randomUUID } from "crypto";
import type { DealStatus, PropertyType } from "./types";
import type { OmAnalysisRow } from "./db";
import { dealQueries, notionSyncQueries } from "./db";

function getClient() {
  if (!process.env.NOTION_API_KEY) {
    throw new Error("NOTION_API_KEY is not configured");
  }
  return new Client({ auth: process.env.NOTION_API_KEY });
}

export type NotionDataSourceKey =
  | "pipeline"
  | "tasks"
  | "schedule"
  | "projectDocuments"
  | "meetingsNotes"
  | "issuesRisks"
  | "rfisQuestions"
  | "researchPlaybooks"
  | "contacts"
  | "companies";

const DATA_SOURCES: Record<
  NotionDataSourceKey,
  { env: string; fallback: string; label: string }
> = {
  pipeline: {
    env: "NOTION_PIPELINE_DATA_SOURCE_ID",
    fallback: "260f99e9-4f09-4ea6-a64c-2817b93738ce",
    label: "Pipeline",
  },
  tasks: {
    env: "NOTION_TASKS_DATA_SOURCE_ID",
    fallback: "f0dcd9ad-5064-48d3-955f-09280b210b32",
    label: "Tasks",
  },
  schedule: {
    env: "NOTION_SCHEDULE_DATA_SOURCE_ID",
    fallback: "1cd74ae2-88d6-4d3a-8b97-e83af5bd2b02",
    label: "Schedule",
  },
  projectDocuments: {
    env: "NOTION_PROJECT_DOCUMENTS_DATA_SOURCE_ID",
    fallback: "33d0ae48-2a02-4e8f-bda7-b784ca4bf430",
    label: "Project Documents",
  },
  meetingsNotes: {
    env: "NOTION_MEETINGS_NOTES_DATA_SOURCE_ID",
    fallback: "3b3bd90c-8cec-4a56-95bd-bfa77dd61c71",
    label: "Meetings & Notes",
  },
  issuesRisks: {
    env: "NOTION_ISSUES_RISKS_DATA_SOURCE_ID",
    fallback: "2db916de-e41e-4070-a8bd-29ecdd8aa00b",
    label: "Issues & Risks",
  },
  rfisQuestions: {
    env: "NOTION_RFIS_QUESTIONS_DATA_SOURCE_ID",
    fallback: "de9055af-7f0c-4b66-bba2-c64006237a26",
    label: "RFIs & Questions",
  },
  researchPlaybooks: {
    env: "NOTION_RESEARCH_PLAYBOOKS_DATA_SOURCE_ID",
    fallback: "35f862a5-9d11-809a-8104-000b919b4735",
    label: "Research & Playbooks",
  },
  contacts: {
    env: "NOTION_CONTACTS_DATA_SOURCE_ID",
    fallback: "40d1bd44-2096-4201-aa37-d1f846883b77",
    label: "Contacts",
  },
  companies: {
    env: "NOTION_COMPANIES_DATA_SOURCE_ID",
    fallback: "497806c2-a9b8-478d-bf4d-8e2b35c7399b",
    label: "Companies",
  },
};

export function getNotionDataSourceId(key: NotionDataSourceKey): string {
  const configured = process.env[DATA_SOURCES[key].env];
  return normalizeNotionId(configured || DATA_SOURCES[key].fallback);
}

export function normalizeNotionId(value: string): string {
  const match = value.match(/[0-9a-fA-F]{32}|[0-9a-fA-F-]{36}/);
  if (!match) return value;
  const raw = match[0].replace(/-/g, "");
  return `${raw.slice(0, 8)}-${raw.slice(8, 12)}-${raw.slice(12, 16)}-${raw.slice(16, 20)}-${raw.slice(20)}`;
}

function truncateText(value: unknown, max = 1800): string {
  return String(value ?? "").trim().slice(0, max);
}

function titleProp(value: unknown) {
  return { title: [{ text: { content: truncateText(value || "Untitled", 200) } }] };
}

function richTextProp(value: unknown, max = 1800) {
  const content = truncateText(value, max);
  return { rich_text: content ? [{ text: { content } }] : [] };
}

function selectProp(value: unknown) {
  const name = truncateText(value, 100);
  return name ? { select: { name } } : undefined;
}

function multiSelectProp(values: unknown[]) {
  const options = values.map((value) => truncateText(value, 100)).filter(Boolean);
  return options.length ? { multi_select: options.map((name) => ({ name })) } : undefined;
}

function numberProp(value: unknown) {
  const num = Number(value);
  return Number.isFinite(num) ? { number: num } : undefined;
}

function dateProp(value: unknown) {
  if (!value) return undefined;
  const parsed = new Date(String(value));
  if (Number.isNaN(parsed.getTime())) return undefined;
  return { date: { start: parsed.toISOString().split("T")[0] } };
}

function relationProp(pageId: string) {
  return { relation: [{ id: normalizeNotionId(pageId) }] };
}

function urlProp(value: unknown) {
  const url = truncateText(value, 2000);
  return url ? { url } : undefined;
}

function boolProp(value: unknown) {
  return { checkbox: Boolean(value) };
}

function fullAddress(deal: Record<string, unknown>) {
  return [deal.address, deal.city, deal.state, deal.zip].filter(Boolean).join(", ");
}

function dealUrl(dealId: unknown, path = "") {
  if (!process.env.NEXT_PUBLIC_APP_URL || !dealId) return null;
  return `${process.env.NEXT_PUBLIC_APP_URL}/deals/${dealId}${path}`;
}

function stageForDeal(status: unknown) {
  const value = String(status ?? "").toLowerCase();
  if (value.includes("loi")) return "3. LOI";
  if (value.includes("contract") || value.includes("psa")) return "4. Site Control / PSA";
  if (value.includes("dead")) return "Dead";
  if (value.includes("pursuit") || value.includes("prospect")) return "1. Pursuit";
  return "2. Underwriting";
}

function cleanObject<T extends Record<string, unknown>>(obj: T): T {
  return Object.fromEntries(
    Object.entries(obj).filter(([, value]) => value !== undefined && value !== null)
  ) as T;
}

type CreatedNotionPage = { pageId: string; url: string };

function pageResult(response: { id: string; url?: string }): CreatedNotionPage {
  return {
    pageId: response.id,
    url: response.url ?? `https://notion.so/${response.id.replace(/-/g, "")}`,
  };
}

export async function createPipelineProject(input: {
  deal: Record<string, unknown>;
  notes?: string;
}): Promise<CreatedNotionPage> {
  const notion = getClient();
  const deal = input.deal;
  const address = fullAddress(deal);
  const assetClass = deal.property_type ? [String(deal.property_type).replaceAll("_", " ")] : [];
  const sourceUrl = dealUrl(deal.id);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const properties: Record<string, any> = cleanObject({
    "Project Name": titleProp(deal.name ?? "Untitled Deal"),
    Stage: selectProp(stageForDeal(deal.status)),
    Active: boolProp(!String(deal.status ?? "").toLowerCase().includes("dead")),
    City: selectProp(deal.city),
    State: selectProp(deal.state),
    "Asset Class": multiSelectProp(assetClass),
    Strategy: selectProp(deal.investment_strategy),
    Source: selectProp(deal.auto_ingested ? "Deal Intelligence Inbox" : "Deal Intelligence"),
    Notes: richTextProp(input.notes || deal.notes || deal.context_notes || address),
    "Purchase Price": numberProp(deal.asking_price),
    "Building SF": numberProp(deal.square_footage),
    Units: numberProp(deal.units),
    "Site Acres": numberProp(deal.land_acres),
  });

  const response = await notion.pages.create({
    parent: { type: "data_source_id", data_source_id: getNotionDataSourceId("pipeline") },
    properties,
    children: sourceUrl
      ? [
          {
            object: "block",
            type: "paragraph",
            paragraph: {
              rich_text: [{ text: { content: `Deal Intelligence workspace: ${sourceUrl}` } }],
              color: "gray",
            },
          },
        ]
      : [],
  } as never);

  return pageResult(response as { id: string; url?: string });
}

export async function linkDealToNotionProject(
  dealId: string,
  notionProjectIdOrUrl: string,
  notionUrl?: string
) {
  const pageId = normalizeNotionId(notionProjectIdOrUrl);
  return notionSyncQueries.upsert({
    local_type: "deal",
    local_id: dealId,
    notion_role: "pipeline_project",
    notion_data_source: "pipeline",
    notion_page_id: pageId,
    notion_url: notionUrl ?? `https://notion.so/${pageId.replace(/-/g, "")}`,
    metadata: {},
  });
}

export async function getLinkedNotionProject(dealId: string) {
  return notionSyncQueries.getDealProjectLink(dealId);
}

export async function ensureDealNotionProject(dealId: string) {
  const link = await getLinkedNotionProject(dealId);
  if (!link?.notion_page_id) {
    const error = new Error("Link/Create Notion Project first.");
    error.name = "NotionProjectRequired";
    throw error;
  }
  return link;
}

async function queryByProject(
  key: NotionDataSourceKey,
  projectId: string,
  pageSize = 50
) {
  const notion = getClient();
  const response = await notion.dataSources.query({
    data_source_id: getNotionDataSourceId(key),
    page_size: pageSize,
    filter: {
      property: "Project",
      relation: { contains: normalizeNotionId(projectId) },
    },
  } as never);
  return response.results as Array<Record<string, unknown>>;
}

function getSelectName(page: Record<string, unknown>, prop: string): string {
  const properties = page.properties as Record<string, { select?: { name?: string } }> | undefined;
  return properties?.[prop]?.select?.name ?? "";
}

function getCheckbox(page: Record<string, unknown>, prop: string): boolean {
  const properties = page.properties as Record<string, { checkbox?: boolean }> | undefined;
  return Boolean(properties?.[prop]?.checkbox);
}

function getDate(page: Record<string, unknown>, prop: string): string | null {
  const properties = page.properties as Record<string, { date?: { start?: string } }> | undefined;
  return properties?.[prop]?.date?.start ?? null;
}

function getTitle(page: Record<string, unknown>, prop: string): string {
  const properties = page.properties as Record<string, { title?: Array<{ plain_text?: string }> }> | undefined;
  return properties?.[prop]?.title?.map((part) => part.plain_text ?? "").join("") ?? "Untitled";
}

function getPlainText(page: Record<string, unknown>, prop: string): string {
  const properties = page.properties as Record<
    string,
    {
      rich_text?: Array<{ plain_text?: string }>;
      select?: { name?: string };
      place?: { address?: string; name?: string };
    }
  > | undefined;
  const property = properties?.[prop];
  return (
    property?.rich_text?.map((part) => part.plain_text ?? "").join("") ||
    property?.select?.name ||
    property?.place?.address ||
    property?.place?.name ||
    ""
  );
}

function getNumber(page: Record<string, unknown>, prop: string): number | null {
  const properties = page.properties as Record<string, { number?: number | null }> | undefined;
  const value = properties?.[prop]?.number;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function getMultiSelect(page: Record<string, unknown>, prop: string): string[] {
  const properties = page.properties as Record<string, { multi_select?: Array<{ name?: string }> }> | undefined;
  return properties?.[prop]?.multi_select?.map((item) => item.name ?? "").filter(Boolean) ?? [];
}

function activeTask(page: Record<string, unknown>) {
  const status = getSelectName(page, "Status");
  if (["Done", "Cancelled", "Deferred"].includes(status)) return false;
  if (status && status !== "Not Started") return true;
  if (getCheckbox(page, "Blocker") || getCheckbox(page, "Critical Path")) return true;
  const due = getDate(page, "Due Date");
  if (!due) return false;
  const dueTime = new Date(due).getTime();
  const inThirtyDays = Date.now() + 30 * 24 * 60 * 60 * 1000;
  return Number.isFinite(dueTime) && dueTime <= inThirtyDays;
}

export async function getProjectContext(
  notionProjectId: string,
  _opts: { mode?: "active" } = {}
) {
  const projectId = normalizeNotionId(notionProjectId);
  const [tasks, schedule, risks, rfis, documents, notes] = await Promise.all([
    queryByProject("tasks", projectId, 75).catch(() => []),
    queryByProject("schedule", projectId, 75).catch(() => []),
    queryByProject("issuesRisks", projectId, 50).catch(() => []),
    queryByProject("rfisQuestions", projectId, 50).catch(() => []),
    queryByProject("projectDocuments", projectId, 30).catch(() => []),
    queryByProject("meetingsNotes", projectId, 20).catch(() => []),
  ]);

  return {
    project_id: projectId,
    tasks: tasks.filter(activeTask).map((page) => ({
      id: page.id,
      title: getTitle(page, "Task"),
      status: getSelectName(page, "Status"),
      priority: getSelectName(page, "Priority"),
      due_date: getDate(page, "Due Date"),
      blocker: getCheckbox(page, "Blocker"),
      critical_path: getCheckbox(page, "Critical Path"),
      url: page.url,
    })),
    schedule: schedule
      .filter((page) => getSelectName(page, "Status") !== "Complete")
      .map((page) => ({
        id: page.id,
        title: getTitle(page, "Schedule Item"),
        status: getSelectName(page, "Status"),
        phase: getSelectName(page, "Phase"),
        baseline_date: getDate(page, "Baseline Date"),
        forecast_date: getDate(page, "Forecast / Actual Date"),
        milestone: getCheckbox(page, "Milestone"),
        critical_path: getCheckbox(page, "Critical Path?"),
        url: page.url,
      })),
    risks: risks
      .filter((page) => !["Resolved", "Closed"].includes(getSelectName(page, "Status")))
      .map((page) => ({
        id: page.id,
        title: getTitle(page, "Issue / Risk"),
        status: getSelectName(page, "Status"),
        severity: getSelectName(page, "Severity"),
        phase: getSelectName(page, "Phase"),
        url: page.url,
      })),
    rfis: rfis
      .filter((page) => !["Answered", "Closed"].includes(getSelectName(page, "Status")))
      .map((page) => ({
        id: page.id,
        question: getTitle(page, "Question"),
        status: getSelectName(page, "Status"),
        priority: getSelectName(page, "Priority"),
        phase: getSelectName(page, "Phase"),
        due_date: getDate(page, "Due Date"),
        url: page.url,
      })),
    documents: documents.map((page) => ({
      id: page.id,
      title: getTitle(page, "Document Name"),
      type: getSelectName(page, "Type"),
      status: getSelectName(page, "Status"),
      url: page.url,
    })),
    notes: notes.map((page) => ({
      id: page.id,
      title: getTitle(page, "Title"),
      type: getSelectName(page, "Type"),
      date: getDate(page, "Date"),
      url: page.url,
    })),
  };
}

function notionStageToDealStatus(stage: string): DealStatus {
  const value = stage.toLowerCase();
  if (value.includes("loi")) return "loi";
  if (value.includes("control") || value.includes("psa") || value.includes("contract")) return "under_contract";
  if (value.includes("diligence")) return "diligence";
  if (value.includes("closing")) return "closing";
  if (value.includes("closed")) return "closed";
  if (value.includes("dead") || value.includes("passed")) return "dead";
  if (value.includes("underwriting")) return "screening";
  return "sourcing";
}

function notionAssetToPropertyType(assetClass: string): PropertyType {
  const value = assetClass.toLowerCase();
  if (value.includes("industrial")) return "industrial";
  if (value.includes("multi") || value.includes("apartment")) return "multifamily";
  if (value.includes("office")) return "office";
  if (value.includes("retail")) return "retail";
  if (value.includes("student")) return "student_housing";
  if (value.includes("mixed")) return "mixed_use";
  if (value.includes("land")) return "land";
  if (value.includes("hotel") || value.includes("hospitality")) return "hospitality";
  return "other";
}

function mergeOnlyEmptyFields(
  deal: Record<string, unknown>,
  imported: Record<string, unknown>
): Record<string, unknown> {
  const updates: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(imported)) {
    if (value == null || value === "") continue;
    const existing = deal[key];
    const empty =
      existing == null ||
      existing === "" ||
      (typeof existing === "number" && Number.isNaN(existing));
    if (empty) updates[key] = value;
  }
  return updates;
}

function normalizeMatchText(value: unknown): string {
  return String(value ?? "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\b(llc|lp|inc|the|project|deal)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function likelyDealMatch(
  localDeal: Record<string, unknown>,
  importedDeal: Record<string, unknown>
): { confidence: "high" | "medium"; reason: string } | null {
  const localAddress = normalizeMatchText(localDeal.address);
  const importedAddress = normalizeMatchText(importedDeal.address);
  const localName = normalizeMatchText(localDeal.name);
  const importedName = normalizeMatchText(importedDeal.name);
  const localCity = normalizeMatchText(localDeal.city);
  const importedCity = normalizeMatchText(importedDeal.city);
  const localState = normalizeMatchText(localDeal.state);
  const importedState = normalizeMatchText(importedDeal.state);

  if (localAddress && importedAddress) {
    if (localAddress === importedAddress) {
      return { confidence: "high", reason: "exact address" };
    }
    if (
      localAddress.length > 8 &&
      importedAddress.length > 8 &&
      (localAddress.includes(importedAddress) || importedAddress.includes(localAddress))
    ) {
      return { confidence: "high", reason: "matching address" };
    }
  }

  if (localName && importedName && localName === importedName) {
    if (!importedCity || !localCity || importedCity === localCity) {
      if (!importedState || !localState || importedState === localState) {
        return { confidence: "high", reason: "matching name and market" };
      }
    }
    return { confidence: "medium", reason: "matching name" };
  }

  return null;
}

function extractPipelineProject(page: Record<string, unknown>) {
  const title = getTitle(page, "Project Name");
  const assetClass = getMultiSelect(page, "Asset Class")[0] ?? "";
  const stage = getSelectName(page, "Stage");
  const address = getPlainText(page, "Address");
  return {
    notion_page_id: String(page.id),
    notion_url: String(page.url ?? `https://notion.so/${String(page.id).replace(/-/g, "")}`),
    deal: {
      name: title || "Untitled Notion deal",
      address,
      city: getSelectName(page, "City") || "",
      state: getSelectName(page, "State") || "",
      zip: "",
      property_type: notionAssetToPropertyType(assetClass),
      status: notionStageToDealStatus(stage),
      starred: false,
      asking_price: getNumber(page, "Purchase Price"),
      square_footage: getNumber(page, "Building SF"),
      units: getNumber(page, "Units"),
      bedrooms: null,
      year_built: null,
      notes: getPlainText(page, "Notes") || null,
      land_acres: getNumber(page, "Site Acres"),
      investment_strategy: null,
      deal_scope: null,
      loi_executed: false,
      psa_executed: false,
    },
  };
}

export async function importPipelineProjectsFromNotion(opts: {
  userId: string;
  pageSize?: number;
}) {
  const notion = getClient();
  const response = await notion.dataSources.query({
    data_source_id: getNotionDataSourceId("pipeline"),
    page_size: Math.max(1, Math.min(100, opts.pageSize ?? 50)),
  } as never);

  const localDeals = (await dealQueries.getAll(opts.userId)) as Array<Record<string, unknown>>;
  const linkedLocalDealIds = new Set<string>();

  const summary = {
    scanned: 0,
    created: 0,
    linked: 0,
    updated: 0,
    skipped: 0,
    needs_review: 0,
    records: [] as Array<{
      notion_page_id: string;
      notion_url: string;
      deal_id: string | null;
      action: "created" | "linked" | "updated" | "skipped" | "needs_review";
      name: string;
      updated_fields?: string[];
      match_reason?: string;
    }>,
  };

  for (const page of response.results as Array<Record<string, unknown>>) {
    summary.scanned += 1;
    const imported = extractPipelineProject(page);
    const pageId = normalizeNotionId(imported.notion_page_id);
    const existingLink = await notionSyncQueries.getByNotionPage(pageId, "pipeline_project");

    if (existingLink?.local_id) {
      linkedLocalDealIds.add(existingLink.local_id);
      const existingDeal = await dealQueries.getById(existingLink.local_id);
      if (!existingDeal) {
        await notionSyncQueries.upsert({
          local_type: "deal",
          local_id: existingLink.local_id,
          notion_role: "pipeline_project",
          notion_data_source: "pipeline",
          notion_page_id: pageId,
          notion_url: imported.notion_url,
          metadata: { last_imported_at: new Date().toISOString(), import_policy: "link-only" },
        });
        summary.linked += 1;
        summary.records.push({
          notion_page_id: pageId,
          notion_url: imported.notion_url,
          deal_id: existingLink.local_id,
          action: "linked",
          name: imported.deal.name,
        });
        continue;
      }

      const updates = mergeOnlyEmptyFields(existingDeal, imported.deal);
      if (Object.keys(updates).length > 0) {
        await dealQueries.update(existingLink.local_id, updates);
        summary.updated += 1;
        summary.records.push({
          notion_page_id: pageId,
          notion_url: imported.notion_url,
          deal_id: existingLink.local_id,
          action: "updated",
          name: String(existingDeal.name ?? imported.deal.name),
          updated_fields: Object.keys(updates),
        });
      } else {
        summary.skipped += 1;
        summary.records.push({
          notion_page_id: pageId,
          notion_url: imported.notion_url,
          deal_id: existingLink.local_id,
          action: "skipped",
          name: String(existingDeal.name ?? imported.deal.name),
        });
      }
      continue;
    }

    const matched = localDeals
      .filter((deal) => !linkedLocalDealIds.has(String(deal.id ?? "")))
      .map((deal) => ({ deal, match: likelyDealMatch(deal, imported.deal) }))
      .filter((entry): entry is { deal: Record<string, unknown>; match: { confidence: "high" | "medium"; reason: string } } => Boolean(entry.match))
      .sort((a, b) => (a.match.confidence === b.match.confidence ? 0 : a.match.confidence === "high" ? -1 : 1))[0];

    if (matched?.match.confidence === "high" && matched.deal.id) {
      const matchedDealId = String(matched.deal.id);
      const updates = mergeOnlyEmptyFields(matched.deal, imported.deal);
      if (Object.keys(updates).length > 0) {
        await dealQueries.update(matchedDealId, updates);
      }
      await notionSyncQueries.upsert({
        local_type: "deal",
        local_id: matchedDealId,
        notion_role: "pipeline_project",
        notion_data_source: "pipeline",
        notion_page_id: pageId,
        notion_url: imported.notion_url,
        metadata: {
          linked_from_notion_import_at: new Date().toISOString(),
          import_policy: "auto-link-high-confidence-only",
          match_reason: matched.match.reason,
          updated_fields: Object.keys(updates),
        },
      });
      linkedLocalDealIds.add(matchedDealId);
      summary.linked += 1;
      summary.records.push({
        notion_page_id: pageId,
        notion_url: imported.notion_url,
        deal_id: matchedDealId,
        action: "linked",
        name: String(matched.deal.name ?? imported.deal.name),
        updated_fields: Object.keys(updates),
        match_reason: matched.match.reason,
      });
      continue;
    }

    if (matched?.match.confidence === "medium") {
      summary.needs_review += 1;
      summary.records.push({
        notion_page_id: pageId,
        notion_url: imported.notion_url,
        deal_id: String(matched.deal.id ?? "") || null,
        action: "needs_review",
        name: imported.deal.name,
        match_reason: matched.match.reason,
      });
      continue;
    }

    const dealId = randomUUID();
    await dealQueries.create({
      id: dealId,
      ...imported.deal,
      owner_id: opts.userId,
      auto_ingested: false,
      inbox_reviewed_at: new Date().toISOString(),
    });
    await notionSyncQueries.upsert({
      local_type: "deal",
      local_id: dealId,
      notion_role: "pipeline_project",
      notion_data_source: "pipeline",
      notion_page_id: pageId,
      notion_url: imported.notion_url,
      metadata: { created_from_notion_at: new Date().toISOString(), import_policy: "create-shell-only" },
    });
    summary.created += 1;
    summary.records.push({
      notion_page_id: pageId,
      notion_url: imported.notion_url,
      deal_id: dealId,
      action: "created",
      name: imported.deal.name,
    });
    localDeals.push({ id: dealId, ...imported.deal });
    linkedLocalDealIds.add(dealId);
  }

  return summary;
}

export type ReviewPacketItems = {
  tasks?: Array<Record<string, unknown>>;
  risks?: Array<Record<string, unknown>>;
  rfis?: Array<Record<string, unknown>>;
  documents?: Array<Record<string, unknown>>;
  notes?: Array<Record<string, unknown>>;
  schedule?: Array<Record<string, unknown>>;
};

async function createPage(
  key: NotionDataSourceKey,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  properties: Record<string, any>
): Promise<CreatedNotionPage> {
  const notion = getClient();
  const response = await notion.pages.create({
    parent: { type: "data_source_id", data_source_id: getNotionDataSourceId(key) },
    properties,
  } as never);
  return pageResult(response as { id: string; url?: string });
}

export async function createKeyDocument(
  projectId: string,
  input: Record<string, unknown>
): Promise<CreatedNotionPage> {
  return createPage(
    "projectDocuments",
    cleanObject({
      "Document Name": titleProp(input.title ?? input.name ?? "Key document"),
      Project: relationProp(projectId),
      Type: selectProp(input.type ?? "Other"),
      Status: selectProp(input.status ?? "In Review"),
      Link: urlProp(input.link ?? input.url),
      Date: dateProp(input.date),
      "Due Date": dateProp(input.due_date),
      "Required?": input.required == null ? undefined : boolProp(input.required),
      Phase: selectProp(input.phase),
      Notes: richTextProp(input.notes ?? input.summary),
    })
  );
}

export async function pushReviewPacketItems(
  projectId: string,
  approvedItems: ReviewPacketItems
) {
  const normalizedProjectId = normalizeNotionId(projectId);
  const created: Record<string, CreatedNotionPage[]> = {
    tasks: [],
    risks: [],
    rfis: [],
    documents: [],
    notes: [],
    schedule: [],
  };

  for (const item of approvedItems.tasks ?? []) {
    created.tasks.push(
      await createPage(
        "tasks",
        cleanObject({
          Task: titleProp(item.title ?? item.task ?? "Follow-up task"),
          Project: relationProp(normalizedProjectId),
          Status: selectProp(item.status ?? "Not Started"),
          Priority: selectProp(item.priority ?? "P2 - Medium"),
          Phase: selectProp(item.phase),
          Category: selectProp(item.category),
          Workstream: selectProp(item.workstream),
          "Due Date": dateProp(item.due_date ?? item.dueDate),
          Blocker: item.blocker == null ? undefined : boolProp(item.blocker),
          "Critical Path": item.critical_path == null ? undefined : boolProp(item.critical_path),
          Notes: richTextProp(item.notes ?? item.description),
        })
      )
    );
  }

  for (const item of approvedItems.risks ?? []) {
    created.risks.push(
      await createPage(
        "issuesRisks",
        cleanObject({
          "Issue / Risk": titleProp(item.title ?? item.risk ?? "Risk"),
          Project: relationProp(normalizedProjectId),
          Status: selectProp(item.status ?? "Open"),
          Severity: selectProp(item.severity ?? "Medium"),
          Phase: selectProp(item.phase),
          "Mitigation / Next Step": richTextProp(item.mitigation ?? item.next_step ?? item.notes),
          "Escalated?": item.escalated == null ? undefined : boolProp(item.escalated),
          "Target Resolution": dateProp(item.target_resolution ?? item.due_date),
        })
      )
    );
  }

  for (const item of approvedItems.rfis ?? []) {
    created.rfis.push(
      await createPage(
        "rfisQuestions",
        cleanObject({
          Question: titleProp(item.question ?? item.title ?? "Question"),
          Project: relationProp(normalizedProjectId),
          "Response / Decision": richTextProp(item.response ?? item.decision),
          Status: selectProp(item.status ?? "Open"),
          Priority: selectProp(item.priority ?? "P2 - Medium"),
          Phase: selectProp(item.phase),
          "Due Date": dateProp(item.due_date),
        })
      )
    );
  }

  for (const item of approvedItems.documents ?? []) {
    created.documents.push(await createKeyDocument(normalizedProjectId, item));
  }

  for (const item of approvedItems.notes ?? []) {
    created.notes.push(
      await createPage(
        "meetingsNotes",
        cleanObject({
          Title: titleProp(item.title ?? "Deal note"),
          Project: relationProp(normalizedProjectId),
          Type: selectProp(item.type ?? "Other"),
          Date: dateProp(item.date ?? new Date()),
          Summary: richTextProp(item.summary ?? item.content ?? item.notes),
        })
      )
    );
  }

  for (const item of approvedItems.schedule ?? []) {
    created.schedule.push(
      await createPage(
        "schedule",
        cleanObject({
          "Schedule Item": titleProp(item.title ?? item.name ?? "Schedule item"),
          Project: relationProp(normalizedProjectId),
          "Baseline Date": dateProp(item.baseline_date ?? item.start_date),
          "Forecast / Actual Date": dateProp(item.forecast_date ?? item.end_date ?? item.due_date),
          Milestone: item.milestone == null ? undefined : boolProp(item.milestone),
          "Critical Path?": item.critical_path == null ? undefined : boolProp(item.critical_path),
          Status: selectProp(item.status ?? "Not Started"),
          Phase: selectProp(item.phase),
          Notes: richTextProp(item.notes ?? item.description),
        })
      )
    );
  }

  return created;
}

export async function searchPlaybooks(query: string, filters: Record<string, unknown> = {}) {
  const notion = getClient();
  const response = await notion.dataSources.query({
    data_source_id: getNotionDataSourceId("researchPlaybooks"),
    page_size: 25,
  } as never);
  const q = query.trim().toLowerCase();
  return (response.results as Array<Record<string, unknown>>)
    .map((page) => ({
      id: page.id,
      title: getTitle(page, "Name"),
      type: getSelectName(page, "Type"),
      phase: getSelectName(page, "Phase"),
      url: page.url,
    }))
    .filter((page) => {
      const matchesQuery = !q || page.title.toLowerCase().includes(q);
      const phase = filters.phase ? page.phase === filters.phase : true;
      return matchesQuery && phase;
    });
}

export async function createOrLinkPipelineProjectForDeal(dealId: string) {
  const existing = await getLinkedNotionProject(dealId);
  if (existing?.notion_page_id) {
    return {
      pageId: existing.notion_page_id,
      url: existing.notion_url ?? `https://notion.so/${existing.notion_page_id.replace(/-/g, "")}`,
      linked: true,
      created: false,
    };
  }

  const deal = await dealQueries.getById(dealId);
  if (!deal) throw new Error("Deal not found");

  const result = await createPipelineProject({ deal });
  await linkDealToNotionProject(dealId, result.pageId, result.url);
  return { ...result, linked: true, created: true };
}

type NotionHandoffInput = {
  deal: Record<string, unknown>;
  documents: Array<Record<string, unknown>>;
  notes: Array<Record<string, unknown>>;
  tasks: Array<Record<string, unknown>>;
};

export async function exportDealHandoffToNotion({
  deal,
  documents,
  notes,
  tasks,
}: NotionHandoffInput): Promise<CreatedNotionPage> {
  const result = await createOrLinkPipelineProjectForDeal(String(deal.id));
  const projectId = result.pageId;

  const reviewNotes = notes.filter((note) => note.source === "document_review").slice(0, 6);
  const openTasks = tasks.filter((task) => task.status !== "complete" && task.deleted_at == null).slice(0, 20);
  const keyDocs = documents.filter((doc) => doc.is_key).slice(0, 10);

  if (reviewNotes.length > 0 || openTasks.length > 0 || keyDocs.length > 0) {
    await pushReviewPacketItems(projectId, {
      notes: reviewNotes.map((note) => ({
        title: `Document review: ${truncateText(note.document_name ?? note.id, 80)}`,
        type: "Other",
        summary: note.text,
      })),
      tasks: openTasks.map((task) => ({
        title: task.label ?? task.title,
        notes: task.notes,
        priority: task.priority,
        phase: task.track ?? task.phase,
        due_date: task.end_date ?? task.start_date,
      })),
      documents: keyDocs.map((doc) => ({
        title: doc.original_name ?? doc.name,
        type: "Other",
        status: "In Review",
        notes: doc.ai_summary,
      })),
    });
  }

  return { pageId: projectId, url: result.url };
}

// Legacy OM export kept for the existing OM button. Prefer the new Pipeline
// project flow for deal-management pushes.
export async function exportDealToNotion(
  deal: Record<string, unknown>,
  analysis: OmAnalysisRow
): Promise<CreatedNotionPage> {
  if (!process.env.NOTION_DEALS_DATABASE_ID) {
    const result = await createOrLinkPipelineProjectForDeal(String(deal.id));
    await createKeyDocument(result.pageId, {
      title: `${deal.name ?? "Deal"} OM analysis`,
      type: "OM / Marketing",
      status: "In Review",
      link: dealUrl(deal.id, "/om-analysis"),
      notes: analysis.summary,
    });
    return { pageId: result.pageId, url: result.url };
  }

  const notion = getClient();
  const response = await notion.pages.create({
    parent: { database_id: process.env.NOTION_DEALS_DATABASE_ID },
    properties: cleanObject({
      Name: titleProp(deal.name ?? "Untitled Deal"),
      Status: selectProp(stageForDeal(deal.status)),
      Summary: richTextProp(analysis.summary ?? "OM analysis from Deal Intelligence."),
      "Red Flags Count": { number: Array.isArray(analysis.red_flags) ? analysis.red_flags.length : 0 },
      "Analysis Date": dateProp(new Date()),
      "Deal URL": urlProp(dealUrl(deal.id, "/om-analysis")),
    }),
  } as never);
  return pageResult(response as { id: string; url?: string });
}

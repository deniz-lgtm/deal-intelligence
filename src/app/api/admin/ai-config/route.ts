import { NextRequest, NextResponse } from "next/server";
import { aiPromptQueries } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { getSetting, setSetting, recordAudit } from "@/lib/admin-helpers";
import { clearAiConfigCache } from "@/lib/claude";

const DEFAULT_MODEL = "claude-sonnet-4-5";

const AVAILABLE_MODELS = [
  "claude-opus-4-6",
  "claude-sonnet-4-6",
  "claude-sonnet-4-5",
  "claude-haiku-4-5-20251001",
];

export async function GET() {
  const { errorResponse } = await requireAdmin();
  if (errorResponse) return errorResponse;

  const model = await getSetting<string>("ai.model", DEFAULT_MODEL);
  const prompts = await aiPromptQueries.listAll();
  return NextResponse.json({
    data: { model, availableModels: AVAILABLE_MODELS, prompts },
  });
}

export async function PATCH(req: NextRequest) {
  const { userId: adminId, errorResponse } = await requireAdmin();
  if (errorResponse) return errorResponse;

  let body: { model?: string; prompts?: Array<{ key: string; prompt: string }>; resetPrompt?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  try {
    if (body.model !== undefined) {
      if (!AVAILABLE_MODELS.includes(body.model)) {
        return NextResponse.json({ error: "Unknown model" }, { status: 400 });
      }
      await setSetting("ai.model", body.model, adminId);
      await recordAudit({
        userId: adminId,
        action: "ai.model_change",
        metadata: { model: body.model },
      });
    }

    if (body.prompts) {
      for (const p of body.prompts) {
        await aiPromptQueries.setPrompt(p.key, p.prompt, adminId);
      }
      await recordAudit({
        userId: adminId,
        action: "ai.prompts_updated",
        metadata: { keys: body.prompts.map((p) => p.key) },
      });
    }

    if (body.resetPrompt) {
      await aiPromptQueries.resetToDefault(body.resetPrompt, adminId);
      await recordAudit({
        userId: adminId,
        action: "ai.prompt_reset",
        metadata: { key: body.resetPrompt },
      });
    }

    clearAiConfigCache();
    const model = await getSetting<string>("ai.model", DEFAULT_MODEL);
    const prompts = await aiPromptQueries.listAll();
    return NextResponse.json({ data: { model, availableModels: AVAILABLE_MODELS, prompts } });
  } catch (error) {
    console.error("PATCH /api/admin/ai-config error:", error);
    return NextResponse.json({ error: "Update failed" }, { status: 500 });
  }
}

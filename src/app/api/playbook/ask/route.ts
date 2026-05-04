import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { playbookQueries } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { getActiveModel } from "@/lib/claude";
import { formatPlaybookContext, publicPlaybookSource } from "@/lib/playbook";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const { errorResponse } = await requirePermission("ai.chat");
  if (errorResponse) return errorResponse;

  try {
    const body = (await req.json()) as { question?: string };
    const question = body.question?.trim();

    if (!question) {
      return NextResponse.json({ error: "question is required" }, { status: 400 });
    }

    const hits = await playbookQueries.search(question, 8);
    if (hits.length === 0) {
      return NextResponse.json({
        data: {
          answer:
            "I couldn't find a matching excerpt in the Development Playbook yet. Add the relevant handbook section, lesson learned, or design standard and I can cite it back.",
          sources: [],
        },
      });
    }

    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const response = await client.messages.create({
      model: await getActiveModel(),
      max_tokens: 1200,
      system: `You answer as a senior multifamily development, underwriting, and construction advisor.

Use only the Development Playbook excerpts provided by the user. Cite source numbers like [1] or [2] when giving guidance. If the excerpts do not contain enough support for a claim, say what is missing instead of guessing.

Prefer crisp, practical guidance: what to check, what decision it supports, and what risk it reduces.`,
      messages: [
        {
          role: "user",
          content: `Question:
${question}

Development Playbook excerpts:
${formatPlaybookContext(hits)}`,
        },
      ],
    });

    const answer = response.content
      .filter((block) => block.type === "text")
      .map((block) => (block as Anthropic.TextBlock).text)
      .join("\n")
      .trim();

    return NextResponse.json({
      data: {
        answer: answer || "I found relevant playbook excerpts, but could not produce an answer.",
        sources: hits.map(publicPlaybookSource),
      },
    });
  } catch (error) {
    console.error("POST /api/playbook/ask error:", error);
    return NextResponse.json({ error: "Playbook question failed" }, { status: 500 });
  }
}

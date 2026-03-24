import { NextRequest, NextResponse } from "next/server";
import { dealQueries, omAnalysisQueries, omQaQueries } from "@/lib/db";
import { answerOmQuestion } from "@/lib/om-extraction";
import { documentQueries } from "@/lib/db";

/**
 * POST /api/deals/:id/om-qa
 * Ask a question about the OM analysis.
 * Body: { question: string, analysis_id?: string }
 *
 * GET /api/deals/:id/om-qa
 * Get Q&A history for the deal.
 */

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const body = await req.json();
    const { question, analysis_id } = body as {
      question: string;
      analysis_id?: string;
    };

    if (!question?.trim()) {
      return NextResponse.json({ error: "question is required" }, { status: 400 });
    }

    const deal = await dealQueries.getById(params.id);
    if (!deal) {
      return NextResponse.json({ error: "Deal not found" }, { status: 404 });
    }

    // Get the analysis to answer from
    const analysis = analysis_id
      ? await omAnalysisQueries.getById(analysis_id)
      : await omAnalysisQueries.getByDealId(params.id);

    if (!analysis || analysis.status !== "complete") {
      return NextResponse.json(
        { error: "No completed OM analysis found. Please upload and analyze an OM first." },
        { status: 400 }
      );
    }

    // Get the OM document text for context
    let pdfText = "";
    if (analysis.document_id) {
      const doc = await documentQueries.getById(analysis.document_id);
      pdfText = doc?.content_text ?? "";
    }

    // Get recent Q&A history for context
    const history = await omQaQueries.getByAnalysisId(analysis.id);
    const historyPairs = history.map((h) => ({
      question: h.question,
      answer: h.answer,
    }));

    // Build full result shape for the QA function
    const fullResult = {
      property_details: {
        name: analysis.property_name,
        address: analysis.address,
        property_type: analysis.property_type,
        year_built: analysis.year_built,
        sf: analysis.sf,
        unit_count: analysis.unit_count,
      },
      financial_metrics: {
        asking_price: analysis.asking_price,
        noi: analysis.noi,
        cap_rate: analysis.cap_rate,
        grm: analysis.grm,
        cash_on_cash: analysis.cash_on_cash,
        irr: analysis.irr,
        equity_multiple: analysis.equity_multiple,
        dscr: analysis.dscr,
        vacancy_rate: analysis.vacancy_rate,
        expense_ratio: analysis.expense_ratio,
        price_per_sf: analysis.price_per_sf,
        price_per_unit: analysis.price_per_unit,
      },
      assumptions: {
        rent_growth: analysis.rent_growth,
        hold_period: analysis.hold_period,
        leverage: analysis.leverage,
        exit_cap_rate: analysis.exit_cap_rate,
      },
      red_flags: (analysis.red_flags as Array<{
        severity: "critical" | "high" | "medium" | "low";
        category: string;
        description: string;
        recommendation: string;
      }>) ?? [],
      deal_score: analysis.deal_score ?? 0,
      score_reasoning: analysis.score_reasoning ?? "",
      summary: analysis.summary ?? "",
      recommendations: (analysis.recommendations as string[]) ?? [],
      model_used: analysis.model_used ?? "claude-sonnet-4-5",
      tokens_used: analysis.tokens_used ?? 0,
      cost_estimate: analysis.cost_estimate ?? 0,
      processing_ms: analysis.processing_ms ?? 0,
    };

    const { answer, tokensUsed } = await answerOmQuestion(
      question,
      pdfText,
      fullResult,
      historyPairs
    );

    const costEstimate = (tokensUsed / 1_000_000) * 9;

    const saved = await omQaQueries.create({
      analysis_id: analysis.id,
      deal_id: params.id,
      question,
      answer,
      model_used: "claude-sonnet-4-5",
      tokens_used: tokensUsed,
      cost_estimate: costEstimate,
    });

    return NextResponse.json({ data: { qa: saved } });
  } catch (error) {
    console.error("POST /api/deals/[id]/om-qa error:", error);
    return NextResponse.json({ error: "Q&A failed" }, { status: 500 });
  }
}

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const history = await omQaQueries.getByDealId(params.id);
    return NextResponse.json({ data: { history } });
  } catch (error) {
    console.error("GET /api/deals/[id]/om-qa error:", error);
    return NextResponse.json({ error: "Failed to fetch Q&A history" }, { status: 500 });
  }
}

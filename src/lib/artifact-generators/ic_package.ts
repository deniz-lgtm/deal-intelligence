/**
 * IC Package generator.
 *
 * Takes the wizard's saved IC Package prose + context, renders the
 * editorial HTML shell via the shared IC component library (server-side
 * react-dom render), runs htmlToPdf, uploads the PDF, and persists:
 *
 *   1. The prose into `ic_packages` (new version, atomically flipping
 *      is_latest). This remains the editable source of truth.
 *   2. The PDF metadata into `documents` (is_generated=true) — done by
 *      artifactQueries.saveLatest in the API dispatcher after this
 *      generator returns.
 *
 * The link is preserved via `sourceArtifactId = ic_packages.id` so the
 * library viewer can surface "Edit source" → the wizard.
 */

import { v4 as uuidv4 } from "uuid";
import { readFile } from "fs/promises";
import path from "path";
import { htmlToPdf, PuppeteerMissingError } from "@/lib/html-to-pdf";
import { uploadBlob } from "@/lib/blob-storage";
import { icPackageQueries } from "@/lib/db";
import { buildIcPackage } from "@/lib/ic-package-mapper";
import { computeArtifactHash } from "@/lib/artifact-hash";
import { renderIcPackageBody } from "@/components/ic-package/renderToHtml";
import type {
  DealContext,
  ProseSections,
} from "@/components/ic-package/types";
import type { ArtifactGenerator } from "./types";

interface IcPackagePayload {
  prose?: ProseSections;
  context?: DealContext;
  deal?: { id: string; updated_at: string | Date | null; name?: string } | null;
  underwriting?: { id: string; updated_at: string | Date | null } | null;
}

async function loadIcTokensCss(): Promise<string> {
  // The tokens live alongside the components. Inline them so the PDF
  // renders standalone (puppeteer can't resolve Next.js CSS modules).
  try {
    const filePath = path.resolve(
      process.cwd(),
      "src/components/ic-package/styles/ic-tokens.css"
    );
    return await readFile(filePath, "utf-8");
  } catch {
    return "";
  }
}

function wrapInHtmlDocument(body: string, css: string, title: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${title.replace(/[<>&"]/g, "")}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600;9..144,800&family=JetBrains+Mono:wght@400;500;700&display=swap" rel="stylesheet">
<style>${css}</style>
</head>
<body>${body}</body>
</html>`;
}

const icPackageGenerator: ArtifactGenerator = async (opts) => {
  const payload = (opts.payload ?? {}) as IcPackagePayload;
  if (!payload.prose || !payload.context) {
    throw new Error(
      "ic_package generator requires { prose, context } in payload"
    );
  }

  // 1. Persist the prose as a new version of the editable source. This
  //    lets the wizard navigate back to the exact prose that produced
  //    this PDF even if the user keeps editing.
  const icRow = await icPackageQueries.saveLatest(
    opts.dealId,
    payload.prose,
    payload.context,
    opts.userId
  );

  // 2. Render the IC Package to HTML via the server-safe string
  //    composer (mirrors the React renderer).
  const pkg = buildIcPackage(payload.context, payload.prose);
  const bodyMarkup = renderIcPackageBody(pkg);
  const css = await loadIcTokensCss();
  const html = wrapInHtmlDocument(bodyMarkup, css, pkg.masthead.dealName);

  // 3. Puppeteer → PDF.
  let pdf: Buffer;
  try {
    pdf = await htmlToPdf(html, { format: "Letter", margin: "0.5in", waitUntil: "networkidle0" });
  } catch (err) {
    if (err instanceof PuppeteerMissingError) throw err;
    throw err;
  }

  const safeName = payload.context.dealName
    .replace(/[^a-zA-Z0-9]/g, "-")
    .slice(0, 60);
  const filename = `IC-Package-${safeName}-v${icRow.version}.pdf`;
  const dateStamp = new Date().toISOString().slice(0, 10);
  const blobPath = `deals/${opts.dealId}/reports/${dateStamp}-${uuidv4()}-${filename}`;
  const fileUrl = await uploadBlob(blobPath, pdf, "application/pdf");

  // Hash inputs so the library can show staleness if the deal / UW
  // evolves without the user regenerating.
  const { snapshot, hash } = computeArtifactHash({
    deal: payload.deal ?? null,
    underwriting: payload.underwriting ?? null,
    extras: {
      icPackageVersion: icRow.version,
      proseHash: hashOf(payload.prose),
    },
  });

  return {
    title: `IC Package — ${payload.context.dealName}`,
    filename,
    filePath: fileUrl,
    fileSize: pdf.length,
    mimeType: "application/pdf",
    summary: `IC Package · v${icRow.version} · ${new Date().toLocaleDateString()}`,
    tags: [
      "ic-package",
      "ai-generated",
      "pdf",
      `ic_package_version:${icRow.version}`,
      ...(opts.massingId ? [`massing:${opts.massingId}`] : []),
    ],
    inputSnapshot: snapshot,
    inputHash: hash,
    sourceArtifactId: icRow.id,
    contentText: null,
  };
};

function hashOf(value: unknown): string {
  // Lightweight fingerprint (not cryptographic — just for the snapshot
  // extras). The cryptographic hash is done by computeArtifactHash over
  // the snapshot object as a whole.
  return JSON.stringify(value).length.toString(36);
}

export default icPackageGenerator;

/**
 * Shared HTML → PDF helper. Puppeteer is dynamically imported so the
 * dependency stays optional; when it isn't available the helper throws
 * a structured error the caller can catch to fall back to window.print()
 * or a different renderer.
 *
 * Use cases:
 *   - IC Package (via /api/deals/[id]/ic-package/pdf)
 *   - DD Abstract export (HTML shell → PDF)
 *   - Investment Package export (HTML → PDF, replaces PPTX + DOCX)
 *   - Zoning Report export (HTML → PDF, replaces DOCX)
 *
 * Keeping the invocation in one place means the Chromium flags, page
 * format, and margin defaults are consistent across every generator.
 */

export class PuppeteerMissingError extends Error {
  readonly code = "puppeteer_not_installed";
  constructor() {
    super("Server-side PDF export requires puppeteer. Install it or fall back to window.print().");
  }
}

export interface HtmlToPdfOptions {
  /** Paper size. Defaults to Letter. */
  format?: "Letter" | "A4" | "Legal" | "Tabloid";
  /** CSS margins (e.g. "0.5in"). Applied to all four sides. */
  margin?: string;
  /**
   * puppeteer networkidle signal — "networkidle0" waits for no network
   * activity for 500ms (safer for dynamic content), "load" fires earlier.
   * Our HTML is typically self-contained (inlined CSS, no external
   * images), so "load" is usually enough and faster.
   */
  waitUntil?: "load" | "domcontentloaded" | "networkidle0" | "networkidle2";
}

export async function htmlToPdf(
  html: string,
  opts: HtmlToPdfOptions = {}
): Promise<Buffer> {
  const format = opts.format ?? "Letter";
  const margin = opts.margin ?? "0.5in";
  const waitUntil = opts.waitUntil ?? "load";

  // Dynamic import so the build doesn't fail if puppeteer isn't in
  // node_modules (it's heavy — ~100MB with Chromium). The `Function`
  // trick bypasses webpack's static dependency analysis.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let puppeteerLib: any;
  try {
    const moduleName = "puppeteer";
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mod = await (Function("m", "return import(m)") as (m: string) => Promise<any>)(moduleName);
    puppeteerLib = mod.default ?? mod;
  } catch {
    throw new PuppeteerMissingError();
  }

  const browser = await puppeteerLib.launch({
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil });
    const pdf = await page.pdf({
      format,
      printBackground: true,
      margin: { top: margin, bottom: margin, left: margin, right: margin },
    });
    return Buffer.from(pdf);
  } finally {
    await browser.close();
  }
}

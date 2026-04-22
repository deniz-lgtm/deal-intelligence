/**
 * Shared HTML → PDF helper. Uses puppeteer-core + system Chromium
 * (Alpine package) in production; the executable path is supplied via
 * PUPPETEER_EXECUTABLE_PATH (see Dockerfile). In local dev where
 * puppeteer-core isn't installed we throw a structured error so the
 * caller can fall back to window.print().
 *
 * Use cases:
 *   - IC Package (via the ic_package generator)
 *   - DD Abstract, Investment Package, Zoning Report, LOI generators
 *
 * Keeping the invocation in one place means the Chromium flags, page
 * format, and margin defaults are consistent across every generator.
 */

export class PuppeteerMissingError extends Error {
  readonly code = "puppeteer_not_installed";
  constructor(message?: string) {
    super(
      message ??
        "Server-side PDF export requires puppeteer-core + system Chromium. Install puppeteer-core and ensure PUPPETEER_EXECUTABLE_PATH points at a chromium binary."
    );
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

  // Dynamic import so local-dev builds don't fail when puppeteer-core
  // isn't installed. The `Function` trick bypasses webpack's static
  // dependency analysis so Next.js doesn't try to bundle it.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let puppeteerLib: any;
  try {
    const moduleName = "puppeteer-core";
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mod = await (Function("m", "return import(m)") as (m: string) => Promise<any>)(moduleName);
    puppeteerLib = mod.default ?? mod;
  } catch {
    throw new PuppeteerMissingError();
  }

  // puppeteer-core has no bundled Chrome; the caller (Dockerfile) must
  // install one and point PUPPETEER_EXECUTABLE_PATH at it. Common
  // values: /usr/bin/chromium-browser (Alpine), /usr/bin/google-chrome
  // (Debian).
  const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
  if (!executablePath) {
    throw new PuppeteerMissingError(
      "PUPPETEER_EXECUTABLE_PATH is not set. Install Chromium and point this env var at the binary."
    );
  }

  const browser = await puppeteerLib.launch({
    executablePath,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
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

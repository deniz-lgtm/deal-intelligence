import { notImplementedGenerator } from "./_stub";

// Phase 3 wires this up: pulls the deal + UW + saved prose, calls the
// existing ic-package-prose + mapper + renderer pipeline, runs htmlToPdf,
// uploads via uploadBlob, and returns the GenerateResult. For now it
// throws so callers fall back to the legacy /api/deals/[id]/ic-package/*
// routes.
export default notImplementedGenerator("ic_package");

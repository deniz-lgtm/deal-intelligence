"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ArtifactKind } from "@/lib/artifact-hash";

interface Props {
  dealId: string;
  kind: ArtifactKind;
  /** Free-form payload handed to the generator. Each kind's generator
   *  knows how to unpack its own shape — see src/lib/artifact-generators/<kind>.ts. */
  getPayload?: () => Record<string, unknown>;
  /** Optional massing scope (preserves ?massing=<id> from the URL). */
  massingId?: string | null;
  /** Label override; defaults to "Generate → Library". */
  label?: string;
  /** Visual variant. Defaults to the primary button; authoring pages
   *  that already have a primary action can pick "outline". */
  variant?: "default" | "outline" | "secondary";
  /** When true, disables the button (e.g. while the authoring page has
   *  unsaved changes). */
  disabled?: boolean;
  /** Size passed through to Button. */
  size?: "default" | "sm" | "lg";
  className?: string;
}

/**
 * Single entry point that replaces every per-page "Export to PPT/Word/PDF"
 * button. Calls POST /api/deals/[id]/artifacts, then either:
 *  - redirects to the library scrolled to the new artifact on success, or
 *  - shows an informative toast if the generator isn't wired yet (phase-
 *    aware rollout — each kind lights up in a later phase).
 *
 * Authoring pages keep doing their own authoring; this button is the
 * only way to produce a shareable artifact.
 */
export default function GenerateToLibraryButton({
  dealId,
  kind,
  getPayload,
  massingId,
  label = "Generate → Library",
  variant = "default",
  disabled = false,
  size = "default",
  className,
}: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function run() {
    setLoading(true);
    try {
      const payload = getPayload?.() ?? {};
      const res = await fetch(`/api/deals/${dealId}/artifacts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, payload, massingId }),
      });

      if (res.status === 501) {
        const body = await res.json().catch(() => ({}));
        toast.info(
          body.message ??
            `${kind} generator isn't wired yet — ships in a later phase.`
        );
        return;
      }

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message || body.error || `Generate failed (${res.status})`);
      }

      const { artifact } = (await res.json()) as { artifact: { id: string } };
      toast.success("Generated — opening in library");
      router.push(`/deals/${dealId}/reports/${artifact.id}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Generate failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Button
      onClick={run}
      disabled={disabled || loading}
      variant={variant}
      size={size}
      className={className}
    >
      <Sparkles className="h-4 w-4 mr-2" />
      {loading ? "Generating…" : label}
    </Button>
  );
}

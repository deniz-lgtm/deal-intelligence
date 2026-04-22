import "./styles/ic-tokens.css";
import IcPackageClient from "./IcPackageClient";
import { dealToContext } from "@/lib/ic-package-deal-adapter";
import { dealQueries, underwritingQueries, icPackageQueries } from "@/lib/db";
import type { ProseSections } from "./types";

interface PageProps {
  params: { id: string };
}

/**
 * IC Package route. Server component — loads the deal record, the latest
 * underwriting snapshot, and any previously saved IC package for the
 * deal, then hands structured context + saved prose to the interactive
 * client view.
 *
 * If the deal is missing, we pass `dealContext = null` and the client
 * falls back to the Crestmont demo fixture so the design system is still
 * viewable.
 */
export default async function IcPackagePage({ params }: PageProps) {
  const [deal, uwRow, savedRow] = await Promise.all([
    dealQueries.getById(params.id).catch(() => null),
    underwritingQueries.getByDealId(params.id).catch(() => null),
    icPackageQueries.getLatest(params.id).catch(() => null),
  ]);

  const dealContext = deal ? dealToContext(deal, uwRow) : null;
  const savedProse = (savedRow?.prose as ProseSections | null) ?? null;
  const savedVersion = savedRow?.version ?? null;

  return (
    <IcPackageClient
      dealId={params.id}
      dealContext={dealContext}
      savedProse={savedProse}
      savedVersion={savedVersion}
    />
  );
}

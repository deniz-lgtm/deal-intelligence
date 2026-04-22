import "./styles/ic-tokens.css";
import IcPackageClient from "./IcPackageClient";
import { dealToContext } from "@/lib/ic-package-deal-adapter";
import { dealQueries, underwritingQueries } from "@/lib/db";

interface PageProps {
  params: { id: string };
}

/**
 * IC Package route. Server component — loads the deal record (and any
 * underwriting snapshot) and hands structured context to the interactive
 * client view.
 *
 * If the deal is missing enough data to render a real package, we pass
 * `dealContext = null` and the client falls back to the Crestmont demo
 * fixture so the design system is still viewable.
 */
export default async function IcPackagePage({ params }: PageProps) {
  const deal = await dealQueries.getById(params.id).catch(() => null);
  const uwRow = await underwritingQueries.getByDealId(params.id).catch(() => null);

  const dealContext = deal ? dealToContext(deal, uwRow) : null;

  return (
    <IcPackageClient
      dealId={params.id}
      dealContext={dealContext}
      savedProse={null}
    />
  );
}

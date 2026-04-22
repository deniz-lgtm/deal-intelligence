import DealMasthead from "./DealMasthead";
import ExecBox from "./ExecBox";
import MetricsStrip from "./MetricsStrip";
import SectionHead from "./SectionHead";
import ThesisGrid from "./ThesisGrid";
import ScenarioStrip from "./ScenarioStrip";
import CapitalStackTable from "./CapitalStackTable";
import BusinessPlan from "./BusinessPlan";
import RiskBlock from "./RiskBlock";
import Callout from "./Callout";
import PunchBox from "./PunchBox";
import Footer from "./Footer";
import type { IcPackage } from "../types";

interface Props {
  pkg: IcPackage;
}

/**
 * Pure, data-driven renderer for a full IC package. Accepts a fully-
 * resolved IcPackage and emits the final HTML structure. Used both in the
 * app route (interactive) and in the server-side PDF export flow.
 */
export default function IcPackageRenderer({ pkg }: Props) {
  const { masthead, exec, metrics, sections, footer } = pkg;

  return (
    <div className="ic-package">
      <div className="ic-page">
        <DealMasthead {...masthead} />

        <ExecBox {...exec} />

        <MetricsStrip metrics={metrics} />

        <section>
          <SectionHead {...sections.marketThesis.head} />
          <div dangerouslySetInnerHTML={{ __html: sections.marketThesis.proseHtml }} />
          <ThesisGrid cards={sections.marketThesis.thesisCards} />
          {sections.marketThesis.callouts.map((c, i) => (
            <Callout key={i} {...c} />
          ))}
        </section>

        <section>
          <SectionHead {...sections.capitalStack.head} />
          <CapitalStackTable sources={sections.capitalStack.sources} />
          <div dangerouslySetInnerHTML={{ __html: sections.capitalStack.proseHtml }} />
        </section>

        <section>
          <SectionHead {...sections.scenarios.head} />
          <div dangerouslySetInnerHTML={{ __html: sections.scenarios.introHtml }} />
          <ScenarioStrip scenarios={sections.scenarios.scenarios} />
          {sections.scenarios.callouts.map((c, i) => (
            <Callout key={i} {...c} />
          ))}
        </section>

        <section>
          <SectionHead {...sections.businessPlan.head} />
          <BusinessPlan phases={sections.businessPlan.phases} />
        </section>

        <section>
          <SectionHead {...sections.risks.head} />
          <RiskBlock
            headlineHtml={sections.risks.blockHeadlineHtml}
            subtitle={sections.risks.blockSubtitle}
            risks={sections.risks.risks}
          />
        </section>

        <section>
          <SectionHead {...sections.ask.head} />
          <PunchBox paragraphsHtml={sections.ask.paragraphsHtml} />
        </section>

        <Footer {...footer} />
      </div>
    </div>
  );
}

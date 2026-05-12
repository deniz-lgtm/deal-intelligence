"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import {
  FileSearch,
  ScrollText,
  Presentation,
  FolderArchive,
  Share2,
  ArrowRight,
} from "lucide-react";

interface HubCard {
  href: string;
  label: string;
  description: string;
  icon: typeof FileSearch;
  accent: string;
}

const CARDS: HubCard[] = [
  {
    href: "/om-analysis",
    label: "Offering Memo",
    description: "AI-extracted OM analysis — financials, narrative, comparables.",
    icon: FileSearch,
    accent: "from-blue-500/10 to-blue-500/5 border-blue-500/30 text-blue-300",
  },
  {
    href: "/dd-abstract",
    label: "Diligence Summary",
    description: "Generated diligence abstract pulling from documents and notes.",
    icon: ScrollText,
    accent: "from-amber-500/10 to-amber-500/5 border-amber-500/30 text-amber-300",
  },
  {
    href: "/investment-package",
    label: "IC Package",
    description: "Investment committee presentation with narrative + numbers.",
    icon: Presentation,
    accent: "from-violet-500/10 to-violet-500/5 border-violet-500/30 text-violet-300",
  },
  {
    href: "/reports",
    label: "Output Library",
    description: "Every artifact generated for this deal — PDFs, decks, exports.",
    icon: FolderArchive,
    accent: "from-emerald-500/10 to-emerald-500/5 border-emerald-500/30 text-emerald-300",
  },
  {
    href: "/room",
    label: "Share Room",
    description: "External-facing share link for sponsors, lenders, partners.",
    icon: Share2,
    accent: "from-rose-500/10 to-rose-500/5 border-rose-500/30 text-rose-300",
  },
];

export default function OutputsHubPage() {
  const params = useParams<{ id: string }>();
  return (
    <div className="flex flex-col gap-6 px-6 py-6">
      <header>
        <h1 className="font-nameplate text-2xl tracking-tight">Outputs</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Everything you can produce from this deal — analyses, packages, share rooms.
        </p>
      </header>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {CARDS.map((card) => {
          const Icon = card.icon;
          return (
            <Link
              key={card.href}
              href={`/deals/${params.id}${card.href}`}
              className={`group flex flex-col gap-3 rounded-xl border bg-gradient-to-br p-5 transition-all hover:scale-[1.01] hover:shadow-lifted ${card.accent}`}
            >
              <div className="flex items-center gap-2">
                <Icon className="h-5 w-5" />
                <span className="font-nameplate text-lg leading-none tracking-tight text-foreground">
                  {card.label}
                </span>
              </div>
              <p className="text-xs text-muted-foreground">{card.description}</p>
              <div className="mt-auto flex items-center gap-1 text-2xs uppercase tracking-[0.15em] text-foreground/60">
                Open
                <ArrowRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5" />
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import {
  Layers,
  MapPin,
  Globe,
  Compass,
  ArrowRight,
  Image as ImageIcon,
} from "lucide-react";

interface HubCard {
  href: string;
  label: string;
  description: string;
  icon: typeof Layers;
  accent: string;
}

const CARDS: HubCard[] = [
  {
    href: "/programming",
    label: "Site Plan",
    description: "Massing studies, programming, unit mix, and yield analysis.",
    icon: Layers,
    accent: "from-indigo-500/10 to-indigo-500/5 border-indigo-500/30 text-indigo-300",
  },
  {
    href: "/site-zoning",
    label: "Zoning",
    description: "Allowable use, FAR/height/setback constraints, entitlement notes.",
    icon: MapPin,
    accent: "from-amber-500/10 to-amber-500/5 border-amber-500/30 text-amber-300",
  },
  {
    href: "/location",
    label: "Location",
    description: "Market intelligence, demographics, transit, and area context.",
    icon: Globe,
    accent: "from-emerald-500/10 to-emerald-500/5 border-emerald-500/30 text-emerald-300",
  },
  {
    href: "/site-walk",
    label: "Site Walk",
    description: "Walk notes, photos, observations from the field.",
    icon: Compass,
    accent: "from-rose-500/10 to-rose-500/5 border-rose-500/30 text-rose-300",
  },
  {
    href: "/photos",
    label: "Photos",
    description: "Site photography library.",
    icon: ImageIcon,
    accent: "from-violet-500/10 to-violet-500/5 border-violet-500/30 text-violet-300",
  },
];

export default function SiteHubPage() {
  const params = useParams<{ id: string }>();
  return (
    <div className="flex flex-col gap-6 px-6 py-6">
      <header>
        <h1 className="font-nameplate text-2xl tracking-tight">Site</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Everything physical about the property — design, zoning, market context, and field
          observations.
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

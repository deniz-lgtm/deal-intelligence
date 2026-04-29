"use client";

import { useState, useEffect } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { UpcomingMilestonesCard } from "./UpcomingMilestonesCard";
import { PipelineCard } from "./PipelineCard";
import { MarketWidgetsCard } from "./MarketWidgetsCard";

// The "Today strip" sits above the triptych on the root landing page.
// Three editorial sections side-by-side give the user a command-center
// morning view:
//
//   [ Upcoming ]  [ Pipeline ]  [ Market ]
//
// Pipeline lives between the other two so every team member — Acq, Dev,
// Construction — sees the portfolio's $/SF/Units snapshot the moment
// they land on the home page, not just the acquisitions lead.
//
// Active Deals was removed — the triptych below already enumerates
// every deal the user has access to, so the upper card was redundant
// noise.
//
// Collapsible — some users want the triptych as the first thing they
// see. State persists in localStorage so the preference sticks.

export function TodayStrip() {
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem("todayStripCollapsed");
    if (stored !== null) setCollapsed(stored === "1");
  }, []);

  const toggle = () => {
    setCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem("todayStripCollapsed", next ? "1" : "0");
      return next;
    });
  };

  return (
    <div className="shrink-0 border-b border-border/30 relative">
      {/* Collapse toggle floats top-right so the editorial sections own
          the visual real estate (no redundant "Today" header — the
          nameplates inside each section carry the meaning). */}
      <button
        onClick={toggle}
        aria-label={collapsed ? "Show Today" : "Hide Today"}
        className="absolute top-2 right-6 sm:right-8 h-6 w-6 inline-flex items-center justify-center rounded-full text-muted-foreground/60 hover:text-foreground hover:bg-card/30 transition-colors z-10"
      >
        {collapsed ? (
          <ChevronDown className="h-3.5 w-3.5" />
        ) : (
          <ChevronUp className="h-3.5 w-3.5" />
        )}
      </button>

      {!collapsed && (
        <div className="grid grid-cols-1 xl:grid-cols-3 xl:divide-x divide-border/30 animate-fade-up">
          <UpcomingMilestonesCard />
          <PipelineCard />
          <MarketWidgetsCard />
        </div>
      )}
    </div>
  );
}

"use client";

import { useState, useEffect } from "react";
import { ChevronDown, ChevronUp, Sparkles } from "lucide-react";
import { UpcomingMilestonesCard } from "./UpcomingMilestonesCard";
import { DealBriefsCard } from "./DealBriefsCard";
import { MarketWidgetsCard } from "./MarketWidgetsCard";

// The "Today strip" sits above the kanban on the root landing page. Three
// cards in a row (stack on narrow screens) give the user a command-center
// morning view:
//
//   [ Upcoming ]  [ Deal Briefs ]  [ Market ]
//
// Collapsible — some users want the kanban as the first thing they see.
// State persists in localStorage so the preference sticks.

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
    <div className="shrink-0 border-b border-border/30 bg-card/20 backdrop-blur-sm">
      <div className="max-w-full mx-auto px-6 sm:px-8 py-3">
        {/* Strip header — always visible */}
        <button
          onClick={toggle}
          className="w-full flex items-center justify-between gap-3 text-left hover:opacity-90 mb-2"
        >
          <div className="flex items-center gap-2">
            <Sparkles className="h-3.5 w-3.5 text-primary" />
            <span className="text-xs font-semibold tracking-wide text-foreground">
              Today
            </span>
            <span className="text-[10px] text-muted-foreground">
              {todayLabel()}
            </span>
          </div>
          <span className="text-muted-foreground/60">
            {collapsed ? (
              <ChevronDown className="h-3.5 w-3.5" />
            ) : (
              <ChevronUp className="h-3.5 w-3.5" />
            )}
          </span>
        </button>

        {!collapsed && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 animate-fade-up">
            <UpcomingMilestonesCard />
            <DealBriefsCard />
            <MarketWidgetsCard />
          </div>
        )}
      </div>
    </div>
  );
}

function todayLabel(): string {
  return new Date().toLocaleDateString("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
  });
}

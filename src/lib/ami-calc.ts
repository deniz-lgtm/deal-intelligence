// ── HUD Area Median Income (AMI) standard calculations ──────────────────────
//
// Reference: HUD Income Limits methodology (24 CFR 5.609) + LIHTC rent rules.
//
// Base definitions:
//   4-person 50% AMI = 0.50 × Median Family Income (MFI)
//   4-person 30% AMI = 0.30 × MFI   (Extremely Low)
//   4-person 80% AMI = 0.80 × MFI   (Low Income)
//   60% AMI          = 1.20 × 50% AMI  (LIHTC tier)
//   100% AMI         = 2.00 × 50% AMI  (= MFI)
//   120% AMI         = 1.20 × 100% AMI
//
// Family-size adjustment factors (relative to 4-person):
//   1p=70%, 2p=80%, 3p=90%, 4p=100%, 5p=108%, 6p=116%, 7p=124%, 8p=132%
//
// Max rent by unit size (LIHTC standard: 1.5 persons per bedroom):
//   studio=1 person, 1BR=1.5, 2BR=3, 3BR=4.5, 4BR=6
//   Max rent = 30% of monthly income limit for that household size.
// Note: this is the GROSS rent cap. If tenants pay their own utilities,
// the collectible (net) rent is gross cap MINUS the published utility
// allowance for that jurisdiction. We don't bake a UA in here — the
// operating-expense side of the pro forma should carry utilities if
// it's an all-bills-paid deal, or the analyst should subtract a UA
// in the per-tier max rent override if tenants pay.

export const HH_SIZE_ADJUSTMENT: number[] = [0.70, 0.80, 0.90, 1.00, 1.08, 1.16, 1.24, 1.32];

export const HH_SIZE_FOR_UNIT: Record<string, number> = {
  studio: 1,
  one_br: 1.5,
  two_br: 3,
  three_br: 4.5,
  four_br_plus: 6,
};

/** Derive 1-8p income limits from the 4-person limit using HUD's family-size factors. */
export function deriveLimitsFromFourPerson(fourPersonLimit: number): number[] {
  return HH_SIZE_ADJUSTMENT.map((factor) =>
    Math.round((fourPersonLimit * factor) / 50) * 50
  );
}

/** Max rent = 30% of monthly income for the unit's target household size. */
export function computeMaxRent(incomeLimits: number[], unitType: string): number {
  const hhSize = HH_SIZE_FOR_UNIT[unitType] || 1;
  const lowerIdx = Math.max(0, Math.floor(hhSize) - 1);
  const upperIdx = Math.min(7, Math.ceil(hhSize) - 1);
  const frac = hhSize - Math.floor(hhSize);

  let incomeLimit: number;
  if (lowerIdx === upperIdx || !incomeLimits[upperIdx]) {
    incomeLimit = incomeLimits[lowerIdx] || 0;
  } else {
    incomeLimit = incomeLimits[lowerIdx] * (1 - frac) + incomeLimits[upperIdx] * frac;
  }

  return Math.round((incomeLimit * 0.30) / 12);
}

export interface AmiComputed {
  income_limits: {
    extremely_low_30: number[];
    very_low_50: number[];
    sixty_pct: number[];
    low_80: number[];
    median_100: number[];
    moderate_120: number[];
  };
  max_rents: {
    ami_30: { studio: number; one_br: number; two_br: number; three_br: number; four_br: number };
    ami_50: { studio: number; one_br: number; two_br: number; three_br: number; four_br: number };
    ami_60: { studio: number; one_br: number; two_br: number; three_br: number; four_br: number };
    ami_80: { studio: number; one_br: number; two_br: number; three_br: number; four_br: number };
    ami_100: { studio: number; one_br: number; two_br: number; three_br: number; four_br: number };
    ami_120: { studio: number; one_br: number; two_br: number; three_br: number; four_br: number };
  };
}

/**
 * Given the 4-person Median Family Income and (optionally) HUD-published per-HH-size limits,
 * returns a fully-populated set of income limits and max rents at every AMI tier.
 *
 * If any tier's limits are missing or all-zero, they are derived from the MFI
 * using HUD's standard family-size adjustment factors.
 */
export function buildAmiTables(
  medianFamilyIncome: number,
  provided?: {
    extremely_low_30?: number[];
    very_low_50?: number[];
    low_80?: number[];
  }
): AmiComputed {
  const allZero = (arr?: number[]) => !arr || arr.every((v) => !v);

  const veryLow50 = !allZero(provided?.very_low_50)
    ? provided!.very_low_50!
    : deriveLimitsFromFourPerson(medianFamilyIncome * 0.50);

  const extremeLow30 = !allZero(provided?.extremely_low_30)
    ? provided!.extremely_low_30!
    : deriveLimitsFromFourPerson(medianFamilyIncome * 0.30);

  const low80 = !allZero(provided?.low_80)
    ? provided!.low_80!
    : deriveLimitsFromFourPerson(medianFamilyIncome * 0.80);

  const sixtyPct = veryLow50.map((v) => Math.round(v * 1.2));
  const median100 = veryLow50.map((v) => Math.round(v * 2));
  const moderate120 = median100.map((v) => Math.round(v * 1.2));

  const computeRents = (limits: number[]) => ({
    studio: computeMaxRent(limits, "studio"),
    one_br: computeMaxRent(limits, "one_br"),
    two_br: computeMaxRent(limits, "two_br"),
    three_br: computeMaxRent(limits, "three_br"),
    four_br: computeMaxRent(limits, "four_br_plus"),
  });

  return {
    income_limits: {
      extremely_low_30: extremeLow30,
      very_low_50: veryLow50,
      sixty_pct: sixtyPct,
      low_80: low80,
      median_100: median100,
      moderate_120: moderate120,
    },
    max_rents: {
      ami_30: computeRents(extremeLow30),
      ami_50: computeRents(veryLow50),
      ami_60: computeRents(sixtyPct),
      ami_80: computeRents(low80),
      ami_100: computeRents(median100),
      ami_120: computeRents(moderate120),
    },
  };
}

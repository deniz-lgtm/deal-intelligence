// Correlation matrix + Cholesky decomposition for correlated MC draws.
//
// We sample 4 correlated standard normals per trial (rent growth, vacancy,
// exit cap, rate) by drawing 4 independent standard normals z and
// multiplying by L (Cholesky factor of Σ): z_corr = L · z.

export const CORRELATION_VERSION = "mc-1.0.0";

/**
 * Default 4×4 correlation matrix.
 *
 * Order: [rentGrowth, vacancy, exitCap, rate]
 *
 * Defaults from the plan:
 *   ρ(rate, exitCap)        = +0.6  — rates up → cap rates up
 *   ρ(rate, rentGrowth)     = +0.3  — inflationary regimes nudge rents
 *   ρ(vacancy, rentGrowth)  = −0.4  — high vacancy suppresses rent growth
 */
export const DEFAULT_CORRELATION: number[][] = [
  // rg     vac    ec     rate
  [1.0, -0.4, 0.0, 0.3], // rg
  [-0.4, 1.0, 0.0, 0.0], // vac
  [0.0, 0.0, 1.0, 0.6], // ec
  [0.3, 0.0, 0.6, 1.0], // rate
];

/**
 * Cholesky decomposition: returns lower-triangular L such that L · L^T = M.
 * Throws if M is not positive semi-definite.
 */
export function cholesky(m: number[][]): number[][] {
  const n = m.length;
  const L: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let sum = 0;
      for (let k = 0; k < j; k++) sum += L[i][k] * L[j][k];
      if (i === j) {
        const diag = m[i][i] - sum;
        if (diag <= 0) {
          // Tiny negative values can appear from floating-point drift on
          // valid PSD matrices; clamp very-small negatives to zero.
          if (diag > -1e-9) L[i][j] = 0;
          else throw new Error(`cholesky: matrix not PSD at row ${i}, diag=${diag}`);
        } else {
          L[i][j] = Math.sqrt(diag);
        }
      } else {
        L[i][j] = L[j][j] === 0 ? 0 : (m[i][j] - sum) / L[j][j];
      }
    }
  }
  return L;
}

/** Multiply lower-triangular L (n×n) by independent standard-normal vector z. */
export function applyCholesky(L: number[][], z: number[]): number[] {
  const n = L.length;
  const out = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let j = 0; j <= i; j++) s += L[i][j] * z[j];
    out[i] = s;
  }
  return out;
}

/**
 * Serializable axis/value formats.
 *
 * Charts are Client Components but most of their callers are Server
 * Components, and React cannot serialize a function across that boundary --
 * passing `yFormat={(v) => ...}` from a server page throws at render. So the
 * format is named by a string and resolved on the client side.
 */
export type NumberFormat =
  | "int"
  | "compact"
  | "fixed1"
  | "fixed2"
  | "pctInt"
  | "pct1"
  | "pctOfUnit"
  | "exp"
  | "ms";

export function formatNumber(v: number, kind: NumberFormat = "int"): string {
  if (!Number.isFinite(v)) return "—";
  switch (kind) {
    case "compact":
      if (Math.abs(v) >= 1e9) return `${(v / 1e9).toFixed(1)}B`;
      if (Math.abs(v) >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
      if (Math.abs(v) >= 1e4) return `${(v / 1e3).toFixed(1)}k`;
      return String(Math.round(v));
    case "fixed1":
      return v.toFixed(1);
    case "fixed2":
      return v.toFixed(2);
    case "pctInt":
      // value is a 0..1 fraction
      return `${Math.round(v * 100)}%`;
    case "pct1":
      return `${(v * 100).toFixed(1)}%`;
    case "pctOfUnit":
      // value is already a percentage
      return `${v.toFixed(1)}%`;
    case "exp":
      return v === 0 ? "0" : v.toExponential(0);
    case "ms":
      return v < 10 ? `${v.toFixed(1)}ms` : `${Math.round(v)}ms`;
    case "int":
    default:
      return Math.round(v).toLocaleString("en-US");
  }
}

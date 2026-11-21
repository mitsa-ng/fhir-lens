/**
 * Plain-text table rendering for CLI output. No dependencies,
 * fixed cell padding, CJK-safe via String width fallback (padding
 * counts code points, which is good enough for terminal triage).
 */

export type Row = Record<string, unknown>;

function cell(value: unknown, width: number): string {
  const s =
    value === undefined || value === null
      ? ""
      : typeof value === "object"
        ? JSON.stringify(value)
        : String(value);
  const truncated =
    s.length > width - 1 ? `${s.slice(0, Math.max(1, width - 2))}…` : s;
  return truncated.padEnd(width, " ");
}

/** Render rows as an ASCII table with a header line. */
export function toTable(rows: Row[], columns: string[], width = 24): string {
  if (rows.length === 0) return "(no results)";
  const lines: string[] = [];
  lines.push(columns.map((c) => cell(c, width)).join(" ").trimEnd());
  lines.push("-".repeat(Math.min(120, columns.length * (width + 1))));
  for (const row of rows) {
    lines.push(
      columns.map((c) => cell(row[c], width)).join(" ").trimEnd(),
    );
  }
  return lines.join("\n");
}

/** HumanName[] → "Given Family" (first name group with a usable part). */
export function humanName(names: unknown): string {
  if (!Array.isArray(names)) return "";
  for (const name of names) {
    if (typeof name !== "object" || name === null) continue;
    const n = name as Record<string, unknown>;
    const given = Array.isArray(n.given) ? n.given.join(" ") : n.given;
    const parts = [given, n.family].filter(
      (p): p is string => typeof p === "string" && p.length > 0,
    );
    if (parts.length > 0) return parts.join(" ");
  }
  return "";
}

/** CodeableConcept → "code (system)" or its text. */
export function codeableConcept(cc: unknown): string {
  if (typeof cc !== "object" || cc === null) return "";
  const c = cc as Record<string, unknown>;
  if (Array.isArray(c.coding) && c.coding.length > 0) {
    const first = c.coding[0] as Record<string, unknown>;
    const code = typeof first.code === "string" ? first.code : "?";
    const system = typeof first.system === "string"
      ? ` (${first.system.replace(/^.*\//, "")})`
      : "";
    return `${code}${system}`;
  }
  return typeof c.text === "string" ? c.text : "";
}

/** The single value[x] of an Observation, as a short string. */
export function observationValue(obs: Record<string, unknown>): string {
  if (obs.dataAbsentReason !== undefined) {
    return `absent: ${codeableConcept(obs.dataAbsentReason)}`;
  }
  for (const [key, value] of Object.entries(obs)) {
    if (!key.startsWith("value")) continue;
    if (key === "valueQuantity") {
      const q = value as Record<string, unknown>;
      return `${q.value ?? "?"} ${typeof q.unit === "string" ? q.unit : (q.code ?? "")}`.trim();
    }
    if (key === "valueCodeableConcept") return codeableConcept(value);
    if (typeof value !== "object") return String(value);
  }
  return "";
}

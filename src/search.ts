/**
 * FHIR R4 search parameter builder.
 *
 * Encodes search parameters exactly the way a FHIR server expects:
 * repeated keys stay repeated, token params use the system|code form,
 * and date/number prefixes pass through untouched ("ge2020-01-01").
 */

export interface BuiltSearch {
  /** Path relative to the FHIR base URL, e.g. "Patient" or "Observation" */
  path: string;
  /** Encoded query string, without the leading "?" */
  query: string;
}

export class SearchBuilder {
  private readonly resourceType: string;
  private readonly params: [string, string][] = [];

  constructor(resourceType: string) {
    if (!/^[A-Z][A-Za-z]+$/.test(resourceType)) {
      throw new Error(`invalid resource type: ${resourceType}`);
    }
    this.resourceType = resourceType;
  }

  /** Set a parameter, replacing any previous value for the same key. */
  set(key: string, value: string): this {
    this.delete(key);
    this.params.push([key, value]);
    return this;
  }

  /** Add a parameter, allowing repeats (FHIR AND semantics). */
  add(key: string, value: string): this {
    this.params.push([key, value]);
    return this;
  }

  delete(key: string): this {
    for (let i = this.params.length - 1; i >= 0; i--) {
      if (this.params[i][0] === key) this.params.splice(i, 1);
    }
    return this;
  }

  /** Token param from system and/or code: "system|code", "|code", "system|". */
  token(key: string, system?: string, code?: string): this {
    const value = `${system ?? ""}|${code ?? ""}`;
    return this.set(key, value);
  }

  /** Page size (_count). */
  count(n: number): this {
    return this.set("_count", String(n));
  }

  /** _summary=true | false | text | data | count. */
  summary(mode: "true" | "false" | "text" | "data" | "count"): this {
    return this.set("_summary", mode);
  }

  /** _total=accurate | estimate | none. */
  total(mode: "accurate" | "estimate" | "none"): this {
    return this.set("_total", mode);
  }

  /** Ask the server to include referenced resources, e.g. include("Observation", "patient"). */
  include(resourceType: string, searchParam: string, iterate = false): this {
    return this.add("_include", `${resourceType}:${searchParam}${iterate ? ":iterate" : ""}`);
  }

  /** Reverse include, e.g. revinclude("Observation", "subject"). */
  revinclude(resourceType: string, searchParam: string, iterate = false): this {
    return this.add("_revinclude", `${resourceType}:${searchParam}${iterate ? ":iterate" : ""}`);
  }

  /** Restrict returned elements, e.g. elements("status", "code", "valueQuantity"). */
  elements(...fields: string[]): this {
    return this.set("_elements", fields.join(","));
  }

  build(): BuiltSearch {
    const query = new URLSearchParams();
    for (const [k, v] of this.params) query.append(k, v);
    return { path: this.resourceType, query: query.toString() };
  }

  toString(): string {
    const { path, query } = this.build();
    return query.length > 0 ? `${path}?${query}` : path;
  }
}

/** Convenience constructor: fhirSearch("Observation").token("code", "http://loinc.org", "718-7").count(50) */
export function fhirSearch(resourceType: string): SearchBuilder {
  return new SearchBuilder(resourceType);
}

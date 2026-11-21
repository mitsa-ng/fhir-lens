/**
 * Minimal FHIR R4 REST client on the platform fetch.
 * Read-oriented: capability, read, vread, search, nextPage, create.
 */

import { SearchBuilder } from "./search.ts";

export interface FhirClientOptions {
  baseUrl: string;
  /** Bearer token, sent as Authorization header when present. */
  bearerToken?: string;
  /** Extra headers merged into every request. */
  headers?: Record<string, string>;
  /** Request timeout in ms. Default 15000. */
  timeoutMs?: number;
}

export class FhirError extends Error {
  readonly status: number;
  readonly operationOutcome: unknown;

  constructor(status: number, message: string, operationOutcome?: unknown) {
    super(`FHIR server returned ${status}: ${message}`);
    this.name = "FhirError";
    this.status = status;
    this.operationOutcome = operationOutcome;
  }
}

interface BundleLink {
  relation: string;
  url: string;
}

type Bundle = {
  resourceType: "Bundle";
  link?: BundleLink[];
  entry?: { resource?: unknown }[];
};

export class FhirClient {
  readonly baseUrl: string;
  private readonly headers: Record<string, string>;
  private readonly timeoutMs: number;

  constructor(opts: FhirClientOptions) {
    // Strip a trailing slash so URL joining is predictable.
    this.baseUrl = opts.baseUrl.replace(/\/+$/, "");
    this.headers = {
      Accept: "application/fhir+json",
      ...(opts.bearerToken ? { Authorization: `Bearer ${opts.bearerToken}` } : {}),
      ...opts.headers,
    };
    this.timeoutMs = opts.timeoutMs ?? 15_000;
  }

  private async request(path: string, init?: RequestInit): Promise<unknown> {
    const url = `${this.baseUrl}/${path.replace(/^\/+/, "")}`;
    const response = await fetch(url, {
      ...init,
      headers: { ...this.headers, ...(init?.headers ?? {}) },
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    const text = await response.text();
    let body: unknown = undefined;
    if (text.length > 0) {
      try {
        body = JSON.parse(text);
      } catch {
        body = text;
      }
    }

    if (!response.ok) {
      const outcome = body as { issue?: { diagnostics?: string }[] } | undefined;
      const diagnostics = outcome?.issue?.[0]?.diagnostics ?? response.statusText;
      throw new FhirError(response.status, diagnostics, body);
    }
    return body;
  }

  capabilityStatement(): Promise<unknown> {
    return this.request("metadata");
  }

  read<T = unknown>(resourceType: string, id: string): Promise<T> {
    return this.request(`${resourceType}/${encodeURIComponent(id)}`) as Promise<T>;
  }

  search(builder: SearchBuilder): Promise<Bundle> {
    return this.request(builder.toString()) as Promise<Bundle>;
  }

  /** Follow a Bundle's next link, or null when on the last page. */
  nextPage(bundle: Bundle): Promise<Bundle | null> {
    const next = bundle.link?.find((l) => l.relation === "next");
    if (next === undefined) return Promise.resolve(null);
    // Next links are absolute or base-relative; strip our base if present.
    const path = next.url.startsWith(this.baseUrl)
      ? next.url.slice(this.baseUrl.length + 1)
      : next.url;
    return this.request(path) as Promise<Bundle>;
  }

  /** Collect resources across pages, stopping at limit pages to stay polite. */
  async searchAll(
    builder: SearchBuilder,
    maxPages = 10,
  ): Promise<{ resources: unknown[]; pages: number; truncated: boolean }> {
    const resources: unknown[] = [];
    let bundle: Bundle | null = await this.search(builder);
    let pages = 0;
    while (bundle !== null && pages < maxPages) {
      pages++;
      for (const entry of bundle.entry ?? []) {
        if (entry.resource !== undefined) resources.push(entry.resource);
      }
      bundle = await this.nextPage(bundle);
    }
    return { resources, pages, truncated: bundle !== null };
  }

  create(resource: Record<string, unknown>): Promise<unknown> {
    return this.request(`${resource.resourceType as string}`, {
      method: "POST",
      headers: { "Content-Type": "application/fhir+json" },
      body: JSON.stringify(resource),
    });
  }
}

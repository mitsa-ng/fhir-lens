#!/usr/bin/env node
/**
 * fhir-lens CLI
 *
 *   fhir-lens capability
 *   fhir-lens get <ResourceType> <id>
 *   fhir-lens search <ResourceType> [key=value]...   token params: code=system|code
 *   fhir-lens validate <file.json> [--expect <ResourceType>]
 *
 * Configuration via environment:
 *   FHIR_BASE   FHIR R4 base URL (default: public HAPI sandbox)
 *   FHIR_TOKEN  optional Bearer token
 */

import { readFileSync } from "node:fs";
import { FhirClient } from "../src/client.ts";
import { fhirSearch } from "../src/search.ts";
import { validateResource } from "../src/validate.ts";
import {
  toTable, humanName, codeableConcept, observationValue,
} from "../src/format.ts";

const DEFAULT_BASE = "https://hapi.fhir.org/baseR4";

function usage(): never {
  console.log(`fhir-lens, a zero-dependency FHIR R4 lens

usage:
  fhir-lens capability
  fhir-lens get <ResourceType> <id>
  fhir-lens search <ResourceType> [key=value ...]
  fhir-lens validate <file.json> [--expect <ResourceType>]

env:
  FHIR_BASE   base URL (default ${DEFAULT_BASE})
  FHIR_TOKEN  Bearer token
`);
  process.exit(1);
}

function client(): FhirClient {
  return new FhirClient({
    baseUrl: process.env.FHIR_BASE ?? DEFAULT_BASE,
    bearerToken: process.env.FHIR_TOKEN,
  });
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  if (command === undefined) usage();

  if (command === "capability") {
    const capability = (await client().capabilityStatement()) as Record<string, unknown>;
    console.log(
      toTable(
        [{ software: capability.software, fhirVersion: capability.fhirVersion, date: capability.date }],
        ["fhirVersion", "software", "date"],
      ),
    );
    return;
  }

  if (command === "get") {
    const [type, id] = rest;
    if (type === undefined || id === undefined) usage();
    console.log(JSON.stringify(await client().read(type, id), null, 2));
    return;
  }

  if (command === "search") {
    const [type, ...pairs] = rest;
    if (type === undefined) usage();
    const builder = fhirSearch(type);
    for (const pair of pairs) {
      const eq = pair.indexOf("=");
      if (eq < 1) usage();
      builder.add(pair.slice(0, eq), pair.slice(eq + 1));
    }
    const bundle = await client().search(builder);
    const rows = (bundle.entry ?? []).map(
      (e) => e.resource as Record<string, unknown>,
    ).filter((r) => r !== undefined);

    if (type === "Patient") {
      console.log(toTable(
        rows.map((r) => ({ id: r.id, name: humanName(r.name), gender: r.gender, birthDate: r.birthDate })),
        ["id", "name", "gender", "birthDate"],
      ));
    } else if (type === "Observation") {
      console.log(toTable(
        rows.map((r) => ({
          id: r.id, status: r.status, code: codeableConcept(r.code),
          value: observationValue(r), subject: (r.subject as Record<string, unknown>)?.reference,
        })),
        ["id", "status", "code", "value", "subject"],
      ));
    } else {
      console.log(toTable(
        rows.map((r) => ({ id: r.id, resourceType: r.resourceType })),
        ["id", "resourceType"],
      ));
    }
    console.log(`\n${bundle.total ?? rows.length} result(s)`);
    return;
  }

  if (command === "validate") {
    const file = rest.find((a) => !a.startsWith("--"));
    const expectIdx = rest.indexOf("--expect");
    const expect = expectIdx >= 0 ? rest[expectIdx + 1] : undefined;
    if (file === undefined) usage();
    const resource: unknown = JSON.parse(readFileSync(file, "utf8"));
    const result = validateResource(resource, expect);
    console.log(`resourceType: ${result.resourceType}`);
    console.log(`valid:       ${result.valid}`);
    for (const issue of result.issues) {
      console.log(`  [${issue.severity}] ${issue.path} (${issue.rule}): ${issue.message}`);
    }
    process.exitCode = result.valid ? 0 : 1;
    return;
  }

  usage();
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});

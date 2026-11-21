# fhir-lens

A zero-dependency FHIR R4 toolkit: a conformance-subset validator, a search-parameter
builder, a read/search REST client, and a CLI to glue them together.

Built for integration triage: point it at any R4 server, inspect what comes back,
and catch the resource errors that break ingestion pipelines before they hit production.

## Why another FHIR tool

Full validation needs the complete R4 structure definitions. But day-to-day
integration work mostly trips over the same things: missing `status`/`code`,
bad value sets, choice-type conflicts, malformed references, illegal Bundle
entries. `fhir-lens` enforces exactly that practical subset, offline, with zero
`npm install`. The rule set is deliberately honest about its scope: unsupported
resource types get a warning, never a silent pass.

## Install

Requires Node.js 23.6+ (native TypeScript). No dependencies, no build step.

```sh
git clone https://github.com/mitsa-ng/fhir-lens.git
cd fhir-lens
node bin/fhir-lens.ts capability   # hits the public HAPI R4 sandbox by default
```

## CLI

```sh
export FHIR_BASE=https://hapi.fhir.org/baseR4    # or any R4 server
export FHIR_TOKEN=...                            # optional Bearer token

fhir-lens capability
fhir-lens get Patient example
fhir-lens search Observation "status=final" "code=http://loinc.org|718-7" _count=10
fhir-lens search Patient name=Chen
fhir-lens validate obs.json --expect Observation
```

`validate` exits non-zero when errors are found, so it drops straight into a
CI gate or a pre-ingestion check.

## Library

```ts
import { FhirClient } from "./src/client.ts";
import { fhirSearch } from "./src/search.ts";
import { validateResource } from "./src/validate.ts";

const client = new FhirClient({ baseUrl: "https://hapi.fhir.org/baseR4" });

const bundle = await client.search(
  fhirSearch("Observation")
    .token("code", "http://loinc.org", "718-7")
    .set("status", "final")
    .add("date", "ge2026-01-01")
    .count(20),
);

for (const entry of bundle.entry ?? []) {
  const result = validateResource(entry.resource);
  if (!result.valid) console.error(entry.resource?.id, result.issues);
}

// Walk pages politely
const all = await client.searchAll(fhirSearch("Patient").count(50), 10);
```

## Validation scope

| Resource | Checks |
|---|---|
| Observation | required `status` + `code`, status value set, obs-6 (dataAbsentReason vs value[x]), component.code, value-carried sanity |
| Patient | gender value set, deceased[x] / multipleBirth[x] choice exclusion |
| DiagnosticReport | required `status` + `code`, status value set |
| Bundle | type value set, bdl-7 fullUrl uniqueness, bdl-3 entry.request rules, bdl-9 document identifier |
| Any | reference shape (Type/id or absolute), CodeableConcept coding pairing |

Anything else: generic checks plus an explicit `subset-scope` warning.

## Tests

```sh
node --test    # 29 tests, including a live in-process mock FHIR server
```

## License

MIT

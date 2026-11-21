import { test } from "node:test";
import assert from "node:assert/strict";
import { validateResource } from "../src/validate.ts";

const validObservation = {
  resourceType: "Observation",
  status: "final",
  code: {
    coding: [{ system: "http://loinc.org", code: "718-7", display: "Hemoglobin [Mass/volume] in Blood" }],
  },
  subject: { reference: "Patient/example" },
  valueQuantity: { value: 13.5, unit: "g/dL", system: "http://unitsofmeasure.org", code: "g/dL" },
  effectiveDateTime: "2026-11-01T09:30:00+08:00",
};

test("valid Observation passes with no issues", () => {
  const result = validateResource(validObservation);
  assert.equal(result.valid, true);
  assert.deepEqual(result.issues, []);
});

test("Observation missing status and code reports both errors", () => {
  const result = validateResource({ resourceType: "Observation" });
  assert.equal(result.valid, false);
  const paths = result.issues.filter((i) => i.severity === "error").map((i) => i.path);
  assert.ok(paths.includes("status"));
  assert.ok(paths.includes("code"));
});

test("Observation with unknown status fails the value set", () => {
  const result = validateResource({ ...validObservation, status: "done" });
  assert.equal(result.valid, false);
  assert.ok(result.issues.some((i) => i.rule === "obs-status"));
});

test("obs-6: dataAbsentReason together with value[x] is an error", () => {
  const result = validateResource({
    ...validObservation,
    dataAbsentReason: { coding: [{ system: "http://terminology.hl7.org/CodeSystem/data-absent-reason", code: "unknown" }] },
  });
  assert.equal(result.valid, false);
  assert.ok(result.issues.some((i) => i.rule === "obs-6"));
});

test("dataAbsentReason alone is legal", () => {
  const { valueQuantity: _drop, ...withoutValue } = validObservation;
  const result = validateResource({
    ...withoutValue,
    dataAbsentReason: { coding: [{ system: "http://terminology.hl7.org/CodeSystem/data-absent-reason", code: "not-performed" }] },
  });
  assert.equal(result.valid, true);
});

test("component without code is an error", () => {
  const result = validateResource({
    ...validObservation,
    component: [{ valueQuantity: { value: 1 } }],
  });
  assert.equal(result.valid, false);
  assert.ok(result.issues.some((i) => i.rule === "obs-component-code"));
});

test("Patient with both deceased choices fails choice exclusion", () => {
  const result = validateResource({
    resourceType: "Patient",
    deceasedBoolean: false,
    deceasedDateTime: "2020-01-01",
  });
  assert.equal(result.valid, false);
  assert.ok(result.issues.some((i) => i.rule === "choice-mutual-exclusion"));
});

test("Patient gender outside the value set fails", () => {
  const result = validateResource({ resourceType: "Patient", gender: "M" });
  assert.equal(result.valid, false);
  assert.ok(result.issues.some((i) => i.rule === "patient-gender-1"));
});

test("unsupported reference shape produces a warning, not an error", () => {
  const result = validateResource({
    ...validObservation,
    subject: { reference: "not-a-valid-shape" },
  });
  assert.equal(result.valid, true);
  assert.ok(result.issues.some((i) => i.rule === "reference-shape"));
});

test("Bundle duplicate fullUrl violates bdl-7", () => {
  const result = validateResource({
    resourceType: "Bundle",
    type: "collection",
    entry: [
      { fullUrl: "urn:uuid:abc", resource: { resourceType: "Patient", id: "1" } },
      { fullUrl: "urn:uuid:abc", resource: { resourceType: "Patient", id: "2" } },
    ],
  });
  assert.equal(result.valid, false);
  assert.ok(result.issues.some((i) => i.rule === "bdl-7"));
});

test("bdl-3: transaction entries must carry request", () => {
  const result = validateResource({
    resourceType: "Bundle",
    type: "transaction",
    entry: [
      {
        fullUrl: "urn:uuid:1",
        resource: { resourceType: "Patient" },
        // request intentionally omitted
      },
    ],
  });
  assert.equal(result.valid, false);
  assert.ok(result.issues.some((i) => i.rule === "bdl-3"));
});

test("bdl-3: searchset entries must NOT carry request", () => {
  const result = validateResource({
    resourceType: "Bundle",
    type: "searchset",
    entry: [{ resource: { resourceType: "Patient" }, request: { method: "GET", url: "Patient" } }],
  });
  assert.equal(result.valid, false);
  assert.ok(result.issues.some((i) => i.rule === "bdl-3"));
});

test("bdl-9: document Bundle needs identifier system+value", () => {
  const result = validateResource({
    resourceType: "Bundle",
    type: "document",
    identifier: { value: "doc-1" },
  });
  assert.equal(result.valid, false);
  assert.ok(result.issues.some((i) => i.rule === "bdl-9"));
});

test("missing resourceType is an error", () => {
  const result = validateResource({ status: "final" });
  assert.equal(result.valid, false);
  assert.ok(result.issues.some((i) => i.path === "resourceType"));
});

test("expectedType mismatch is reported", () => {
  const result = validateResource(validObservation, "Patient");
  assert.equal(result.valid, false);
  assert.ok(result.issues.some((i) => i.rule === "res-2"));
});

test("unsupported resource type degrades to a warning", () => {
  const result = validateResource({ resourceType: "Practitioner", id: "p1" });
  assert.equal(result.valid, true);
  assert.ok(result.issues.some((i) => i.rule === "subset-scope" && i.severity === "warning"));
});

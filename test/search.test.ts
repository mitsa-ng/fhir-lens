import { test } from "node:test";
import assert from "node:assert/strict";
import { fhirSearch } from "../src/search.ts";

test("plain params encode in order", () => {
  const s = fhirSearch("Observation").set("status", "final").set("code", "718-7");
  assert.equal(s.toString(), "Observation?status=final&code=718-7");
});

test("token params keep the system|code form", () => {
  const s = fhirSearch("Observation").token("code", "http://loinc.org", "718-7");
  assert.equal(s.toString(), "Observation?code=http%3A%2F%2Floinc.org%7C718-7");
});

test("repeated keys stay repeated (AND semantics)", () => {
  const s = fhirSearch("Patient").add("name", "Chen").add("name", "Lin");
  assert.equal(s.toString(), "Patient?name=Chen&name=Lin");
});

test("date prefixes pass through untouched", () => {
  const s = fhirSearch("Observation").add("date", "ge2020-01-01").add("date", "lt2027-01-01");
  assert.equal(s.toString(), "Observation?date=ge2020-01-01&date=lt2027-01-01");
});

test("count and summary", () => {
  const s = fhirSearch("Patient").count(20).summary("count");
  assert.equal(s.toString(), "Patient?_count=20&_summary=count");
});

test("include syntax", () => {
  const s = fhirSearch("Observation").set("code", "29463-7").include("Observation", "patient");
  assert.equal(s.toString(), "Observation?code=29463-7&_include=Observation%3Apatient");
});

test("set replaces, add appends", () => {
  const s = fhirSearch("Patient").add("name", "A").set("name", "B");
  assert.equal(s.toString(), "Patient?name=B");
});

test("special characters are percent-encoded safely", () => {
  const s = fhirSearch("Patient").set("name", "O'Brien & Sons");
  assert.equal(s.toString(), "Patient?name=O%27Brien+%26+Sons");
});

test("invalid resource type is rejected", () => {
  assert.throws(() => fhirSearch("patient"), /invalid resource type/);
  assert.throws(() => fhirSearch(""), /invalid resource type/);
});

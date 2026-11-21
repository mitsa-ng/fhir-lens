/**
 * Client tests against a real local HTTP server acting as a FHIR R4
 * endpoint, so everything runs offline but exercises actual sockets.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { FhirClient, FhirError } from "../src/client.ts";
import { fhirSearch } from "../src/search.ts";

const patient = {
  resourceType: "Patient",
  id: "pat-1",
  name: [{ family: "Chen", given: ["Xiao-Ming"] }],
  gender: "male",
};

let server: Server;
let base = "";
let lastRequest: { method: string; path: string; auth?: string } | undefined;

before(async () => {
  server = createServer((req, res) => {
    lastRequest = { method: req.method ?? "?", path: req.url ?? "?", auth: req.headers.authorization };
    res.setHeader("content-type", "application/fhir+json");

    if (req.url === "/metadata") {
      res.end(JSON.stringify({
        resourceType: "CapabilityStatement",
        status: "active",
        fhirVersion: "4.0.1",
        date: "2026-11-22",
        software: { name: "mock-hapi", version: "0.1" },
      }));
      return;
    }
    if (req.url === "/Patient/pat-1") {
      res.end(JSON.stringify(patient));
      return;
    }
    if (req.url === "/Patient/missing") {
      res.statusCode = 404;
      res.end(JSON.stringify({
        resourceType: "OperationOutcome",
        issue: [{ severity: "error", code: "not-found", diagnostics: "Patient/missing not found" }],
      }));
      return;
    }
    if (req.url?.startsWith("/Observation?")) {
      const page = req.url.includes("_page=2") ? "2" : "1";
      const link =
        page === "1"
          ? [{ relation: "next", url: `${base}/Observation?_count=2&_page=2` }]
          : [{ relation: "self", url: `${base}/Observation?_count=2&_page=2` }];
      const id = page === "1" ? "obs-1" : "obs-2";
      res.end(JSON.stringify({
        resourceType: "Bundle",
        type: "searchset",
        total: 2,
        link,
        entry: [{ resource: { resourceType: "Observation", id, status: "final" } }],
      }));
      return;
    }
    res.statusCode = 404;
    res.end(JSON.stringify({
      resourceType: "OperationOutcome",
      issue: [{ severity: "error", code: "not-found" }],
    }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("no port");
  base = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

test("capabilityStatement returns parsed metadata", async () => {
  const client = new FhirClient({ baseUrl: base });
  const cap = (await client.capabilityStatement()) as { fhirVersion?: string };
  assert.equal(cap.fhirVersion, "4.0.1");
});

test("read returns the resource and sends Accept + Bearer headers", async () => {
  const client = new FhirClient({ baseUrl: `${base}/`, bearerToken: "tok-123" });
  const got = await client.read<PatientShape>("Patient", "pat-1");
  assert.equal(got.id, "pat-1");
  assert.equal(lastRequest?.auth, "Bearer tok-123");
});

interface PatientShape { resourceType: string; id: string }

test("404 raises FhirError carrying the OperationOutcome", async () => {
  const client = new FhirClient({ baseUrl: base });
  await assert.rejects(
    () => client.read("Patient", "missing"),
    (err: unknown) => {
      assert.ok(err instanceof FhirError);
      assert.equal(err.status, 404);
      assert.match(err.message, /Patient\/missing not found/);
      return true;
    },
  );
});

test("search follows next links and searchAll stops after last page", async () => {
  const client = new FhirClient({ baseUrl: base });
  const first = await client.search(fhirSearch("Observation").count(2));
  assert.equal(first.entry?.length, 1);
  const second = await client.nextPage(first);
  assert.notEqual(second, null);
  const third = await client.nextPage(second!);
  assert.equal(third, null);

  const all = await client.searchAll(fhirSearch("Observation").count(2));
  assert.equal(all.resources.length, 2);
  assert.equal(all.pages, 2);
  assert.equal(all.truncated, false);
});

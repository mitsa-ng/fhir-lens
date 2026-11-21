/**
 * Practical-subset validator for FHIR R4 resources.
 *
 * Scope is intentionally honest: this is NOT a full FHIR validator
 * (that needs the full R4 structure definitions). It enforces the
 * required elements, fixed value sets, and well-known invariants of
 * the resources most used in integration work: Patient, Observation,
 * DiagnosticReport, and Bundle. Everything else gets a warning-level
 * pass-through so pipelines can still triage.
 */

export type Severity = "error" | "warning";

export interface Issue {
  severity: Severity;
  path: string;
  message: string;
  rule: string;
}

export interface ValidationResult {
  resourceType: string;
  valid: boolean;
  issues: Issue[];
}

const OBSERVATION_STATUS = [
  "registered", "preliminary", "final", "amended", "corrected",
  "cancelled", "entered-in-error", "unknown",
] as const;

const DIAGNOSTIC_REPORT_STATUS = [
  "registered", "partial", "preliminary", "final", "amended",
  "corrected", "appended", "cancelled", "entered-in-error", "unknown",
] as const;

const BUNDLE_TYPE = [
  "document", "message", "transaction", "transaction-response",
  "batch", "batch-response", "history", "searchset", "collection",
] as const;

const PATIENT_GENDER = ["male", "female", "other", "unknown"] as const;

const OBSERVATION_VALUE_FIELDS = [
  "valueQuantity", "valueCodeableConcept", "valueString", "valueBoolean",
  "valueInteger", "valueRange", "valueRatio", "valueSampledData",
  "valueTime", "valueDateTime", "valuePeriod",
] as const;

type AnyResource = Record<string, unknown>;

class Issues {
  private list: Issue[] = [];

  add(severity: Severity, path: string, rule: string, message: string): void {
    this.list.push({ severity, path, rule, message });
  }

  error(path: string, rule: string, message: string): void {
    this.add("error", path, rule, message);
  }

  warning(path: string, rule: string, message: string): void {
    this.add("warning", path, rule, message);
  }

  result(resourceType: string): ValidationResult {
    return {
      resourceType,
      valid: !this.list.some((i) => i.severity === "error"),
      issues: this.list,
    };
  }
}

function isPlainObject(v: unknown): v is AnyResource {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function requireOne(
  res: AnyResource,
  key: string,
  issues: Issues,
  rule: string,
): void {
  if (res[key] === undefined || res[key] === null || res[key] === "") {
    issues.error(key, rule, `missing required element '${key}'`);
  }
}

function checkCodeableConcept(
  cc: AnyResource,
  path: string,
  issues: Issues,
): void {
  const codings = cc["coding"];
  if (codings !== undefined && Array.isArray(codings)) {
    codings.forEach((coding, i) => {
      if (!isPlainObject(coding)) {
        issues.error(`${path}.coding[${i}]`, "coding-type", "coding entry must be an object");
        return;
      }
      const hasSystem = coding["system"] !== undefined;
      const hasCode = coding["code"] !== undefined;
      if (hasSystem && !hasCode) {
        issues.warning(
          `${path}.coding[${i}]`,
          "coding-pair",
          "coding has system but no code; incomplete code systems break matching",
        );
      }
    });
  }
  if (cc["text"] === undefined && codings === undefined) {
    issues.warning(path, "codeableconcept-empty", "no coding and no text; code is unmatchable");
  }
}

function checkReference(ref: AnyResource, path: string, issues: Issues): void {
  const reference = ref["reference"];
  if (typeof reference === "string" && reference.length > 0) {
    // Relative references look like "ResourceType/id"; absolute URLs are also legal.
    if (!reference.includes("://") && !/^[A-Za-z]+\/[\w.-]+$/.test(reference)) {
      issues.warning(
        `${path}.reference`,
        "reference-shape",
        `literal reference '${reference}' is neither an absolute URL nor 'Type/id'`,
      );
    }
  } else if (ref["identifier"] === undefined && ref["display"] === undefined) {
    issues.error(path, "reference-empty", "reference must have reference, identifier, or display");
  }
}

function validatePatient(res: AnyResource, issues: Issues): void {
  const deceasedBool = res["deceasedBoolean"];
  const deceasedDate = res["deceasedDateTime"];
  if (deceasedBool !== undefined && deceasedDate !== undefined) {
    issues.error(
      "Patient.deceased[x]",
      "choice-mutual-exclusion",
      "only one of deceasedBoolean / deceasedDateTime may be present",
    );
  }
  const gender = res["gender"];
  if (
    gender !== undefined &&
    !(PATIENT_GENDER as readonly string[]).includes(gender as string)
  ) {
    issues.error(
      "Patient.gender",
      "patient-gender-1",
      `value '${gender}' not in required value set [male|female|other|unknown]`,
    );
  }
  const multiBool = res["multipleBirthBoolean"];
  const multiInt = res["multipleBirthInteger"];
  if (multiBool !== undefined && multiInt !== undefined) {
    issues.error(
      "Patient.multipleBirth[x]",
      "choice-mutual-exclusion",
      "only one of multipleBirthBoolean / multipleBirthInteger may be present",
    );
  }
}

function validateObservation(res: AnyResource, issues: Issues): void {
  requireOne(res, "status", issues, "obs-1");
  requireOne(res, "code", issues, "obs-2");
  if (
    res["status"] !== undefined &&
    !(OBSERVATION_STATUS as readonly string[]).includes(res["status"] as string)
  ) {
    issues.error("Observation.status", "obs-status", `value '${res["status"]}' not in required value set`);
  }
  if (isPlainObject(res["code"])) {
    checkCodeableConcept(res["code"], "Observation.code", issues);
  }

  const valuePresent = OBSERVATION_VALUE_FIELDS.some((f) => res[f] !== undefined);
  const dataAbsent = res["dataAbsentReason"];
  if (dataAbsent !== undefined && valuePresent) {
    issues.error(
      "Observation",
      "obs-6",
      "dataAbsentReason SHALL only be present if value[x] is not present",
    );
  }
  if (!valuePresent && dataAbsent === undefined && res["component"] === undefined) {
    issues.warning(
      "Observation",
      "obs-no-value",
      "no value[x], no dataAbsentReason, no component: this observation carries no data",
    );
  }

  const components = res["component"];
  if (Array.isArray(components)) {
    components.forEach((c, i) => {
      if (!isPlainObject(c)) return;
      if (c["code"] === undefined) {
        issues.error(`Observation.component[${i}]`, "obs-component-code", "component requires a code");
      }
    });
  }
}

function validateDiagnosticReport(res: AnyResource, issues: Issues): void {
  requireOne(res, "status", issues, "dr-1");
  requireOne(res, "code", issues, "dr-2");
  if (
    res["status"] !== undefined &&
    !(DIAGNOSTIC_REPORT_STATUS as readonly string[]).includes(res["status"] as string)
  ) {
    issues.error("DiagnosticReport.status", "dr-status", `value '${res["status"]}' not in required value set`);
  }
  if (isPlainObject(res["code"])) {
    checkCodeableConcept(res["code"], "DiagnosticReport.code", issues);
  }
}

function validateBundle(res: AnyResource, issues: Issues): void {
  const type = res["type"];
  if (type === undefined) {
    issues.error("Bundle.type", "bdl-1", "missing required element 'type'");
    return;
  }
  if (!(BUNDLE_TYPE as readonly string[]).includes(type as string)) {
    issues.error("Bundle.type", "bdl-type", `value '${type}' not in required value set`);
    return;
  }

  if (type === "document") {
    const id = res["identifier"];
    if (
      !isPlainObject(id) ||
      id["system"] === undefined ||
      id["value"] === undefined
    ) {
      issues.error(
        "Bundle.identifier",
        "bdl-9",
        "a document Bundle must have an identifier with both system and value",
      );
    }
  }

  const needsRequest = type === "batch" || type === "transaction" || type === "history";
  const fullUrls = new Map<string, number>();
  const entries = res["entry"];
  if (!Array.isArray(entries)) return;

  entries.forEach((entry, i) => {
    if (!isPlainObject(entry)) return;
    if (needsRequest && !isPlainObject(entry["request"])) {
      issues.error(
        `Bundle.entry[${i}].request`,
        "bdl-3",
        `entry.request is mandatory in a ${type} Bundle`,
      );
    }
    if (!needsRequest && isPlainObject(entry["request"])) {
      issues.error(
        `Bundle.entry[${i}].request`,
        "bdl-3",
        `entry.request is prohibited in a ${type} Bundle`,
      );
    }
    const fullUrl = entry["fullUrl"];
    if (typeof fullUrl === "string") {
      const seen = fullUrls.get(fullUrl);
      if (seen !== undefined) {
        issues.error(
          `Bundle.entry[${i}].fullUrl`,
          "bdl-7",
          `fullUrl '${fullUrl}' duplicates entry ${seen}; fullUrl must be unique in a Bundle`,
        );
      } else {
        fullUrls.set(fullUrl, i);
      }
    }
  });
}

const VALIDATORS: Record<string, (res: AnyResource, issues: Issues) => void> = {
  Patient: validatePatient,
  Observation: validateObservation,
  DiagnosticReport: validateDiagnosticReport,
  Bundle: validateBundle,
};

/**
 * Validate a parsed FHIR R4 resource.
 * @param resource parsed JSON resource
 * @param expectedType if given, resourceType must match
 */
export function validateResource(
  resource: unknown,
  expectedType?: string,
): ValidationResult {
  const issues = new Issues();
  if (!isPlainObject(resource)) {
    return {
      resourceType: "(none)",
      valid: false,
      issues: [
        {
          severity: "error",
          path: "$",
          rule: "json-object",
          message: "resource must be a JSON object",
        },
      ],
    };
  }

  const resourceType = resource["resourceType"];
  if (typeof resourceType !== "string" || resourceType.length === 0) {
    issues.error("resourceType", "res-1", "missing required element 'resourceType'");
    return issues.result("(none)");
  }

  if (expectedType !== undefined && resourceType !== expectedType) {
    issues.error(
      "resourceType",
      "res-2",
      `expected ${expectedType} but resource declares ${resourceType}`,
    );
  }

  const validator = VALIDATORS[resourceType];
  if (validator === undefined) {
    issues.warning(
      "resourceType",
      "subset-scope",
      `no rule set loaded for ${resourceType}; only common checks applied`,
    );
  } else {
    validator(resource, issues);
  }

  // Common checks that apply to every resource type.
  if (resource["subject"] !== undefined && isPlainObject(resource["subject"])) {
    checkReference(resource["subject"], "subject", issues);
  }

  return issues.result(resourceType);
}

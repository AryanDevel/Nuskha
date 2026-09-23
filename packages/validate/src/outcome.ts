/**
 * Reading what the HL7 validator writes with `-output`: one OperationOutcome
 * for a single input, or a collection Bundle of them for several, each tagged
 * with the file it describes.
 */

export type Severity = "fatal" | "error" | "warning" | "information";

export interface ValidationIssue {
  readonly severity: Severity;
  /** The OperationOutcome issue type, such as `structure`, `value` or `code-invalid`. */
  readonly code: string;
  /** The validator's own message, which is written to be read by a person. */
  readonly message: string;
  /** Where the issue is, as a FHIRPath with the validator's inline annotations removed. */
  readonly path?: string;
  /** The validator's stable message key, such as `Validation_VAL_Profile_Minimum`. */
  readonly messageId?: string;
  /** Position in the JSON the validator was given. */
  readonly line?: number;
  readonly column?: number;
}

export interface ValidationResult {
  /** True when there are no `fatal` or `error` issues. Warnings do not fail validation. */
  readonly valid: boolean;
  readonly issues: readonly ValidationIssue[];
}

interface OperationOutcome {
  resourceType: "OperationOutcome";
  extension?: Extension[];
  issue?: {
    severity: Severity;
    code: string;
    details?: { text?: string };
    diagnostics?: string;
    expression?: string[];
    location?: string[];
    extension?: Extension[];
  }[];
}

interface Extension {
  url: string;
  valueString?: string;
  valueCode?: string;
  valueInteger?: number;
}

const EXT = "http://hl7.org/fhir/StructureDefinition/operationoutcome-";

function ext(list: Extension[] | undefined, name: string): Extension | undefined {
  return list?.find((e) => e.url === EXT + name);
}

/**
 * `Bundle.entry[0].resource/*Composition/ad82…*\/.subject` becomes
 * `Bundle.entry[0].resource.subject`. The annotation says which resource an
 * entry holds, which the path already implies.
 */
export function cleanPath(expression: string): string {
  return expression.replace(/\/\*.*?\*\//g, "");
}

export function toResult(outcome: OperationOutcome): ValidationResult {
  const issues = (outcome.issue ?? []).map((i): ValidationIssue => {
    const expression = i.expression?.[0] ?? i.location?.[0];
    const messageId = ext(i.extension, "message-id")?.valueCode;
    const line = ext(i.extension, "issue-line")?.valueInteger;
    const column = ext(i.extension, "issue-col")?.valueInteger;
    return {
      severity: i.severity,
      code: i.code,
      message: i.details?.text ?? i.diagnostics ?? i.code,
      ...(expression === undefined ? {} : { path: cleanPath(expression) }),
      ...(messageId === undefined ? {} : { messageId }),
      ...(line === undefined ? {} : { line }),
      ...(column === undefined ? {} : { column }),
    };
  });
  return {
    valid: !issues.some((i) => i.severity === "fatal" || i.severity === "error"),
    issues,
  };
}

/**
 * Results keyed by the file name the validator reports. A single
 * OperationOutcome carries no file tag, so it is keyed by `single`.
 */
export function parseOutput(json: unknown, single: string): Map<string, ValidationResult> {
  const results = new Map<string, ValidationResult>();
  const r = json as { resourceType?: string; entry?: { resource?: OperationOutcome }[] };
  if (r.resourceType === "OperationOutcome") {
    results.set(single, toResult(json as OperationOutcome));
    return results;
  }
  if (r.resourceType !== "Bundle") {
    throw new Error(`expected an OperationOutcome or a Bundle, got ${String(r.resourceType)}`);
  }
  for (const entry of r.entry ?? []) {
    const outcome = entry.resource;
    if (outcome?.resourceType !== "OperationOutcome") continue;
    const file = ext(outcome.extension, "file")?.valueString;
    if (file === undefined) throw new Error("validator output entry has no file extension");
    results.set(file.replace(/^.*[\\/]/, ""), toResult(outcome));
  }
  return results;
}

/** A compact, human-readable rendering: `error Composition.subject: …`. */
export function formatIssue(issue: ValidationIssue): string {
  const where = issue.path ? ` ${issue.path}` : "";
  return `${issue.severity}${where}: ${issue.message}`;
}

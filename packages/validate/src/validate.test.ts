import { describe, expect, it } from "vitest";
import example from "./__fixtures__/prescription-bundle.json" with { type: "json" };
import { formatIssue, runnerFromEnv, type ValidationResult, validate } from "./index.ts";

/**
 * Runs the real HL7 validator, so it needs one: set NUSKHA_VALIDATOR_IMAGE to
 * an image built from docker/Dockerfile, or NUSKHA_VALIDATOR_JAR to a local
 * validator_cli.jar. Without either, these tests are skipped, and CI sets one.
 *
 * The known-good input is the IG's own Bundle-Prescription-example-06 (CC0).
 */
const runner = runnerFromEnv();

// biome-ignore lint/suspicious/noExplicitAny: the test deliberately breaks the bundle
const broken = structuredClone(example) as any;
const composition = broken.entry[0].resource;
delete composition.subject;
composition.type.coding[0].code = "371530004";

describe.skipIf(!runner)("validate, against the real validator", () => {
  let results: ValidationResult[] = [];
  const errors = (r: ValidationResult | undefined) =>
    (r?.issues ?? []).filter((i) => i.severity === "error" || i.severity === "fatal");

  // One JVM start for both inputs: loading the IG is most of the cost.
  it("validates a batch and returns results in input order", { timeout: 900_000 }, async () => {
    if (!runner) return;
    results = await validate([example, broken], { runner });
    expect(results).toHaveLength(2);
  });

  it("passes the IG's own prescription example", () => {
    expect(errors(results[0]).map(formatIssue)).toEqual([]);
    expect(results[0]?.valid).toBe(true);
  });

  it("fails a broken bundle with errors a person can read", () => {
    expect(results[1]?.valid).toBe(false);
    expect(errors(results[1]).map(formatIssue)).toEqual([
      expect.stringContaining("Composition.subject: minimum required = 1, but only found 0"),
      expect.stringContaining("Value is '371530004' but is fixed to '440545006'"),
    ]);
  });
});

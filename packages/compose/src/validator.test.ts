import { formatIssue, runnerFromEnv, type ValidationResult, validate } from "@nuskha/validate";
import { describe, expect, it } from "vitest";
import { fixtures } from "./fixtures.ts";
import { composePrescription } from "./index.ts";

/**
 * 0.5's definition of done: every hand-written fixture composes to a bundle
 * the HL7 validator accepts against the pinned IG. Needs a validator, like
 * @nuskha/validate's own integration tests; CI provides one.
 */
const runner = runnerFromEnv();

describe.skipIf(!runner)("composed bundles, against the HL7 validator", () => {
  let results: ValidationResult[] = [];

  it("validates all twenty in one run", { timeout: 900_000 }, async () => {
    if (!runner) return;
    const bundles = fixtures.map((f) => composePrescription(f.ir, f.options).bundle);
    results = await validate(bundles, { runner });
    expect(results).toHaveLength(fixtures.length);
  });

  for (const [i, { name }] of fixtures.entries()) {
    it(`${name} has no errors`, () => {
      const errors = (results[i]?.issues ?? []).filter(
        (x) => x.severity === "error" || x.severity === "fatal",
      );
      expect(errors.map(formatIssue)).toEqual([]);
      expect(results[i]?.valid).toBe(true);
    });
  }
});

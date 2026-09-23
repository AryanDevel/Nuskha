import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import output from "./__fixtures__/validator-6.10.4-output.json" with { type: "json" };
import { cleanPath, formatIssue, parseOutput } from "./outcome.ts";
import { VALIDATOR } from "./pins.ts";

/**
 * The fixture is real output from validator 6.10.4 for two inputs: the IG's
 * Bundle-Prescription-example-06 as published, and a copy with the
 * Composition's subject removed and its type code changed.
 */
const results = parseOutput(output, "unused");
const good = results.get("good.json");
const bad = results.get("bad.json");

describe("parseOutput", () => {
  it("keys each OperationOutcome by the file it describes", () => {
    expect([...results.keys()]).toEqual(["good.json", "bad.json"]);
  });

  it("treats warnings and information as valid", () => {
    expect(good?.valid).toBe(true);
    expect(good?.issues.length).toBeGreaterThan(0);
    expect(good?.issues.every((i) => i.severity !== "error")).toBe(true);
  });

  it("reports each introduced fault as a readable error at the right place", () => {
    expect(bad?.valid).toBe(false);
    const errors = bad?.issues.filter((i) => i.severity === "error").map(formatIssue);
    expect(errors).toEqual([
      expect.stringMatching(
        /^error Bundle\.entry\[0\]\.resource: Composition\.subject: minimum required = 1, but only found 0/,
      ),
      expect.stringMatching(
        /^error Bundle\.entry\[0\]\.resource\.type\.coding\[0\]\.code: Value is '371530004' but is fixed to '440545006'/,
      ),
    ]);
  });

  it("keeps the validator's message id and source position", () => {
    const minimum = bad?.issues.find((i) => i.messageId === "Validation_VAL_Profile_Minimum");
    expect(minimum).toMatchObject({ code: "structure", line: 27, column: 8 });
  });

  it("keys a single OperationOutcome by the name it is given", () => {
    const single = { resourceType: "OperationOutcome", issue: [] };
    expect(parseOutput(single, "resource-0.json").get("resource-0.json")).toEqual({
      valid: true,
      issues: [],
    });
  });

  it("refuses output that is neither shape", () => {
    expect(() => parseOutput({ resourceType: "Patient" }, "x")).toThrow(/OperationOutcome/);
  });
});

describe("cleanPath", () => {
  it("drops the validator's inline resource annotations", () => {
    expect(cleanPath("Bundle.entry[0].resource/*Composition/ad82*/.language")).toBe(
      "Bundle.entry[0].resource.language",
    );
  });
});

describe("the Docker image", () => {
  it("pins the same validator release as the harness", async () => {
    const dockerfile = await readFile(new URL("../docker/Dockerfile", import.meta.url), "utf8");
    expect(dockerfile).toContain(`ARG VALIDATOR_VERSION=${VALIDATOR.version}\n`);
    expect(dockerfile).toContain(`ARG VALIDATOR_SHA256=${VALIDATOR.sha256}\n`);
  });
});

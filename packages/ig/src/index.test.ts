import { describe, expect, it } from "vitest";
import { igPackageId } from "./index.js";

describe("igPackageId", () => {
  // This passing is also the proof that the workspace link from @nuskha/ig to
  // @nuskha/core resolves, which is the thing unit 0.1 actually has to show.
  it("formats the coordinate the HL7 tooling expects", () => {
    expect(igPackageId()).toBe("ndhm.in#7.0.0");
  });
});

import { readFile } from "node:fs/promises";
import { runnerFromEnv } from "@nuskha/validate";
import { describe, expect, it } from "vitest";
import { type Io, run } from "./cli.ts";

/**
 * The CLI through run(), with files and clock supplied in memory. What these
 * cannot show is that the published package installs and runs; the global
 * install check in CI covers that.
 */

const fixtures = new URL(
  "../../../packages/compose/src/__fixtures__/prescriptions/",
  import.meta.url,
);
const minimal = await readFile(new URL("01-minimal.ir.json", fixtures), "utf8");
const opd = await readFile(new URL("02-opd-three-medicines.ir.json", fixtures), "utf8");

function harness(files: Record<string, string> = {}, env: NodeJS.ProcessEnv = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const written: Record<string, string> = {};
  const io: Io = {
    stdout: (t) => out.push(t),
    stderr: (t) => err.push(t),
    readFile: async (p) => {
      const text = files[p] ?? written[p];
      if (text === undefined) throw Object.assign(new Error("no such file"), { code: "ENOENT" });
      return text;
    },
    writeFile: async (p, t) => {
      written[p] = t;
    },
    now: () => new Date("2026-09-24T06:30:00Z"),
    env,
    version: "0.0.0-test",
  };
  return {
    io,
    written,
    stdout: () => out.join(""),
    stderr: () => err.join(""),
    run: (...argv: string[]) => run(argv, io),
  };
}

describe("nuskha compile", () => {
  it("writes a document bundle to standard output", async () => {
    const h = harness({ "rx.json": minimal });
    expect(await h.run("compile", "rx.json")).toBe(0);
    const bundle = JSON.parse(h.stdout());
    expect(bundle).toMatchObject({ resourceType: "Bundle", type: "document" });
    expect(bundle.timestamp).toBe("2026-09-24T06:30:00.000Z");
  });

  it("derives the document id from the IR, so recompiling gives the same bundle", async () => {
    const a = harness({ "rx.json": minimal });
    const b = harness({ "rx.json": minimal });
    await a.run("compile", "rx.json", "--timestamp", "2026-09-21T12:00:00+05:30");
    await b.run("compile", "rx.json", "--timestamp", "2026-09-21T12:00:00+05:30");
    expect(a.stdout()).toBe(b.stdout());
    expect(JSON.parse(a.stdout()).identifier.system).toBe("urn:ietf:rfc:3986");
  });

  it("uses the document identifier it is given", async () => {
    const h = harness({ "rx.json": minimal });
    await h.run(
      "compile",
      "rx.json",
      "--document-system",
      "https://hip.example.in/documents",
      "--document-id",
      "RX-1",
    );
    expect(JSON.parse(h.stdout()).identifier).toEqual({
      system: "https://hip.example.in/documents",
      value: "RX-1",
    });
  });

  it("writes to a file with --out and says what it left out", async () => {
    const h = harness({ "rx.json": opd });
    expect(await h.run("compile", "rx.json", "-o", "bundle.json")).toBe(0);
    expect(h.stdout()).toBe("");
    expect(JSON.parse(h.written["bundle.json"] ?? "{}").type).toBe("document");
    expect(h.stderr()).toContain("note: patient.age is not in the bundle");
  });

  it("reports an invalid IR with the IR's own messages and exits 1", async () => {
    const ir = JSON.parse(minimal);
    ir.medications = [];
    const h = harness({ "rx.json": JSON.stringify(ir) });
    expect(await h.run("compile", "rx.json")).toBe(1);
    expect(h.stderr()).toContain("medications: a prescription prescribes something");
  });

  it("refuses an HI type it cannot compile yet", async () => {
    const h = harness({ "dr.json": JSON.stringify({ hiType: "DiagnosticReport" }) });
    expect(await h.run("compile", "dr.json")).toBe(1);
    expect(h.stderr()).toContain('this version compiles only "Prescription"');
  });

  it("reports a missing file and a malformed one plainly", async () => {
    const h = harness({ "bad.json": "{" });
    expect(await h.run("compile", "missing.json")).toBe(1);
    expect(await h.run("compile", "bad.json")).toBe(1);
    expect(h.stderr()).toContain("cannot read missing.json: ENOENT");
    expect(h.stderr()).toContain("bad.json is not valid JSON");
  });
});

describe("nuskha validate --schema-only", () => {
  async function compiled() {
    const h = harness({ "rx.json": minimal });
    await h.run("compile", "rx.json", "-o", "bundle.json");
    return h.written["bundle.json"] as string;
  }

  it("passes a compiled bundle, and says what it did not check", async () => {
    const h = harness({ "bundle.json": await compiled() });
    expect(await h.run("validate", "--schema-only", "bundle.json")).toBe(0);
    expect(h.stdout()).toMatch(/^valid {3}bundle\.json: 0 error\(s\)/);
    expect(h.stderr()).toContain("invariants and terminology bindings were not checked");
  });

  it("fails a broken bundle and exits 1", async () => {
    const bundle = JSON.parse(await compiled());
    delete bundle.entry[0].resource.subject;
    const h = harness({ "bundle.json": JSON.stringify(bundle) });
    expect(await h.run("validate", "--schema-only", "bundle.json")).toBe(1);
    expect(h.stdout()).toContain("INVALID bundle.json");
    expect(h.stdout()).toContain("Bundle.entry[0].resource.subject");
  });

  it("prints JSON with --json", async () => {
    const h = harness({ "bundle.json": await compiled() });
    await h.run("validate", "--schema-only", "--json", "bundle.json");
    expect(JSON.parse(h.stdout())).toEqual([{ file: "bundle.json", valid: true, issues: [] }]);
  });
});

describe("usage", () => {
  it("prints help, and the version", async () => {
    const h = harness();
    expect(await h.run("--help")).toBe(0);
    expect(await h.run("--version")).toBe(0);
    expect(h.stdout()).toContain("Usage: nuskha <command>");
    expect(h.stdout()).toContain("0.0.0-test");
  });

  it("exits 2 on an unknown command or option", async () => {
    const h = harness();
    expect(await h.run("frobnicate")).toBe(2);
    expect(await h.run("compile", "--nope", "x.json")).toBe(2);
    expect(await h.run("compile")).toBe(2);
  });

  it("reports a validator that fails to run, instead of crashing", async () => {
    // Regression: a failed run used to escape as an uncaught ValidatorError
    // with a stack trace. Node standing in for java rejects `-jar`, so the
    // run ends without writing a result, the same as a missing jar.
    const h = harness({ "b.json": "{}" });
    const code = await h.run(
      "validate",
      "b.json",
      "--jar",
      "missing.jar",
      "--java",
      process.execPath,
    );
    expect(code).toBe(1);
    expect(h.stderr()).toContain("without writing a result. Its last output:");
    expect(h.stderr()).toContain("-jar");
    expect(h.stderr()).not.toMatch(/\n\s+at /);
  });

  it("explains how to get a validator when there is none", async () => {
    const h = harness({ "b.json": "{}" }, { XDG_CACHE_HOME: "/nonexistent-nuskha-cache" });
    expect(await h.run("validate", "b.json", "--java", "no-such-java-binary")).toBe(2);
    expect(h.stderr()).toContain("nuskha fetch-validator");
    expect(h.stderr()).toContain("--schema-only");
  });
});

const runner = runnerFromEnv();

describe.skipIf(!runner)("nuskha validate, against the HL7 validator", () => {
  it("passes a compiled bundle and fails a broken one", { timeout: 900_000 }, async () => {
    const c = harness({ "rx.json": opd });
    await c.run("compile", "rx.json", "-o", "good.json");
    const broken = JSON.parse(c.written["good.json"] as string);
    delete broken.entry[0].resource.subject;
    const h = harness(
      { "good.json": c.written["good.json"] as string, "broken.json": JSON.stringify(broken) },
      process.env,
    );
    expect(await h.run("validate", "good.json", "broken.json")).toBe(1);
    expect(h.stdout()).toMatch(/^valid {3}good\.json: 0 error\(s\)/m);
    expect(h.stdout()).toMatch(/^INVALID broken\.json: 1 error\(s\)/m);
    expect(h.stdout()).toContain("Composition.subject: minimum required = 1, but only found 0");
  });
});

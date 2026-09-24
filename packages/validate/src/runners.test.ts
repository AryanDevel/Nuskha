import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { javaRunner, runnerFromEnv } from "./runners.ts";

/**
 * Regression tests for a relative jar path. The validator runs inside a
 * scratch working directory, so a jar path relative to the caller's
 * directory used to point at nothing, and the run failed with "Unable to
 * access jarfile". Every earlier test had passed absolute paths.
 */

describe("javaRunner", () => {
  it("resolves a relative jar path against the caller's directory", () => {
    const runner = javaRunner({ jar: join("some", "dir", "validator_cli.jar") });
    expect(runner.name).toBe(`java (${resolve("some", "dir", "validator_cli.jar")})`);
  });

  it("leaves an absolute jar path alone", () => {
    const jar = resolve("validator_cli.jar");
    expect(javaRunner({ jar }).name).toBe(`java (${jar})`);
  });

  it("runs from the scratch directory but still finds a relatively named program", async () => {
    // A stand-in for java: node, given a relative path to itself. It is run
    // with a different working directory, which is exactly what broke. If the
    // path were not resolved first, the spawn would fail with ENOENT.
    const workdir = await mkdtemp(join(tmpdir(), "nuskha-runner-"));
    try {
      const java = relative(process.cwd(), process.execPath);
      const runner = javaRunner({ jar: "unused.jar", java });
      const run = await runner.run(["--version"], workdir);
      // node rejects `-jar`, but it started, which is what this is checking.
      expect(run.exitCode).not.toBeNull();
      expect(`${run.stdout}${run.stderr}`).toMatch(/-jar/);
    } finally {
      await rm(workdir, { recursive: true, force: true });
    }
  });
});

const env = runnerFromEnv();

describe.skipIf(!process.env.NUSKHA_VALIDATOR_JAR)("javaRunner, with the real validator", () => {
  it("validates through a jar path given relative to the caller", {
    timeout: 900_000,
  }, async () => {
    if (!env) return;
    const { validate } = await import("./index.ts");
    const jar = relative(process.cwd(), process.env.NUSKHA_VALIDATOR_JAR as string);
    expect(isAbsolute(jar)).toBe(false);
    const bundle = JSON.parse(
      await readFile(new URL("./__fixtures__/prescription-bundle.json", import.meta.url), "utf8"),
    );
    const runner = javaRunner({
      jar,
      ...(process.env.NUSKHA_JAVA ? { java: process.env.NUSKHA_JAVA } : {}),
    });
    const [result] = await validate([bundle], { runner });
    expect(result?.valid).toBe(true);
  });
});

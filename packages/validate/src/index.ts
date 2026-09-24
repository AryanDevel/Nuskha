import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { IG_PACKAGE } from "@nuskha/core";
import { parseOutput, type ValidationResult } from "./outcome.ts";
import { FHIR_VERSION } from "./pins.ts";
import type { Runner } from "./runners.ts";

export {
  cachedValidator,
  defaultCacheDir,
  fetchValidator,
  validatorJarPath,
} from "./fetch.ts";
export {
  cleanPath,
  formatIssue,
  parseOutput,
  type Severity,
  type ValidationIssue,
  type ValidationResult,
} from "./outcome.ts";
export { FHIR_VERSION, VALIDATOR } from "./pins.ts";
export {
  type DockerRunnerOptions,
  dockerRunner,
  type JavaRunnerOptions,
  javaRunner,
  type Runner,
  type RunOutput,
  runnerFromEnv,
} from "./runners.ts";

export interface ValidateOptions {
  readonly runner: Runner;
  /** The IG to validate against. Defaults to the one `@nuskha/core` pins. */
  readonly ig?: string;
  /**
   * A terminology server URL, or `null` to validate offline (the default).
   *
   * Offline, the validator still checks codes against value sets it can
   * expand from the loaded packages, such as `composition-status`, but it
   * reports SNOMED CT, LOINC and UCUM codes as unvalidated rather than
   * failing them. Offline is the default because a validator whose answer
   * depends on a public server being up is not a reproducible oracle.
   */
  readonly terminologyServer?: string | null;
  readonly signal?: AbortSignal;
}

/** The validator failed to produce a result, as opposed to finding faults. */
export class ValidatorError extends Error {
  readonly output: string;
  constructor(message: string, output: string) {
    super(message);
    this.name = "ValidatorError";
    this.output = output;
  }
}

/**
 * Validate FHIR resources (typically ABDM document bundles) with the HL7
 * validator. Everything is validated in one JVM start, which is where most of
 * the time goes, and results come back in input order.
 *
 * The validator's exit code is ignored: it exits 0 when it finds errors. The
 * result is read from its `-output` file, and a missing file is an error.
 */
export async function validate(
  resources: readonly unknown[],
  options: ValidateOptions,
): Promise<ValidationResult[]> {
  if (resources.length === 0) return [];
  const workdir = await mkdtemp(join(tmpdir(), "nuskha-validate-"));
  try {
    const files = resources.map((_, i) => `resource-${i}.json`);
    await Promise.all(
      resources.map((r, i) => writeFile(join(workdir, files[i] as string), JSON.stringify(r))),
    );

    const args = [
      ...files,
      "-version",
      FHIR_VERSION,
      "-ig",
      options.ig ?? `${IG_PACKAGE.id}#${IG_PACKAGE.version}`,
      "-tx",
      options.terminologyServer ?? "n/a",
      "-output",
      "outcome.json",
    ];
    const run = await options.runner.run(args, workdir, options.signal);

    const raw = await readFile(join(workdir, "outcome.json"), "utf8").catch(() => undefined);
    if (raw === undefined) {
      const tail = `${run.stdout}\n${run.stderr}`.trim().split("\n").slice(-30).join("\n");
      throw new ValidatorError(
        `the validator (${options.runner.name}) exited ${run.exitCode} without writing a result`,
        tail,
      );
    }

    const byFile = parseOutput(JSON.parse(raw), files[0] as string);
    return files.map((f) => {
      const result = byFile.get(f);
      if (!result) throw new ValidatorError(`the validator returned no result for ${f}`, raw);
      return result;
    });
  } finally {
    await rm(workdir, { recursive: true, force: true });
  }
}

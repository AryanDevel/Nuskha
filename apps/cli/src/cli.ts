import { spawnSync } from "node:child_process";
import { type ParseArgsOptionsConfig, parseArgs } from "node:util";
import { ComposeError, composePrescription, NUSKHA_NAMESPACE, uuidV5 } from "@nuskha/compose";
import { IG_PACKAGE, type PrescriptionIR } from "@nuskha/core";
import { PROFILES_BY_URL } from "@nuskha/ig";
import {
  cachedValidator,
  dockerRunner,
  fetchValidator,
  formatIssue,
  javaRunner,
  type Runner,
  runnerFromEnv,
  type ValidationResult,
  ValidatorError,
  validate,
} from "@nuskha/validate";

/** Everything the CLI touches outside itself, so tests can supply it. */
export interface Io {
  readonly stdout: (text: string) => void;
  readonly stderr: (text: string) => void;
  readonly readFile: (path: string) => Promise<string>;
  readonly writeFile: (path: string, text: string) => Promise<void>;
  readonly now: () => Date;
  readonly env: NodeJS.ProcessEnv;
  readonly version: string;
}

/** 0 success, 1 the input is invalid or failed validation, 2 the command was used wrongly. */
export type ExitCode = 0 | 1 | 2;

class UsageError extends Error {}

const HELP = `Usage: nuskha <command> [options]

Commands:
  compile <ir.json>              Compile a prescription IR into an ABDM document bundle
  validate <bundle.json>...      Validate bundles with the HL7 validator
  fetch-validator                Download the pinned HL7 validator (about 200 MB)

compile options:
  -o, --out <file>               Write the bundle here instead of standard output
  --document-system <uri>        Bundle.identifier.system (default urn:ietf:rfc:3986)
  --document-id <value>          Bundle.identifier.value (default: a UUID derived
                                 from the IR, so the same IR gets the same id)
  --timestamp <instant>          Bundle.timestamp (default: now)

validate options:
  --schema-only                  Check against the generated IG schemas only. Fast,
                                 no Java, but not the full picture: FHIRPath
                                 invariants and terminology are left unchecked
  --jar <file>                   validator_cli.jar to run with a local JVM
  --java <file>                  The java executable (default: java on PATH)
  --image <name>                 Run the validator in this Docker image instead
  --tx <url>                     Terminology server (default: none, offline)
  --warnings                     List warnings as well as errors
  --json                         Print the results as JSON

Validates against ${IG_PACKAGE.id}#${IG_PACKAGE.version}.
`;

export async function run(argv: readonly string[], io: Io): Promise<ExitCode> {
  const [command, ...rest] = argv;
  try {
    switch (command) {
      case "compile":
        return await compile(rest, io);
      case "validate":
        return await validateCommand(rest, io);
      case "fetch-validator":
        return await fetchCommand(rest, io);
      case "--version":
      case "-v":
        io.stdout(`${io.version}\n`);
        return 0;
      case undefined:
      case "--help":
      case "-h":
      case "help":
        io.stdout(HELP);
        return 0;
      default:
        throw new UsageError(`unknown command "${command}"`);
    }
  } catch (error) {
    if (error instanceof UsageError) {
      io.stderr(`nuskha: ${error.message}\nRun "nuskha --help" for usage.\n`);
      return 2;
    }
    if (error instanceof InputError) {
      io.stderr(`nuskha: ${error.message}\n`);
      return 1;
    }
    if (error instanceof ValidatorError) {
      io.stderr(`nuskha: ${error.message}. Its last output:\n${error.output}\n`);
      return 1;
    }
    throw error;
  }
}

/** The input file is missing, unreadable, or not what the command needs. */
class InputError extends Error {}

function parse<T extends ParseArgsOptionsConfig>(args: readonly string[], options: T) {
  try {
    return parseArgs({ args: [...args], options, allowPositionals: true, strict: true });
  } catch (error) {
    throw new UsageError((error as Error).message);
  }
}

async function readJson(path: string, io: Io): Promise<unknown> {
  let text: string;
  try {
    text = await io.readFile(path);
  } catch (error) {
    throw new InputError(`cannot read ${path}: ${(error as NodeJS.ErrnoException).code ?? error}`);
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new InputError(`${path} is not valid JSON: ${(error as Error).message}`);
  }
}

// ---- compile ----------------------------------------------------------------

async function compile(args: readonly string[], io: Io): Promise<ExitCode> {
  const { values, positionals } = parse(args, {
    out: { type: "string", short: "o" },
    "document-system": { type: "string" },
    "document-id": { type: "string" },
    timestamp: { type: "string" },
  });
  if (positionals.length !== 1) throw new UsageError("compile takes exactly one IR file");
  const file = positionals[0] as string;
  const ir = await readJson(file, io);

  const hiType = (ir as { hiType?: unknown })?.hiType;
  if (hiType !== "Prescription") {
    throw new InputError(
      `${file}: hiType is ${JSON.stringify(hiType)}; this version compiles only "Prescription"`,
    );
  }

  const options = {
    identifier: {
      system: values["document-system"] ?? "urn:ietf:rfc:3986",
      value: values["document-id"] ?? `urn:uuid:${uuidV5(NUSKHA_NAMESPACE, JSON.stringify(ir))}`,
    },
    timestamp: values.timestamp ?? io.now().toISOString(),
  };

  let result: ReturnType<typeof composePrescription>;
  try {
    result = composePrescription(ir as PrescriptionIR, options);
  } catch (error) {
    if (error instanceof ComposeError) throw new InputError(`${file}: ${error.message}`);
    throw error;
  }

  for (const o of result.omitted) io.stderr(`note: ${o.path} is not in the bundle: ${o.reason}\n`);
  const json = `${JSON.stringify(result.bundle, null, 2)}\n`;
  if (values.out) {
    await io.writeFile(values.out, json);
    io.stderr(`wrote ${values.out}\n`);
  } else {
    io.stdout(json);
  }
  return 0;
}

// ---- validate -----------------------------------------------------------------

function javaOnPath(java: string): boolean {
  return spawnSync(java, ["-version"], { stdio: "ignore" }).status === 0;
}

async function chooseRunner(values: { jar?: string; java?: string; image?: string }, io: Io) {
  if (values.image) return dockerRunner({ image: values.image });
  if (values.jar)
    return javaRunner({ jar: values.jar, ...(values.java ? { java: values.java } : {}) });
  const fromEnv = runnerFromEnv(io.env);
  if (fromEnv) return fromEnv;
  const cached = await cachedValidator();
  const java = values.java ?? io.env.NUSKHA_JAVA ?? "java";
  if (cached && javaOnPath(java)) return javaRunner({ jar: cached, java });
  throw new UsageError(
    [
      "no HL7 validator to run. Either:",
      "  nuskha fetch-validator            download it (needs Java 17 or later to run), or",
      "  nuskha validate --image <name>    use a Docker image built from packages/validate/docker, or",
      "  nuskha validate --schema-only     check the generated schemas only",
      ...(cached ? [`(the validator is cached at ${cached}, but "${java}" did not run)`] : []),
    ].join("\n"),
  );
}

function schemaCheck(bundle: unknown): ValidationResult {
  const issues: { severity: "error"; code: string; message: string; path: string }[] = [];
  const check = (resource: unknown, where: string) => {
    const profiles = (resource as { meta?: { profile?: string[] } })?.meta?.profile ?? [];
    if (profiles.length === 0) {
      issues.push({
        severity: "error",
        code: "structure",
        message: "declares no profile",
        path: where,
      });
    }
    for (const url of profiles) {
      const entry = PROFILES_BY_URL.get(url.split("|")[0] as string);
      if (!entry) {
        issues.push({
          severity: "error",
          code: "not-supported",
          message: `${url} is not a profile in ${IG_PACKAGE.id}#${IG_PACKAGE.version}`,
          path: where,
        });
        continue;
      }
      for (const i of entry.schema.safeParse(resource).error?.issues ?? []) {
        issues.push({
          severity: "error",
          code: "structure",
          message: i.message,
          path: [where, ...i.path.map(String)].join("."),
        });
      }
    }
  };
  check(bundle, "Bundle");
  const entries = (bundle as { entry?: { resource?: unknown }[] })?.entry ?? [];
  entries.forEach((e, i) => {
    check(e.resource, `Bundle.entry[${i}].resource`);
  });
  return { valid: issues.length === 0, issues };
}

async function validateCommand(args: readonly string[], io: Io): Promise<ExitCode> {
  const { values, positionals } = parse(args, {
    "schema-only": { type: "boolean" },
    jar: { type: "string" },
    java: { type: "string" },
    image: { type: "string" },
    tx: { type: "string" },
    warnings: { type: "boolean" },
    json: { type: "boolean" },
  });
  if (positionals.length === 0) throw new UsageError("validate takes at least one bundle file");
  const bundles = await Promise.all(positionals.map((p) => readJson(p, io)));

  let results: ValidationResult[];
  if (values["schema-only"]) {
    results = bundles.map(schemaCheck);
  } else {
    const runner: Runner = await chooseRunner(values, io);
    io.stderr(
      `validating ${bundles.length} file(s) against ${IG_PACKAGE.id}#${IG_PACKAGE.version} with ${runner.name}\n`,
    );
    results = await validate(bundles, { runner, terminologyServer: values.tx ?? null });
  }

  if (values.json) {
    io.stdout(
      `${JSON.stringify(
        positionals.map((file, i) => ({ file, ...results[i] })),
        null,
        2,
      )}\n`,
    );
  } else {
    positionals.forEach((file, i) => {
      const r = results[i] as ValidationResult;
      const errors = r.issues.filter((x) => x.severity === "error" || x.severity === "fatal");
      const warnings = r.issues.filter((x) => x.severity === "warning");
      io.stdout(
        `${r.valid ? "valid  " : "INVALID"} ${file}: ${errors.length} error(s), ${warnings.length} warning(s)\n`,
      );
      for (const x of values.warnings ? [...errors, ...warnings] : errors)
        io.stdout(`  ${formatIssue(x)}\n`);
    });
    if (values["schema-only"]) {
      io.stderr("schema-only: FHIRPath invariants and terminology bindings were not checked\n");
    }
  }
  return results.every((r) => r.valid) ? 0 : 1;
}

// ---- fetch-validator ---------------------------------------------------------------

async function fetchCommand(args: readonly string[], io: Io): Promise<ExitCode> {
  parse(args, {});
  const file = await fetchValidator({ onProgress: (m) => io.stderr(`${m}\n`) });
  io.stdout(`${file}\n`);
  return 0;
}

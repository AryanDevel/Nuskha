import { spawn } from "node:child_process";

/**
 * How the validator is started. Both runners pass it the same arguments and
 * run it in a working directory holding the inputs, so the rest of the
 * harness does not care which one is in use.
 */
export interface Runner {
  readonly name: string;
  run(args: readonly string[], workdir: string, signal?: AbortSignal): Promise<RunOutput>;
}

export interface RunOutput {
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

function exec(
  command: string,
  args: readonly string[],
  cwd: string,
  signal: AbortSignal | undefined,
): Promise<RunOutput> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      ...(signal ? { signal } : {}),
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (d: string) => {
      stdout += d;
    });
    child.stderr.setEncoding("utf8").on("data", (d: string) => {
      stderr += d;
    });
    child.on("error", reject);
    child.on("close", (exitCode) => resolve({ exitCode, stdout, stderr }));
  });
}

export interface JavaRunnerOptions {
  /** Path to `validator_cli.jar`. `pnpm --filter @nuskha/validate fetch-validator` downloads the pinned one. */
  readonly jar: string;
  /** The `java` executable. Defaults to the one on PATH. */
  readonly java?: string;
}

/** Runs the validator with a local JVM. */
export function javaRunner(options: JavaRunnerOptions): Runner {
  return {
    name: `java (${options.jar})`,
    run: (args, workdir, signal) =>
      exec(options.java ?? "java", ["-jar", options.jar, ...args], workdir, signal),
  };
}

export interface DockerRunnerOptions {
  /** An image built from `packages/validate/docker/Dockerfile`. */
  readonly image: string;
  readonly docker?: string;
}

/**
 * Runs the validator in the image from `docker/Dockerfile`, which carries the
 * pinned jar and a package cache warmed at build time, so a container validates
 * against the packages present when the image was built.
 */
export function dockerRunner(options: DockerRunnerOptions): Runner {
  return {
    name: `docker (${options.image})`,
    run: (args, workdir, signal) =>
      exec(
        options.docker ?? "docker",
        ["run", "--rm", "-v", `${workdir}:/work`, "-w", "/work", options.image, ...args],
        workdir,
        signal,
      ),
  };
}

/**
 * A runner configured by environment, or undefined when none is:
 * `NUSKHA_VALIDATOR_IMAGE` selects Docker, otherwise `NUSKHA_VALIDATOR_JAR`
 * (with an optional `NUSKHA_JAVA`) selects a local JVM.
 */
export function runnerFromEnv(env: NodeJS.ProcessEnv = process.env): Runner | undefined {
  if (env.NUSKHA_VALIDATOR_IMAGE) return dockerRunner({ image: env.NUSKHA_VALIDATOR_IMAGE });
  if (env.NUSKHA_VALIDATOR_JAR) {
    return javaRunner({
      jar: env.NUSKHA_VALIDATOR_JAR,
      ...(env.NUSKHA_JAVA ? { java: env.NUSKHA_JAVA } : {}),
    });
  }
  return undefined;
}

import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { VALIDATOR } from "./pins.ts";

/**
 * Where the pinned validator jar is kept when nobody says otherwise:
 * `$XDG_CACHE_HOME/nuskha`, or `~/.cache/nuskha`.
 */
export function defaultCacheDir(env: NodeJS.ProcessEnv = process.env): string {
  return join(env.XDG_CACHE_HOME || join(homedir(), ".cache"), "nuskha");
}

export function validatorJarPath(cacheDir = defaultCacheDir()): string {
  return join(cacheDir, `validator_cli-${VALIDATOR.version}.jar`);
}

const sha256 = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

/** The cached jar's path, if it is there and matches the pin. */
export async function cachedValidator(cacheDir = defaultCacheDir()): Promise<string | undefined> {
  const file = validatorJarPath(cacheDir);
  const bytes = await readFile(file).catch(() => undefined);
  return bytes && sha256(bytes) === VALIDATOR.sha256 ? file : undefined;
}

/**
 * Download the pinned `validator_cli.jar` (about 200 MB) unless a verified
 * copy is already cached, and return its path. Refuses a download whose
 * checksum does not match the pin.
 */
export async function fetchValidator(
  options: { cacheDir?: string; onProgress?: (message: string) => void } = {},
): Promise<string> {
  const cacheDir = options.cacheDir ?? defaultCacheDir();
  const cached = await cachedValidator(cacheDir);
  if (cached) return cached;

  options.onProgress?.(`downloading HL7 validator ${VALIDATOR.version} (about 200 MB)`);
  const response = await fetch(VALIDATOR.url);
  if (!response.ok) throw new Error(`${VALIDATOR.url} answered ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const actual = sha256(bytes);
  if (actual !== VALIDATOR.sha256) {
    throw new Error(
      `validator ${VALIDATOR.version} does not match its pinned checksum\n  expected ${VALIDATOR.sha256}\n  received ${actual}`,
    );
  }
  const file = validatorJarPath(cacheDir);
  await mkdir(cacheDir, { recursive: true });
  await writeFile(`${file}.part`, bytes);
  await rename(`${file}.part`, file);
  return file;
}

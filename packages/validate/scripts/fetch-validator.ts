/**
 * Download the pinned `validator_cli.jar` into `.cache/`, verify its checksum,
 * and print its path. For running the validator with a local JVM:
 *
 *   NUSKHA_VALIDATOR_JAR=$(node scripts/fetch-validator.ts) pnpm test
 *
 * The Docker image fetches and verifies the same jar itself.
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { VALIDATOR } from "../src/pins.ts";

const cacheDir = join(dirname(fileURLToPath(import.meta.url)), "..", ".cache");
const file = join(cacheDir, `validator_cli-${VALIDATOR.version}.jar`);
const sha256 = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

const cached = await readFile(file).catch(() => undefined);
if (!cached || sha256(cached) !== VALIDATOR.sha256) {
  process.stderr.write(`fetching validator ${VALIDATOR.version} (about 200 MB)\n`);
  const response = await fetch(VALIDATOR.url);
  if (!response.ok) throw new Error(`${VALIDATOR.url} answered ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const actual = sha256(bytes);
  if (actual !== VALIDATOR.sha256) {
    throw new Error(
      `validator ${VALIDATOR.version} does not match its pinned checksum\n  expected ${VALIDATOR.sha256}\n  received ${actual}`,
    );
  }
  await mkdir(cacheDir, { recursive: true });
  await writeFile(`${file}.part`, bytes);
  await rename(`${file}.part`, file);
}
process.stdout.write(`${file}\n`);

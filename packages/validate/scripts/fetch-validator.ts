/**
 * Download the pinned `validator_cli.jar` into this package's `.cache/`,
 * verify its checksum, and print its path. For running the validator with a
 * local JVM:
 *
 *   NUSKHA_VALIDATOR_JAR=$(node scripts/fetch-validator.ts) pnpm test
 *
 * `nuskha fetch-validator` does the same for an installed CLI, into the user
 * cache instead. The Docker image fetches and verifies the jar itself.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { fetchValidator } from "../src/fetch.ts";

const cacheDir = join(dirname(fileURLToPath(import.meta.url)), "..", ".cache");
const file = await fetchValidator({ cacheDir, onProgress: (m) => process.stderr.write(`${m}\n`) });
process.stdout.write(`${file}\n`);

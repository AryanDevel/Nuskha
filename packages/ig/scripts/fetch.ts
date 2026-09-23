import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import type { PackageSource } from "./sources.ts";

/**
 * Download a FHIR package, or reuse the cached copy, and refuse to continue
 * unless its checksum matches the pin. Returns the package's JSON files keyed
 * by their path inside the tarball.
 */
export async function loadPackage(
  source: PackageSource,
  cacheDir: string,
): Promise<Map<string, unknown>> {
  const file = join(cacheDir, `${source.id}-${source.version}-${source.sha256.slice(0, 12)}.tgz`);
  let bytes: Buffer | undefined = await readFile(file).catch(() => undefined);

  if (!bytes || sha256(bytes) !== source.sha256) {
    process.stderr.write(`fetching ${source.id}#${source.version} from ${source.url}\n`);
    const fresh = await download(source.url);
    const actual = sha256(fresh);
    if (actual !== source.sha256) {
      throw new Error(
        [
          `${source.id}#${source.version} does not match its pinned checksum.`,
          `  expected ${source.sha256}`,
          `  received ${actual}`,
          "The publisher has changed the package. Regenerate against the new one on purpose:",
          "update the sha256 in scripts/sources.ts, run pnpm regen, and review the diff.",
        ].join("\n"),
      );
    }
    await mkdir(cacheDir, { recursive: true });
    await writeFile(`${file}.part`, fresh);
    await rename(`${file}.part`, file);
    bytes = fresh;
  }

  return readJsonEntries(gunzipSync(bytes));
}

/** The package servers drop large transfers now and then; three tries is enough. */
async function download(url: string, attempts = 3): Promise<Buffer> {
  for (let i = 1; ; i++) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(180_000) });
      if (!response.ok)
        throw new Error(`${url} answered ${response.status} ${response.statusText}`);
      return Buffer.from(await response.arrayBuffer());
    } catch (error) {
      if (i >= attempts) throw error;
      process.stderr.write(`  attempt ${i} failed (${String(error)}), retrying\n`);
    }
  }
}

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * A minimal ustar reader: regular files only, with PAX `path` overrides.
 * FHIR packages use nothing more, and it saves a dependency for 30 lines.
 */
function readJsonEntries(tar: Buffer): Map<string, unknown> {
  const files = new Map<string, unknown>();
  let offset = 0;
  let paxPath: string | undefined;

  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((b) => b === 0)) break;

    const field = (start: number, length: number) =>
      header
        .subarray(start, start + length)
        .toString("utf8")
        .replace(/\0.*$/s, "");
    const size = Number.parseInt(field(124, 12).trim() || "0", 8);
    const type = field(156, 1);
    const prefix = field(345, 155);
    const name = paxPath ?? (prefix ? `${prefix}/${field(0, 100)}` : field(0, 100));
    const body = tar.subarray(offset + 512, offset + 512 + size);
    offset += 512 + Math.ceil(size / 512) * 512;

    if (type === "x") {
      paxPath = /\d+ path=([^\n]+)\n/.exec(body.toString("utf8"))?.[1];
      continue;
    }
    paxPath = undefined;
    if ((type === "0" || type === "") && name.endsWith(".json")) {
      files.set(name.replace(/^\.\//, ""), JSON.parse(body.toString("utf8")));
    }
  }
  return files;
}

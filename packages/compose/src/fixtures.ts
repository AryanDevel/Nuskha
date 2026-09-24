import { readdirSync, readFileSync } from "node:fs";
import type { PrescriptionIR } from "@nuskha/core";
import type { ComposeOptions } from "./prescription.ts";
import { NUSKHA_NAMESPACE, uuidV5 } from "./uuid.ts";

/**
 * The hand-written prescription fixtures, with the options each is composed
 * under. Test-only: this module reads files and is excluded from the build.
 */

const dir = new URL("./__fixtures__/prescriptions/", import.meta.url);

export interface Fixture {
  readonly name: string;
  readonly ir: PrescriptionIR;
  readonly options: ComposeOptions;
}

export const fixtures: readonly Fixture[] = readdirSync(dir)
  .filter((f) => f.endsWith(".ir.json"))
  .sort()
  .map((file) => {
    const name = file.replace(/\.ir\.json$/, "");
    return {
      name,
      ir: JSON.parse(readFileSync(new URL(file, dir), "utf8")) as PrescriptionIR,
      options: {
        // A URI identifier, the FHIR convention when there is no issuing
        // system to name. The validator rejects example.org URLs outright.
        identifier: {
          system: "urn:ietf:rfc:3986",
          value: `urn:uuid:${uuidV5(NUSKHA_NAMESPACE, `fixture/${name}`)}`,
        },
        timestamp: "2026-09-21T12:00:00+05:30",
      },
    };
  });

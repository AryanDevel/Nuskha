import { IG_PACKAGE } from "@nuskha/core";

/**
 * Types, Zod schemas and a profile registry generated from the ABDM
 * implementation guide `@nuskha/core` pins. The 7.0.0 preview build is
 * available separately from `@nuskha/ig/preview`.
 */
export * from "./generated/ndhm-6.5.0/index.ts";
export * as datatypes from "./generated/r4/datatypes.ts";
export type { ProfileEntry, UncheckedConstraint } from "./registry-types.ts";

/**
 * The implementation guide's coordinate in the form the FHIR tooling expects:
 * `validator_cli.jar -ig ndhm.in#6.5.0`, the package registry, and SUSHI all
 * address it this way.
 */
export function igPackageId(): string {
  return `${IG_PACKAGE.id}#${IG_PACKAGE.version}`;
}

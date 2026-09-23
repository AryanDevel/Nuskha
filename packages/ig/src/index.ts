import { IG_PACKAGE } from "@nuskha/core";

/**
 * The implementation guide's coordinate in the form the FHIR tooling expects:
 * `validator_cli.jar -ig ndhm.in#7.0.0`, the package registry, and SUSHI all
 * address it this way.
 *
 * Everything else in this package is generated from that coordinate in unit 0.2.
 */
export function igPackageId(): string {
  return `${IG_PACKAGE.id}#${IG_PACKAGE.version}`;
}

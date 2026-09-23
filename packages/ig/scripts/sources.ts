/**
 * The FHIR packages `pnpm regen` builds from, each pinned by checksum.
 *
 * Two IG targets are generated side by side:
 *
 * - `ndhm-6.5.0` is the default export of `@nuskha/ig` and the version
 *   `@nuskha/core` pins. It is the newest release in the FHIR package
 *   registry, so it is immutable and `validator_cli.jar -ig ndhm.in#6.5.0`
 *   resolves it without a local file.
 *
 * - `ndhm-7.0.0-preview` is the build NRCeS serves from its preview site. Its
 *   own manifest says `"notForPublication": true` and it is not in the
 *   registry. NRCeS can rebuild it under the same version number, and when
 *   that happens the checksum below stops matching and regen fails. That
 *   failure is the signal to download it again, read the diff, and update the
 *   checksum on purpose.
 *
 * The core package supplies the datatypes (Coding, Reference, and so on) both
 * targets are built from.
 */

export interface PackageSource {
  readonly id: string;
  readonly version: string;
  readonly url: string;
  readonly sha256: string;
}

export interface Target extends PackageSource {
  /** Directory name under `src/generated`, and the key used by `--target`. */
  readonly slug: string;
  readonly status: "release" | "preview";
}

export const CORE: PackageSource = {
  id: "hl7.fhir.r4.core",
  version: "4.0.1",
  url: "https://packages.fhir.org/hl7.fhir.r4.core/4.0.1",
  sha256: "ebd7731df7d36b5b7d39d5fb6c9d77b44bb7fe5742f1a2e87f164738c3289d44",
};

export const TARGETS: readonly Target[] = [
  {
    slug: "ndhm-6.5.0",
    status: "release",
    id: "ndhm.in",
    version: "6.5.0",
    url: "https://packages.fhir.org/ndhm.in/6.5.0",
    sha256: "fc5a7a539238fb30dd9134b4c915a62c8bc052db1e5d286af98d74a0a730cafe",
  },
  {
    slug: "ndhm-7.0.0-preview",
    status: "preview",
    id: "ndhm.in",
    version: "7.0.0",
    url: "https://nrces.in/preview/ndhm/fhir/r4/package.tgz",
    sha256: "c2a8760000f401dc7932a9ff56a3aa50fdadcd9216db4387236943380b6143ee",
  },
];

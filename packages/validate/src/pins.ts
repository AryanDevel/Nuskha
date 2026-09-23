/**
 * The HL7 validator release this harness is written against.
 *
 * The checksum was taken from the GitHub release download. The Dockerfile
 * repeats it, and a test fails if the two drift apart.
 *
 * @see https://github.com/hapifhir/org.hl7.fhir.core/releases
 */
export const VALIDATOR = {
  version: "6.10.4",
  url: "https://github.com/hapifhir/org.hl7.fhir.core/releases/download/6.10.4/validator_cli.jar",
  sha256: "1106b9d58f9e363e47bea7c4fc065841e5fc91fe9d062775c3bfdd212bd653cc",
} as const;

/** The FHIR version every ABDM IG release is built on. */
export const FHIR_VERSION = "4.0.1";

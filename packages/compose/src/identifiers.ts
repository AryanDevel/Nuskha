import type {
  Identifier,
  OrganizationIdentifierKind,
  PatientIdentifierKind,
  PractitionerIdentifierKind,
} from "@nuskha/core";

/**
 * How each IR identifier kind is written in FHIR. The profiles bind
 * `identifier.type` (extensibly) to NRCeS's ndhm-identifier-type-code value
 * set, which takes codes from NRCeS's own code system and from HL7 v2-0203.
 *
 * Where the IG's own examples show a convention, this follows it: the
 * healthid, doctor and facility systems all come from those examples. Where
 * they do not, the identifier gets a type and no system rather than a system
 * made up here. An invented URI would look authoritative and mean nothing.
 */

const NRCES = "https://nrces.in/ndhm/fhir/r4/CodeSystem/ndhm-identifier-type-code";
const V2 = "http://terminology.hl7.org/CodeSystem/v2-0203";

interface Mapping {
  readonly system?: string;
  readonly code: string;
  readonly codeSystem: string;
  readonly display: string;
  /** Overrides the display as `type.text` when the code is broader than the kind. */
  readonly text?: string;
}

type Kind = PatientIdentifierKind | PractitionerIdentifierKind | OrganizationIdentifierKind;

const MAPPINGS: Readonly<Record<Kind, Mapping>> = {
  "abha-number": {
    system: "https://healthid.ndhm.gov.in",
    code: "ABHA",
    codeSystem: NRCES,
    display: "Ayushman Bharat Health Account (ABHA) ID",
  },
  // The value set has no separate code for an ABHA address, and the address is
  // not in the healthid number namespace, so it keeps the ABHA type, says what
  // it is in text, and carries no system.
  "abha-address": {
    code: "ABHA",
    codeSystem: NRCES,
    display: "Ayushman Bharat Health Account (ABHA) ID",
    text: "ABHA address",
  },
  mrn: { code: "MR", codeSystem: V2, display: "Medical record number" },
  "medical-registration": { code: "MD", codeSystem: V2, display: "Medical License number" },
  "hpr-id": {
    system: "https://doctor.ndhm.gov.in",
    code: "HPIN",
    codeSystem: NRCES,
    display: "Health Practitioner ID issued by NDHM",
  },
  "hfr-id": {
    system: "https://facility.ndhm.gov.in",
    code: "PRN",
    codeSystem: V2,
    display: "Provider number",
  },
  other: { code: "OIN", codeSystem: NRCES, display: "Other identifier" },
};

/** An identifier as every ABDM participant profile wants it: typed, with a coded type. */
export interface ProfiledIdentifier {
  type: { coding: { system: string; code: string; display: string }[]; text?: string };
  system?: string;
  value: string;
  assigner?: { display: string };
}

export function toIdentifier(id: Identifier<Kind>): ProfiledIdentifier {
  const m = MAPPINGS[id.kind];
  const system = id.system ?? m.system;
  return {
    type: {
      coding: [{ system: m.codeSystem, code: m.code, display: m.display }],
      ...(m.text ? { text: m.text } : {}),
    },
    ...(system ? { system } : {}),
    value: id.value.value,
    ...(id.issuer ? { assigner: { display: id.issuer.value } } : {}),
  };
}

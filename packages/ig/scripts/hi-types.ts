import type { HiType } from "../../core/src/index.ts";

/**
 * Which Composition profile each ABDM health information type is built on.
 *
 * This is the one table in the generator written by hand, because the IG
 * never states it: the `hiType` vocabulary belongs to the gateway and consent
 * APIs, and the IG does not mention it anywhere. Six of the eight follow a
 * naming pattern, and the two that do not are exactly the ones a guessed
 * mapping would get wrong: `OPConsultation` is built on `OPConsultRecord`, and
 * `HealthDocumentRecord` keeps its own name.
 *
 * Regen checks this table against every target. Each profile must exist and
 * constrain Composition, and every Composition profile in the IG must appear
 * either here or in NOT_HI_TYPES, so a new one cannot slip in unmapped.
 */
export const HI_TYPE_PROFILES: Readonly<Record<HiType, string>> = {
  DiagnosticReport: "DiagnosticReportRecord",
  DischargeSummary: "DischargeSummaryRecord",
  HealthDocumentRecord: "HealthDocumentRecord",
  ImmunizationRecord: "ImmunizationRecord",
  Invoice: "InvoiceRecord",
  OPConsultation: "OPConsultRecord",
  Prescription: "PrescriptionRecord",
  WellnessRecord: "WellnessRecord",
};

/** Composition profiles that are deliberately not health information types. */
export const NOT_HI_TYPES: Readonly<Record<string, string>> = {
  INPSComposition:
    "The India Patient Summary, added in the 7.0.0 preview. It is an IPS document, not a hiType.",
};

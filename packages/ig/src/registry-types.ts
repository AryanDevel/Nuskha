import type { z } from "zod";

/**
 * A constraint the generated schema for a profile does not evaluate: a
 * FHIRPath invariant, a required terminology binding, or a slice whose
 * discriminator needs reference resolution. The HL7 validator checks these.
 */
export interface UncheckedConstraint {
  readonly element: string;
  readonly reason: string;
}

/** One resource profile from the IG, as the generated registry describes it. */
export interface ProfileEntry {
  readonly url: string;
  /** The FHIR resource type the profile constrains. */
  readonly type: string;
  readonly title: string;
  readonly schema: z.ZodType;
  /**
   * What `schema` leaves to the HL7 validator. A schema that accepts a
   * resource means "no structural fault found", never "conformant".
   */
  readonly unchecked: readonly UncheckedConstraint[];
}

import type { Frequency, Medication, Quantity } from "@nuskha/core";
import type { MedicationRequest } from "@nuskha/ig";

/** The profile's own Dosage, tighter than the base datatype. */
type Dosage = MedicationRequest["dosageInstruction"][number];
type Repeat = NonNullable<NonNullable<Dosage["timing"]>["repeat"]>;
type DoseQuantity = NonNullable<NonNullable<Dosage["doseAndRate"]>[number]["doseQuantity"]>;

/**
 * A medication's dosage, as FHIR Dosage elements. The profile requires at
 * least one, and the IR guarantees there is something to build it from.
 *
 * Nothing here is coded. Route and food relation go in as text, because
 * choosing a SNOMED code for "after food" is terminology's job and a wrong
 * code is worse than none. The FHIR codes used are the ones whose value sets
 * the spec fixes: event timing (MORN, AFT, EVE, NIGHT) and units of time.
 */

type Slot = "morning" | "afternoon" | "evening" | "night";

const WHEN: Readonly<Record<Slot, string>> = {
  morning: "MORN",
  afternoon: "AFT",
  evening: "EVE",
  night: "NIGHT",
};

const FOOD: Readonly<Record<NonNullable<Medication["foodRelation"]>["value"], string>> = {
  "before-food": "before food",
  "after-food": "after food",
  "with-food": "with food",
  "empty-stomach": "on an empty stomach",
};

const UNIT_WORD: Readonly<Record<string, [string, string]>> = {
  h: ["hour", "hours"],
  d: ["day", "days"],
  wk: ["week", "weeks"],
  mo: ["month", "months"],
};

const UCUM = "http://unitsofmeasure.org";

function plural(value: number, unit: string): string {
  const [one, many] = UNIT_WORD[unit] ?? [unit, unit];
  return `${value} ${value === 1 ? one : many}`;
}

function describeFrequency(f: Frequency): string {
  switch (f.kind) {
    case "times-of-day":
      return [
        f.morning,
        f.afternoon,
        ...(f.evening === undefined ? [] : [f.evening]),
        f.night,
      ].join("-");
    case "every":
      return f.period === 1
        ? `${f.times} times a ${UNIT_WORD[f.unit]?.[0] ?? f.unit}`
        : `${f.times} times every ${plural(f.period, f.unit)}`;
    case "as-written":
      return f.text;
  }
}

/**
 * The human-readable instruction. The prescriber's own words win when there
 * are any; otherwise it is assembled from the structured fields, so a
 * receiver that ignores structure still shows something true.
 */
export function dosageText(m: Medication): string {
  if (m.instructions) return m.instructions.value;
  const parts: string[] = [];
  if (m.dose) parts.push(`${m.dose.value.value} ${m.dose.value.unit}`);
  if (m.frequency) parts.push(describeFrequency(m.frequency.value));
  if (m.foodRelation) parts.push(FOOD[m.foodRelation.value]);
  if (m.route) parts.push(m.route.value);
  if (m.asNeeded?.value) parts.push("as needed");
  if (m.duration) parts.push(`for ${plural(m.duration.value.value, m.duration.value.unit)}`);
  return parts.join(", ");
}

/** A dose of `count` units at one time of day, scaled by the IR's dose. */
function doseAt(count: number, dose: Quantity | undefined): DoseQuantity {
  return dose ? { value: count * dose.value, unit: dose.unit } : { value: count };
}

export function toDosages(m: Medication): Dosage[] {
  const shared: Dosage = {
    ...(m.foodRelation ? { additionalInstruction: [{ text: FOOD[m.foodRelation.value] }] } : {}),
    ...(m.asNeeded ? { asNeededBoolean: m.asNeeded.value } : {}),
    ...(m.route ? { route: { text: m.route.value } } : {}),
  };
  const bounds: Repeat = m.duration
    ? {
        boundsDuration: {
          value: m.duration.value.value,
          unit: m.duration.value.unit,
          system: UCUM,
          code: m.duration.value.unit,
        },
      }
    : {};
  const timing = (repeat: Repeat): Pick<Dosage, "timing"> =>
    Object.keys(repeat).length > 0 ? { timing: { repeat } } : {};
  const text = dosageText(m);
  const frequency = m.frequency?.value;

  if (frequency?.kind === "times-of-day") {
    const slots = (["morning", "afternoon", "evening", "night"] as const)
      .map((slot) => ({ slot, count: frequency[slot] ?? 0 }))
      .filter((s) => s.count > 0);
    const first = slots[0];
    // The IR rejects 0-0-0, so there is always at least one slot.
    if (!first) throw new Error("times-of-day frequency with no doses");

    // One amount at every time: a single Dosage. Different amounts (1-0-2):
    // one Dosage per time of day, all with sequence 1 to say they apply together.
    if (slots.every((s) => s.count === first.count)) {
      return [
        {
          text,
          ...shared,
          ...timing({ ...bounds, when: slots.map((s) => WHEN[s.slot]) }),
          doseAndRate: [{ doseQuantity: doseAt(first.count, m.dose?.value) }],
        },
      ];
    }
    return slots.map((s, i) => ({
      sequence: 1,
      ...(i === 0 ? { text } : {}),
      ...shared,
      ...timing({ ...bounds, when: [WHEN[s.slot]] }),
      doseAndRate: [{ doseQuantity: doseAt(s.count, m.dose?.value) }],
    }));
  }

  const repeat: Repeat =
    frequency?.kind === "every"
      ? {
          ...bounds,
          frequency: frequency.times,
          period: frequency.period,
          periodUnit: frequency.unit,
        }
      : bounds;
  return [
    {
      text,
      ...shared,
      ...timing(repeat),
      ...(m.dose
        ? {
            doseAndRate: [{ doseQuantity: { value: m.dose.value.value, unit: m.dose.value.unit } }],
          }
        : {}),
    },
  ];
}

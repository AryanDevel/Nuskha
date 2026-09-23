import type { z } from "zod";

/**
 * The small amount of FHIR semantics the generated schemas cannot express as
 * plain Zod shapes: fixed and pattern matching, choice-element exclusivity and
 * slice counting. Generated code calls into this module; nothing here knows
 * about any particular profile.
 */

type Ctx = z.core.$RefinementCtx;

/**
 * Every value reachable along `path`, flattening arrays at each step the way
 * FHIRPath navigation does. `getPath({a: [{b: 1}, {b: 2}]}, ["a", "b"])` is
 * `[1, 2]`.
 */
export function getPath(value: unknown, path: readonly string[]): unknown[] {
  let current: unknown[] = Array.isArray(value) ? value : [value];
  for (const key of path) {
    const next: unknown[] = [];
    for (const item of current) {
      if (item === null || typeof item !== "object") continue;
      const child = (item as Record<string, unknown>)[key];
      if (child === undefined) continue;
      if (Array.isArray(child)) next.push(...child);
      else next.push(child);
    }
    current = next;
  }
  return current;
}

/** Structural equality over JSON values. Key order does not matter. */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, i) => deepEqual(item, b[i]));
  }
  const ak = Object.keys(a);
  const bk = Object.keys(b);
  if (ak.length !== bk.length) return false;
  return ak.every(
    (k) =>
      Object.hasOwn(b, k) &&
      deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]),
  );
}

/**
 * FHIR `pattern[x]` semantics: every property the pattern sets must be present
 * with a matching value, and every item in a pattern array must be matched by
 * some item in the value's array. Properties the pattern leaves out are free.
 */
export function matchesPattern(value: unknown, pattern: unknown): boolean {
  if (pattern === null || typeof pattern !== "object") return value === pattern;
  if (value === null || typeof value !== "object") return false;
  if (Array.isArray(pattern)) {
    if (!Array.isArray(value)) return false;
    return pattern.every((p) => value.some((v) => matchesPattern(v, p)));
  }
  if (Array.isArray(value)) return false;
  return Object.entries(pattern).every(([k, p]) =>
    matchesPattern((value as Record<string, unknown>)[k], p),
  );
}

/**
 * A choice element such as `value[x]` appears in JSON as at most one of
 * `valueQuantity`, `valueString`, and so on. When the element is required,
 * exactly one must be present.
 */
export function checkChoice(
  value: Record<string, unknown>,
  ctx: Ctx,
  element: string,
  keys: readonly string[],
  required: boolean,
): void {
  const present = keys.filter((k) => value[k] !== undefined);
  if (present.length > 1) {
    ctx.addIssue({
      code: "custom",
      message: `${element}: only one of ${present.join(", ")} may be present`,
      path: [present[1] as string],
    });
  } else if (required && present.length === 0) {
    ctx.addIssue({
      code: "custom",
      message: `${element} is required: expected one of ${keys.join(", ")}`,
      path: [],
    });
  }
}

/** How a slice recognises its members, derived from the slicing discriminator. */
export type SlicePredicate =
  | {
      readonly kind: "fixed" | "pattern";
      readonly path: readonly string[];
      readonly value: unknown;
    }
  | { readonly kind: "type"; readonly path: readonly string[]; readonly resourceType: string };

export interface SliceSpec {
  readonly name: string;
  readonly min: number;
  /** `null` means unbounded. */
  readonly max: number | null;
  readonly predicates: readonly SlicePredicate[];
  /** Constraints the slice adds to its members, when the profile adds any. */
  readonly schema?: z.ZodType;
}

export interface SlicingSpec {
  readonly element: string;
  /** Only true when every slice's discriminator could be evaluated. */
  readonly closed: boolean;
  readonly slices: readonly SliceSpec[];
}

function satisfies(item: unknown, predicate: SlicePredicate): boolean {
  const found = getPath(item, predicate.path);
  switch (predicate.kind) {
    case "fixed":
      return found.some((v) => deepEqual(v, predicate.value));
    case "pattern":
      return found.some((v) => matchesPattern(v, predicate.value));
    case "type":
      return found.some(
        (v) =>
          v !== null &&
          typeof v === "object" &&
          (v as Record<string, unknown>).resourceType === predicate.resourceType,
      );
  }
}

/** Whether `item` belongs to `slice`: it must satisfy every discriminator. */
export function inSlice(item: unknown, slice: SliceSpec): boolean {
  return slice.predicates.every((p) => satisfies(item, p));
}

/**
 * Count the members of each slice, enforce each slice's cardinality and its
 * own constraints, and for closed slicing reject items that fit no slice.
 */
export function checkSlicing(
  value: Record<string, unknown>,
  ctx: Ctx,
  key: string,
  spec: SlicingSpec,
): void {
  const raw = value[key];
  const items: unknown[] = raw === undefined ? [] : Array.isArray(raw) ? raw : [raw];
  const matched = new Set<number>();

  for (const slice of spec.slices) {
    let count = 0;
    items.forEach((item, i) => {
      if (!inSlice(item, slice)) return;
      count++;
      matched.add(i);
      if (!slice.schema) return;
      const result = slice.schema.safeParse(item);
      if (result.success) return;
      for (const issue of result.error.issues) {
        ctx.addIssue({
          code: "custom",
          message: `${spec.element}:${slice.name}: ${issue.message}`,
          path: [key, i, ...issue.path.filter((p) => typeof p !== "symbol")],
        });
      }
    });
    if (count < slice.min) {
      ctx.addIssue({
        code: "custom",
        message: `${spec.element}:${slice.name} needs at least ${slice.min}, found ${count}`,
        path: [key],
      });
    }
    if (slice.max !== null && count > slice.max) {
      ctx.addIssue({
        code: "custom",
        message: `${spec.element}:${slice.name} allows at most ${slice.max}, found ${count}`,
        path: [key],
      });
    }
  }

  if (!spec.closed) return;
  items.forEach((_, i) => {
    if (matched.has(i)) return;
    ctx.addIssue({
      code: "custom",
      message: `${spec.element} is closed: item ${i} matches none of its slices`,
      path: [key, i],
    });
  });
}

/** Refine a schema to require a FHIR `fixed[x]` value on a complex type. */
export function fixed<T extends z.ZodType>(schema: T, expected: unknown): T {
  return schema.refine((v) => deepEqual(v, expected), {
    message: `must equal the fixed value ${JSON.stringify(expected)}`,
  }) as unknown as T;
}

/** Refine a schema to require a FHIR `pattern[x]` value on a complex type. */
export function pattern<T extends z.ZodType>(schema: T, expected: unknown): T {
  return schema.refine((v) => matchesPattern(v, expected), {
    message: `must match the pattern ${JSON.stringify(expected)}`,
  }) as unknown as T;
}

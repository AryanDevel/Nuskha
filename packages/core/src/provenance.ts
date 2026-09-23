import { z } from "zod";

/**
 * Where a value came from. Every leaf of the Clinical IR is a `Field`, and a
 * field extracted from a document says which regions of which pages support
 * it and how sure the extractor was.
 *
 * The three states mean different things and are kept distinct on purpose:
 *
 * - no `provenance`: the value was supplied, not read. An EMR entering at the
 *   IR layer, or a person typing into the review UI, produces these.
 * - `provenance` with spans: the value was read from those regions.
 * - `provenance` with no spans: the value was extracted but nothing on the
 *   page supports it. That is the definition of a hallucination the benchmark
 *   counts, which is why the IR can represent it rather than forbid it.
 */

/**
 * A rectangle on a page, in fractions of the page's width and height with the
 * origin at the top left, so it survives rescaling and re-rendering.
 */
export interface BoundingBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface SourceSpan {
  /** 1-based page number in the source document. */
  readonly page: number;
  readonly box: BoundingBox;
  /** The text in the region as the reader saw it, before any normalisation. */
  readonly text: string;
}

export interface Provenance {
  /** The extractor's confidence in the value, from 0 to 1. */
  readonly confidence: number;
  readonly spans: readonly SourceSpan[];
}

export interface Field<T> {
  readonly value: T;
  readonly provenance?: Provenance;
}

/** The document a set of spans refers to. */
export interface SourceDocument {
  /** SHA-256 of the file as received, lowercase hex. */
  readonly sha256: string;
  readonly mediaType: string;
  readonly pageCount: number;
}

const fraction = z.number().min(0).max(1);

export const BoundingBox: z.ZodType<BoundingBox> = z
  .strictObject({ x: fraction, y: fraction, width: fraction, height: fraction })
  .refine((b) => b.x + b.width <= 1 + 1e-9 && b.y + b.height <= 1 + 1e-9, {
    message: "the box extends beyond the page",
  });

export const SourceSpan: z.ZodType<SourceSpan> = z.strictObject({
  page: z.int().min(1),
  box: BoundingBox,
  text: z.string(),
});

export const Provenance: z.ZodType<Provenance> = z.strictObject({
  confidence: fraction,
  spans: z.array(SourceSpan),
});

export const SourceDocument: z.ZodType<SourceDocument> = z.strictObject({
  sha256: z.string().regex(/^[0-9a-f]{64}$/, "expected lowercase hex SHA-256"),
  mediaType: z.string().min(1),
  pageCount: z.int().min(1),
});

/** The schema for a `Field` holding values that match `value`. */
export function fieldSchema<T>(value: z.ZodType<T>): z.ZodType<Field<T>> {
  return z.strictObject({ value, provenance: z.exactOptional(Provenance) });
}

/** A supplied value, with no provenance: for integrators and for tests. */
export function field<T>(value: T): Field<T> {
  return { value };
}

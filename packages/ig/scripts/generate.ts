/**
 * StructureDefinition snapshots in, TypeScript out.
 *
 * Every named type is emitted twice, as an interface and as a Zod schema
 * annotated with that interface, so the compiler proves the two agree. The
 * schemas check what a snapshot states structurally: cardinality, JSON shape,
 * primitive formats, fixed and pattern values, choice exclusivity, and slices
 * whose discriminators can be evaluated without resolving references.
 *
 * Everything else is recorded, per profile, as an unchecked constraint rather
 * than silently skipped: FHIRPath invariants, terminology bindings, and
 * discriminators such as `resolve()`. The HL7 validator is the authority on
 * those, and `@nuskha/validate` needs to know which answers it cannot give.
 */

// ---------------------------------------------------------------------------
// The slice of the FHIR StructureDefinition model this generator reads.

interface TypeRef {
  readonly code: string;
  readonly profile?: readonly string[];
  readonly targetProfile?: readonly string[];
  readonly extension?: readonly { readonly url: string; readonly valueString?: string }[];
}

interface ElementDefinition {
  readonly id: string;
  readonly path: string;
  readonly min?: number;
  readonly max?: string;
  readonly base?: { readonly max: string };
  readonly type?: readonly TypeRef[];
  readonly sliceName?: string;
  readonly slicing?: {
    readonly discriminator?: readonly { readonly type: string; readonly path: string }[];
    readonly rules?: string;
    readonly ordered?: boolean;
  };
  readonly contentReference?: string;
  readonly constraint?: readonly { readonly key: string }[];
  readonly binding?: { readonly strength: string; readonly valueSet?: string };
  readonly [key: string]: unknown;
}

export interface StructureDefinition {
  readonly resourceType: "StructureDefinition";
  readonly url: string;
  readonly name: string;
  readonly title?: string;
  readonly type: string;
  readonly kind: string;
  readonly derivation?: string;
  readonly abstract?: boolean;
  readonly snapshot?: { readonly element: readonly ElementDefinition[] };
}

export function structureDefinitions(files: Map<string, unknown>): StructureDefinition[] {
  const out: StructureDefinition[] = [];
  for (const [name, json] of files) {
    if (!/^package\/[^/]+\.json$/.test(name)) continue;
    const r = json as { resourceType?: string };
    if (r.resourceType === "StructureDefinition") out.push(json as StructureDefinition);
  }
  return out.sort((a, b) => a.url.localeCompare(b.url));
}

// ---------------------------------------------------------------------------
// Snapshot to tree. Element ids encode both nesting (`.`) and slicing (`:`).

interface Node {
  readonly el: ElementDefinition;
  /** The JSON property name, `[x]` included for choice elements. */
  readonly key: string;
  readonly children: Node[];
  readonly slices: Node[];
}

function buildTree(sd: StructureDefinition, unchecked: Unchecked): Node {
  const elements = sd.snapshot?.element ?? [];
  const root = elements[0];
  if (!root) throw new Error(`${sd.url} has no snapshot`);
  const byId = new Map<string, Node>();
  const rootNode: Node = { el: root, key: root.path, children: [], slices: [] };
  byId.set(root.id, rootNode);

  for (const el of elements.slice(1)) {
    const cut = el.id.lastIndexOf(".");
    const parent = byId.get(el.id.slice(0, cut));
    const segment = el.id.slice(cut + 1);
    const node: Node = { el, key: segment.split(":")[0] as string, children: [], slices: [] };
    byId.set(el.id, node);
    if (!parent) continue; // descendant of a skipped reslice
    if (segment.includes("/")) {
      unchecked.add(el.id, "reslicing is not evaluated");
      continue;
    }
    if (segment.includes(":")) {
      const sliced = parent.children.find((c) => c.key === node.key);
      if (sliced) sliced.slices.push(node);
    } else {
      parent.children.push(node);
    }
  }
  return rootNode;
}

// ---------------------------------------------------------------------------
// What the generated schemas do not check, recorded as data.

export interface UncheckedConstraint {
  readonly element: string;
  readonly reason: string;
}

class Unchecked {
  readonly items: UncheckedConstraint[] = [];
  readonly #seen = new Set<string>();
  add(element: string, reason: string): void {
    const k = `${element}\0${reason}`;
    if (this.#seen.has(k)) return;
    this.#seen.add(k);
    this.items.push({ element, reason });
  }
}

// ---------------------------------------------------------------------------
// Type classification, from the core package.

/** How FHIR JSON represents each primitive. Everything unlisted is a string. */
const JSON_NUMBER = new Set(["integer", "positiveInt", "unsignedInt", "decimal"]);

/**
 * Regexes that are exact but unsafe to run. The base64Binary pattern nests
 * quantifiers around `\s*` and backtracks exponentially on a near miss, which
 * a scanned document embedded in a Binary will eventually produce.
 */
const LINEAR_REGEX: Readonly<Record<string, string>> = {
  base64Binary: "[A-Za-z0-9+/=\\s]*",
};

const FHIRPATH_TYPES: Readonly<Record<string, { ts: string; zod: string }>> = {
  "http://hl7.org/fhirpath/System.String": { ts: "string", zod: "z.string()" },
  "http://hl7.org/fhirpath/System.Boolean": { ts: "boolean", zod: "z.boolean()" },
  "http://hl7.org/fhirpath/System.Integer": { ts: "number", zod: "z.int()" },
  "http://hl7.org/fhirpath/System.Decimal": { ts: "number", zod: "z.number()" },
};

export class Universe {
  readonly primitives = new Map<string, StructureDefinition>();
  readonly datatypes = new Map<string, StructureDefinition>();
  readonly resources = new Set<string>();
  readonly byUrl = new Map<string, StructureDefinition>();

  constructor(core: readonly StructureDefinition[]) {
    for (const sd of core) {
      this.byUrl.set(sd.url, sd);
      if (sd.kind === "primitive-type") {
        this.primitives.set(sd.name, sd);
      } else if (sd.kind === "complex-type") {
        // Specializations (and Element, which has no base) are the datatypes
        // proper. The only core constraints
        // on a datatype that appear as type codes are Age, Count, Distance,
        // Duration, MoneyQuantity and SimpleQuantity, all on Quantity; the
        // hundreds of core extension definitions are deliberately left out.
        if (sd.derivation !== "constraint" || sd.type === "Quantity") {
          this.datatypes.set(sd.name, sd);
        }
      } else if (sd.kind === "resource") {
        this.resources.add(sd.type);
      }
    }
  }

  addPackage(sds: readonly StructureDefinition[]): void {
    for (const sd of sds) this.byUrl.set(sd.url, sd);
  }
}

// ---------------------------------------------------------------------------
// Emission.

const upperFirst = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const ident = (s: string) => s.replace(/[^A-Za-z0-9_$]/g, "_");
const str = (v: unknown) => JSON.stringify(v);

const FIXED = /^(fixed|pattern)([A-Z].*)$/;

function fixedOf(el: ElementDefinition): { kind: "fixed" | "pattern"; value: unknown } | undefined {
  for (const k of Object.keys(el).sort()) {
    const m = FIXED.exec(k);
    if (m) return { kind: m[1] as "fixed" | "pattern", value: el[k] };
  }
  return undefined;
}

interface Expr {
  readonly ts: string;
  readonly zod: string;
}

/**
 * Emits one module. `prefix` is how this module refers to the datatypes
 * module: empty inside it, `dt.` from a profile module.
 */
export class ModuleEmitter {
  readonly #decls: string[] = [];
  readonly #named = new Set<string>();
  /** Datatypes referenced but not yet emitted, for building the closure. */
  readonly wanted = new Set<string>();

  readonly universe: Universe;
  readonly prefix: string;

  constructor(universe: Universe, prefix: string) {
    this.universe = universe;
    this.prefix = prefix;
  }

  get source(): string {
    return this.#decls.join("\n");
  }

  raw(code: string): void {
    this.#decls.push(code);
  }

  /** A datatype or profile rooted at a snapshot. Returns the unchecked list. */
  emitRoot(name: string, sd: StructureDefinition, resourceType?: string): UncheckedConstraint[] {
    const unchecked = new Unchecked();
    const tree = buildTree(sd, unchecked);
    const scope = new Scope(this, name, tree, unchecked, sd);
    scope.object(name, tree, resourceType);
    for (const el of sd.snapshot?.element ?? []) {
      for (const c of el.constraint ?? []) {
        if (c.key === "ele-1") continue; // implied by the non-empty object and array checks
        unchecked.add(el.id, `invariant ${c.key}`);
      }
      if (el.binding?.strength === "required" && el.binding.valueSet) {
        unchecked.add(el.id, `required binding ${el.binding.valueSet}`);
      }
    }
    return unchecked.items;
  }

  /** Claim a name before emitting it, so self-referencing types terminate. */
  reserve(name: string): void {
    if (this.#named.has(name)) throw new Error(`duplicate generated name ${name}`);
    this.#named.add(name);
  }

  declare(name: string, iface: string, schema: string): void {
    this.#decls.push(
      `export interface ${name} ${iface}\n` +
        `export const ${name}: z.ZodType<${name}> = z.lazy(() =>\n  ${schema},\n);\n`,
    );
  }

  has(name: string): boolean {
    return this.#named.has(name);
  }

  /** The expression for a single value of FHIR type `code`. */
  typeRef(t: TypeRef): Expr {
    const u = this.universe;
    const fp = FHIRPATH_TYPES[t.code];
    if (fp) return fp;
    if (u.primitives.has(t.code)) {
      return {
        ts: JSON_NUMBER.has(t.code) ? "number" : t.code === "boolean" ? "boolean" : "string",
        zod: `${this.prefix}P.${t.code}`,
      };
    }
    if (u.resources.has(t.code)) {
      return { ts: `${this.prefix}AnyResource`, zod: `${this.prefix}AnyResource` };
    }
    if (u.datatypes.has(t.code)) {
      this.wanted.add(t.code);
      return { ts: `${this.prefix}${t.code}`, zod: `${this.prefix}${t.code}` };
    }
    throw new Error(`unknown FHIR type ${t.code}`);
  }

  isPrimitive(t: TypeRef | undefined): boolean {
    return !!t && (this.universe.primitives.has(t.code) || t.code in FHIRPATH_TYPES);
  }
}

class Scope {
  readonly m: ModuleEmitter;
  readonly root: string;
  readonly tree: Node;
  readonly unchecked: Unchecked;
  readonly sd: StructureDefinition;

  constructor(
    m: ModuleEmitter,
    root: string,
    tree: Node,
    unchecked: Unchecked,
    sd: StructureDefinition,
  ) {
    this.m = m;
    this.root = root;
    this.tree = tree;
    this.unchecked = unchecked;
    this.sd = sd;
  }

  nameFor(node: Node): string {
    const parts = node.el.id.split(".").slice(1);
    const tail = parts.map((p) => {
      const [k, slice] = p.split(":");
      const base = (k as string).replace("[x]", "");
      return slice ? `${base}$${ident(slice)}` : base;
    });
    return [this.root, ...tail].join("_");
  }

  /** Find the non-slice node at an element path, for contentReference. */
  findPath(path: string, node: Node = this.tree): Node | undefined {
    if (node.el.path === path && !node.el.sliceName) return node;
    for (const c of node.children) {
      if (path === c.el.path || path.startsWith(`${c.el.path}.`)) {
        const hit = this.findPath(path, c);
        if (hit) return hit;
      }
    }
    return undefined;
  }

  /** Expression for one item of `node`, before cardinality is applied. */
  item(node: Node, type: TypeRef | undefined): Expr {
    let e: Expr;
    if (node.el.contentReference) {
      const path = node.el.contentReference.split("#")[1] as string;
      const target = this.findPath(path);
      if (!target) throw new Error(`${this.sd.url}: contentReference ${path} not found`);
      const name = this.nameFor(target);
      if (!this.m.has(name)) this.object(name, target);
      e = { ts: name, zod: name };
    } else if (node.children.length > 0 && !this.m.isPrimitive(type)) {
      const name = this.nameFor(node);
      if (!this.m.has(name)) this.object(name, node);
      e = { ts: name, zod: name };
    } else {
      if (!type) throw new Error(`${node.el.id} has no type`);
      if (type.code === "BackboneElement" || type.code === "Element") {
        e = { ts: `${this.m.prefix}Element`, zod: `${this.m.prefix}Element` };
        this.m.wanted.add("Element");
      } else {
        e = this.m.typeRef(type);
      }
      if (node.children.some((c) => c.slices.length > 0 || c.el.min !== 0)) {
        this.unchecked.add(node.el.id, "constraints on a primitive's extensions");
      }
    }

    const f = fixedOf(node.el);
    if (!f) return e;
    if (f.value !== null && typeof f.value === "object") {
      return { ts: e.ts, zod: `rt.${f.kind}(${e.zod}, ${str(f.value)})` };
    }
    return { ts: str(f.value), zod: `z.literal(${str(f.value)})` };
  }

  /** Emit a named object type from `node`'s children. */
  object(name: string, node: Node, resourceType?: string): void {
    this.m.reserve(name);
    const props: string[] = [];
    const shape: string[] = [];
    const checks: string[] = [];
    if (resourceType) {
      props.push(`  resourceType: ${str(resourceType)};`);
      shape.push(`    resourceType: z.literal(${str(resourceType)}),`);
    }

    const add = (
      key: string,
      ex: Expr,
      required: boolean,
      array: boolean,
      min: number,
      max: string,
    ) => {
      let ts = ex.ts;
      let zod = ex.zod;
      if (array) {
        ts = /[|&]/.test(ts) ? `(${ts})[]` : `${ts}[]`;
        zod = `z.array(${zod}).min(${Math.max(1, min)})`;
        if (max !== "*") zod += `.max(${max})`;
      }
      props.push(`  ${key}${required ? "" : "?"}: ${ts};`);
      shape.push(`    ${key}: ${required ? zod : `z.exactOptional(${zod})`},`);
    };

    const companion = (key: string, array: boolean) => {
      this.m.wanted.add("Element");
      const el = `${this.m.prefix}Element`;
      add(
        `_${key}`,
        array ? { ts: `${el} | null`, zod: `z.union([${el}, z.null()])` } : { ts: el, zod: el },
        false,
        array,
        0,
        "*",
      );
    };

    for (const child of node.children) {
      const el = child.el;
      const types = el.type ?? [];
      const array = (el.base?.max ?? el.max) !== "1";
      const min = el.min ?? 0;
      const max = el.max ?? "*";
      const choice = child.key.endsWith("[x]");

      if (max === "0") {
        const keys = choice
          ? types.map((t) => child.key.replace("[x]", upperFirst(t.code)))
          : [child.key];
        for (const k of keys) {
          props.push(`  ${k}?: never;`);
          shape.push(`    ${k}: z.exactOptional(z.never()),`);
        }
        continue;
      }

      if (choice) {
        const stem = child.key.replace("[x]", "");
        const keys: string[] = [];
        let required = min >= 1;
        for (const t of types) {
          const key = stem + upperFirst(t.code);
          keys.push(key);
          const typeSlice = child.slices.find((s) => s.el.sliceName === key);
          if (typeSlice && (typeSlice.el.min ?? 0) >= 1) required = false;
          const ex = typeSlice ? this.item(typeSlice, t) : this.item(child, t);
          const sliceRequired = !!typeSlice && (typeSlice.el.min ?? 0) >= 1;
          add(key, ex, sliceRequired, array, min, max);
          if (this.m.isPrimitive(t)) companion(key, array);
        }
        for (const s of child.slices) {
          if (!keys.includes(s.el.sliceName ?? "")) {
            this.unchecked.add(s.el.id, "type slice on a type the element does not allow");
          }
        }
        checks.push(`rt.checkChoice(o, ctx, ${str(el.path)}, ${str(keys)}, ${required});`);
        continue;
      }

      if (types.length > 1) throw new Error(`${el.id} has several types but is not a choice`);
      const type = types[0];
      add(child.key, this.item(child, type), min >= 1, array, min, max);
      if (this.m.isPrimitive(type) && !(type && type.code in FHIRPATH_TYPES)) {
        companion(child.key, array);
      }

      if (child.slices.length > 0 && el.slicing) {
        const spec = this.slicing(child);
        if (spec) checks.push(`rt.checkSlicing(o, ctx, ${str(child.key)}, ${spec});`);
      }
    }

    const iface = `{\n${props.join("\n")}\n}`;
    let schema = `z\n    .strictObject({\n${shape.join("\n")}\n    })`;
    if (checks.length > 0) {
      schema +=
        `\n    .superRefine((v, ctx) => {\n      const o = v as Record<string, unknown>;\n` +
        checks.map((c) => `      ${c}`).join("\n") +
        "\n    })";
    }
    this.m.declare(name, iface, schema);
  }

  /** A SlicingSpec literal, or undefined when nothing about it is checkable. */
  slicing(node: Node): string | undefined {
    const disc = node.el.slicing?.discriminator ?? [];
    if (node.el.slicing?.ordered) this.unchecked.add(node.el.id, "slice ordering");
    if (disc.length === 0) {
      this.unchecked.add(node.el.id, "slicing without a discriminator");
      return undefined;
    }
    const slices: string[] = [];
    let allResolved = true;
    for (const s of node.slices) {
      const predicates: string[] = [];
      for (const d of disc) {
        const p = this.predicate(s, d.type, d.path);
        if (p) predicates.push(p);
        else {
          this.unchecked.add(s.el.id, `discriminator ${d.type}:${d.path}`);
          predicates.length = 0;
          break;
        }
      }
      if (predicates.length === 0) {
        allResolved = false;
        continue;
      }
      const max = s.el.max === "*" || s.el.max === undefined ? "null" : s.el.max;
      let schema = "";
      if (s.children.length > 0) {
        const name = this.nameFor(s);
        if (!this.m.has(name)) this.object(name, s);
        schema = `, schema: ${name}`;
      }
      slices.push(
        `{ name: ${str(s.el.sliceName)}, min: ${s.el.min ?? 0}, max: ${max}, predicates: [${predicates.join(", ")}]${schema} }`,
      );
    }
    if (slices.length === 0) return undefined;
    const closed = allResolved && node.el.slicing?.rules === "closed";
    if (node.el.slicing?.rules === "closed" && !closed) {
      this.unchecked.add(node.el.id, "closed slicing (some slices not evaluable)");
    }
    return `{ element: ${str(node.el.id)}, closed: ${closed}, slices: [${slices.join(", ")}] }`;
  }

  predicate(slice: Node, type: string, path: string): string | undefined {
    if (path.includes("(")) return undefined;
    const segs = path === "$this" ? [] : path.split(".");

    if (type === "value" || type === "pattern") {
      let node: Node | undefined = slice;
      let i = 0;
      for (; i < segs.length && node; i++) {
        const f = fixedOf(node.el);
        if (f) break;
        node = node.children.find((c) => c.key === segs[i]);
      }
      if (!node) {
        // An extension slice's url lives on the extension definition it points at.
        if (path === "url") {
          const url = this.extensionUrl(slice);
          if (url) return `{ kind: "fixed", path: ["url"], value: ${str(url)} }`;
        }
        return undefined;
      }
      const f = fixedOf(node.el);
      if (!f) return undefined;
      const rest = segs.slice(i);
      if (rest.length === 0) {
        return `{ kind: ${str(f.kind)}, path: ${str(segs)}, value: ${str(f.value)} }`;
      }
      const sub = getPathStatic(f.value, rest);
      if (sub.length !== 1) return undefined;
      return `{ kind: ${str(f.kind)}, path: ${str(segs)}, value: ${str(sub[0])} }`;
    }

    if (type === "type") {
      let node: Node | undefined = slice;
      for (const s of segs) node = node?.children.find((c) => c.key === s);
      const t = node?.el.type?.[0];
      if (!t) return undefined;
      const profile = t.profile?.[0] ? this.m.universe.byUrl.get(t.profile[0]) : undefined;
      const resourceType = profile?.type ?? t.code;
      if (!this.m.universe.resources.has(resourceType)) return undefined;
      return `{ kind: "type", path: ${str(segs)}, resourceType: ${str(resourceType)} }`;
    }

    return undefined;
  }

  extensionUrl(slice: Node): string | undefined {
    const profile = slice.el.type?.[0]?.profile?.[0];
    if (!profile) return undefined;
    const sd = this.m.universe.byUrl.get(profile.split("|")[0] as string);
    const url = sd?.snapshot?.element.find((e) => e.path === "Extension.url")?.fixedUri;
    return typeof url === "string" ? url : profile.split("|")[0];
  }
}

function getPathStatic(value: unknown, path: readonly string[]): unknown[] {
  let current: unknown[] = [value];
  for (const key of path) {
    current = current.flatMap((v) => {
      if (v === null || typeof v !== "object") return [];
      const c = (v as Record<string, unknown>)[key];
      return c === undefined ? [] : Array.isArray(c) ? c : [c];
    });
  }
  return current;
}

// ---------------------------------------------------------------------------
// Primitives, emitted once into the datatypes module.

export function emitPrimitives(u: Universe): string {
  const lines: string[] = [];
  for (const [name, sd] of [...u.primitives].sort(([a], [b]) => a.localeCompare(b))) {
    const value = sd.snapshot?.element.find((e) => e.path === `${name}.value`);
    const regex =
      LINEAR_REGEX[name] ??
      value?.type?.[0]?.extension?.find((x) => x.url.endsWith("/regex"))?.valueString;
    let zod: string;
    if (name === "boolean") zod = "z.boolean()";
    else if (name === "decimal") zod = "z.number()";
    else if (name === "integer") zod = "z.int()";
    else if (name === "positiveInt") zod = "z.int().min(1)";
    else if (name === "unsignedInt") zod = "z.int().min(0)";
    else if (regex) {
      const anchored = `^(?:${regex})$`;
      new RegExp(anchored); // fail generation, not validation, on a pattern JS cannot compile
      zod = `z.string().regex(new RegExp(${str(anchored)}))`;
    } else zod = "z.string()";
    lines.push(`  ${name}: ${zod},`);
  }
  return `/** One schema per FHIR primitive, with the format its definition states. */\nexport const P = {\n${lines.join("\n")}\n} as const;\n`;
}

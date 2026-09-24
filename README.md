# Nuskha

Turn Indian clinical documents into ABDM-conformant FHIR bundles.

> **Status: pre-alpha, nothing usable yet.** This repository currently holds the
> workspace skeleton and two packages that do almost nothing. The first release
> worth installing is v0.1.0, which compiles a prescription from an intermediate
> representation to a validated bundle. See the roadmap below.

## What this will be

A TypeScript library that reads a prescription, lab report or discharge summary
(PDF or photo) and produces a FHIR bundle conformant to the
[ABDM Implementation Guide](https://nrces.in/ndhm/fhir/r4/index.html)
(`ndhm.in#6.5.0`, with the 7.0.0 preview tracked alongside), together with a review UI for the human approval step and a
published accuracy benchmark.

The design commitment that shapes everything else: **the model never writes
FHIR.** A document is read into a typed intermediate representation, and that
representation is compiled into a bundle by ordinary deterministic TypeScript.
Structural validity is a property of the compiler, so it can be tested with
golden files; model error is confined to field values, so it can be measured
separately. See `docs/adr/` once ADR-0001 lands.

## What this is not

- Not an ABDM gateway client. [`abdm-sdk-node`](https://github.com/topics/abdm)
  covers ABHA, consent and the HIP/HIU flows.
- Not a certified HIP. You complete your own M1/M2/M3 sandbox certification.
- Not a medical device. There is no autonomous submission path; a human
  approval step is required by the shape of the API.

## Status by unit

| Unit | What |
|------|------|
| 0.1  | Repository skeleton — **done** |
| 0.2  | IG code generation from `ndhm.in#6.5.0` and the 7.0.0 preview — **done** |
| 0.3  | Validator harness (HL7 Java validator in Docker) — **done** |
| 0.4  | Clinical IR v0 for Prescription — code done, ADR-0001 pending |
| 0.5  | Prescription composer — **done** |
| 0.6  | CLI v0 — **done** |
| 0.7  | README, ADRs, first release |

## Development

Requires Node >= 22 and pnpm (the version is pinned in `packageManager`).

```sh
pnpm install
pnpm build      # tsc --build across the workspace
pnpm typecheck  # includes test files
pnpm test       # vitest
pnpm lint       # biome check
pnpm format     # biome check --write
```

## Licence

Apache-2.0. See [LICENSE](LICENSE). Contributions require a DCO sign-off; see
[CONTRIBUTING.md](CONTRIBUTING.md).

# Contributing to Nuskha

## Before you start

Read [`SECURITY.md`](SECURITY.md) if your change touches document handling, and
never attach a real clinical document to anything in this repository. Synthetic
documents are generated from a seed; use those.

## Sign your commits (DCO)

This project uses the [Developer Certificate of Origin](DCO) rather than a CLA.
It is lighter on you and it means the project is not reserving a relicensing
option behind your back.

Sign off each commit:

```sh
git commit -s -m "your message"
```

That appends `Signed-off-by: Your Name <your@email>`, which certifies you have
the right to submit the work under Apache-2.0. CI checks every commit in a pull
request and fails if any are missing.

## Development

Node >= 22, pnpm pinned in `packageManager`.

```sh
pnpm install
pnpm lint && pnpm typecheck && pnpm build && pnpm test
```

Those four are exactly what CI runs. If they pass locally they pass there.

Changes that affect a published package need a changeset:

```sh
pnpm changeset
```

## How work is organised

Work is tracked as numbered units inside phases. Each unit has a definition of
done that something other than an opinion can check: a validator result, a
golden file, a test. If you cannot state the check, the unit is not ready to
start.

Open an issue before a substantial pull request. Small commits landing over time
are preferred to one large drop, and a revert with an explanation is a perfectly
respectable outcome.

## Architecture decisions

Anything that constrains future work gets an ADR in [`docs/adr/`](docs/adr),
using the [template](docs/adr/0000-template.md). The section that matters is
**Alternatives rejected** — an ADR that does not name what was turned down and
why is a description, not a decision record.

## On AI assistance

Using an AI assistant on this project is fine. Plenty of the code here will be
written that way, and pretending otherwise would be silly.

What is not fine is submitting output you have not reviewed and cannot defend.
The rule is simple:

> **You are accountable for every line you submit, regardless of what wrote it.**
> If you could not explain a change in a code review, do not open the pull
> request.

Some practical consequences:

- **Lean on assistance freely** for composers, codegen, test harnesses, CLI
  plumbing and the synthetic document generator. All of it is checked by
  something external — the validator, the goldens, the benchmark gate — so
  correctness does not depend on who or what wrote it.
- **Write the judgement artefacts yourself.** ADRs, the failure taxonomy,
  benchmark methodology and user-facing documentation carry your reasoning, and
  generated prose in those places is both easy to spot and actively misleading.
  An ADR listing alternatives you never considered is worse than no ADR.
- **Mention it in the pull request** if an assistant did substantial work. Not
  as a confession — it is useful review context, the same way "ported from X"
  is.

Clinical software raises the stakes on this. A wrong medication strength is a
real-world harm, and "I do not know, it was generated" is not an answer anyone
can accept about a dosage edge case.

## Code of conduct

This project follows the [Contributor Covenant](CODE_OF_CONDUCT.md).

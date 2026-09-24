# Releasing

All `@nuskha/*` packages share one version and are released together.

## During development

A pull request that changes a published package adds a changeset:

```sh
pnpm changeset
```

Pick the packages, the bump (patch, minor, major; while we are on 0.x a
breaking change is a minor), and write a line for the changelog.

## Cutting a release

1. From an up-to-date `main`, branch and apply the pending changesets:

   ```sh
   git switch -c release/v0.X.0
   pnpm changeset version
   ```

   This bumps every package, writes each `CHANGELOG.md`, and deletes the
   changeset files.

2. Read the changelog diff. Commit with a sign-off, push, and open a pull
   request:

   ```sh
   git commit -s -am "Release v0.X.0"
   ```

3. Merge it once CI is green. The `Release` workflow then publishes every
   version that is not yet on npm, with provenance, and pushes a git tag for
   each package (`@nuskha/cli@0.X.0` and so on). A push that changes no
   version publishes nothing, so re-running it is safe.

4. Check it from outside the repository:

   ```sh
   npm i -g @nuskha/cli
   nuskha --version
   ```

## Why not a bot pull request

The usual Changesets setup has a bot open a "Version Packages" pull request.
Here its commits would fail the required DCO check, because they carry no
`Signed-off-by`, and a pull request opened with the default `GITHUB_TOKEN`
does not trigger the required CI checks at all. Running `changeset version`
locally costs one command and keeps every commit on `main` signed and
checked.

## Credentials

The workflow publishes with `NPM_TOKEN` (a repository secret holding a
granular npm access token with publish rights on the `@nuskha` scope) until
npm trusted publishing is configured for each package. Once it is, the
workflow's OIDC identity is enough and the secret should be deleted.

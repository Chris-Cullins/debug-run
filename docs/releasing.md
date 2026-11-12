# Publishing debug-run to npm

The release is automatic: `.github/workflows/ci.yml` publishes an unpublished
`package.json` version after a push to `main` passes all checks. Merging a PR counts
as that push. Tags and GitHub Releases do not trigger npm publishing.

The maintenance PR prepares **0.6.0**, raising the minimum Node.js version to
**22.22.1**. Merging it will attempt to publish that version. Review the Node
requirement as a compatibility change before merging.

## Before merging

1. Confirm the PR checks pass on Node 22.22.1, 24, and 26. CI runs typechecking,
   formatting, unit tests, dependency audits, the TypeScript sample build, and an
   npm tarball smoke test. A separate job builds and audits the .NET 10 samples.
2. Check [debug-run's npm settings](https://www.npmjs.com/package/debug-run/access)
   under **Settings → Trusted publishing**. The GitHub publisher must match:
   - Organization/user: `Chris-Cullins`
   - Repository: `debug-run`
   - Workflow filename: `ci.yml` (not `.github/workflows/ci.yml`)
   - Environment: leave empty; this workflow does not declare an environment.
   - Allow direct publishing with `npm publish`.
3. Confirm the version is new: `npm view debug-run versions --json`.

The workflow already uses OIDC, so it does not need an `NPM_TOKEN`. Its last
observed main-branch CI run succeeded and npm reports 0.5.10 as latest; account settings were
not inspected during this maintenance pass. If recreating the publisher, complete
the first publish within npm's two-day validation window.

## After merging

1. Open [GitHub Actions → CI](https://github.com/Chris-Cullins/debug-run/actions/workflows/ci.yml).
2. Watch the **check** jobs and then **publish**. The latter skips versions that
   are already on npm, checks the tarball, and runs `npm publish --access public`.
3. Verify the release:

   ```bash
   npm view debug-run@0.6.0 version engines dist.integrity
   npx --yes debug-run@0.6.0 --version
   ```

No local `npm publish` is needed for the normal workflow. npm automatically adds
provenance for this public repository's trusted-publishing releases.

## Future releases

On a branch based on current `main`, use Node 22.22.1 or newer (Node 24 LTS is the
publishing runtime):

```bash
npm ci
npm version patch --no-git-tag-version
npm run check
npm audit
npm run test:package
git add package.json package-lock.json
git commit -m "chore: prepare next release"
```

Use `minor` instead of `patch` for a deliberate compatibility change while the
package is below 1.0. Commit both version files, open a PR, and merge once checks
pass. `npm pack` and `npm publish` rebuild the CLI via `prepack`; the package
allowlist keeps local caches and development files out of the release.

## If publication fails

- For an authentication error, verify the exact trusted-publisher fields above
  and direct-publish permission. The publish job alone has `id-token: write`.
  OIDC requires npm 11.5.1+ and Node 22.14+; the workflow uses current Node 24.
- For a registry/network error, retry the failed workflow after the service
  recovers. The version check fails closed on registry errors.
- Once the problem is fixed, use **Re-run failed jobs** on the main-branch run.
  First check `npm view debug-run@<version> version`; an upload may have succeeded
  before a later failure. Already-published versions are skipped on retry.
- npm versions are immutable. If a published release needs a fix, prepare a new
  version and PR instead of trying to overwrite it.

For a deliberate manual fallback, check out the exact merged release commit,
run `npm ci`, `npm run check`, `npm audit`, and `npm run test:package`, then use
`npm login`, `npm whoami`, and `npm publish --access public`. Interactive publishing
requires the npm account's authentication/2FA. Coordinate with CI to avoid two
publish attempts; local publishing does not get CI provenance automatically.

References: [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/)
and [npm publish](https://docs.npmjs.com/cli/commands/npm-publish).

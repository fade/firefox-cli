This page records major dependency migration plans required by the dependency-upgrade policy in `docs/development.md`.

## 2026-07-16 TypeScript, Node, and Dependency Refresh

Scope:

- TypeScript 7 for compiler and build commands.
- TypeScript 6 for tools that consume the legacy TypeScript compiler API.
- `@types/node` 26.
- Aged patch and minor tooling upgrades plus transitive security fixes.

Release-age evidence as of 2026-07-16:

- `typescript` 7.0.2 was published on 2026-07-08.
- `@types/node` 26.0.0 was published on 2026-06-19. Installed `@types/node` 26.1.1 was published on 2026-07-08.
- TypeScript 7 and `@types/node` 26 are explicit exceptions to the 30-day major-upgrade release-age gate.

Migration plan:

- Install the TypeScript 7 package under the `@typescript/native` alias so its `tsc` binary owns compiler and build commands.
- Keep TypeScript 6 under the `typescript` package name for ESLint and repository policy scripts that require the legacy synchronous compiler API.
- Route workspace typecheck scripts through the root-owned TypeScript 7 command as the designated compiler binary.
- Remove `baseUrl` and the TypeScript 6 deprecation suppression while keeping workspace aliases relative to `tsconfig.base.json`.
- Resolve TypeScript 7 and Node 26 diagnostics at their source without compatibility shims.
- Pin `undici` 7.28.0 and `js-yaml` 4.3.0 within their parent dependency ranges to remove audited vulnerabilities, and raise the `shell-quote` override to 1.9.0.
- Guard the compiler/tooling package split in the TypeScript configuration policy tests.

Verification:

- `bun run deps:check`
- `bun run check`
- `bun run release:check:local`

Rollback scope:

- Revert `package.json`, `bun.lock`, `dependency-policy.json`, TypeScript configuration, policy tests, and source compatibility edits in the same change.

## 2026-06-11 Development Tooling

Scope:

- `eslint` 10 and `@eslint/js` 10.
- `@types/node` 25.
- `typescript` 6.
- `vite` 8.

Release-age evidence as of 2026-06-11:

- `eslint` 10.0.0 was published on 2026-02-06. Installed `eslint` 10.4.1 was published on 2026-05-29.
- `@eslint/js` 10.0.1 was published on 2026-02-06.
- `@types/node` 25.0.0 was published on 2025-12-10. Installed `@types/node` 25.9.1 was published on 2026-05-19.
- Installed `typescript` 6.0.3 was published on 2026-04-16.
- `vite` 8.0.0 was published on 2026-03-12. Installed `vite` 8.0.16 was published on 2026-06-01.

Migration plan:

- Keep the existing ESLint flat config and attach caught errors as `cause` where ESLint 10 reports `preserve-caught-error`.
- Keep TypeScript path aliases and set `ignoreDeprecations` for the TypeScript 6 `baseUrl` deprecation until path aliasing is redesigned.
- Normalize Marionette socket chunks before `Buffer.concat` for the Node 25 type surface.
- Remove explicit `manualChunks: undefined` from the Vite extension build output, preserving Rollup's default chunking behavior.
- Update the Biome schema URL to match the installed Biome CLI.
- Use a Bun override for `shell-quote` 1.8.4 because `web-ext` 10.3.0 pins `fx-runner` 1.4.0, which pins vulnerable `shell-quote` 1.7.3.

Verification:

- `bun run deps:check`
- `bun run check`
- `bun run release:check:local`

Rollback scope:

- Revert `package.json`, `bun.lock`, and the TypeScript, ESLint, Biome, Vite, and Marionette compatibility edits in the same change.

## 2026-10-14 Workspace dependency refresh

Scope:

- `@types/jsdom` 30 and `jsdom` 30.
- `vitest` 5.
- `@biomejs/biome` 2.5.15 and age-eligible ESLint, Vite, type, and tooling releases.
- Age-eligible patch and minor updates across workspace dependencies.
- Security updates for vulnerable transitive dependencies and root overrides.

Release-age evidence as of 2026-10-17:

- `@types/jsdom` 30.0.0 was published on 2026-08-07.
- The selected releases, `jsdom` 30.0.1 and `vitest` 5.0.1, were published on 2026-07-29 and 2026-09-15 and meet the 30-day release-age requirement.
- `jsdom` 30.1.0 has a [documented focus/blur regression](https://github.com/jsdom/jsdom/issues/4347). Later patch releases were younger than 30 days on 2026-10-17.
- `mime` 4.1.0 was published on 2025-09-12. `mime` 4.1.1 was published on 2026-10-12 and is younger than the seven-day patch/minor release-age threshold.
- Security overrides use `js-yaml` 4.3.2, `shell-quote` 1.11.0, and `undici` 7.29.1.
- GHSA-86w9-cpqp-85rv affects `node-forge` 1.4.0 through `web-ext`'s ADB dependency chain. GitHub lists no patched version.

Migration plan:

- Upgrade `jsdom` with `@types/jsdom` to keep the runtime and declarations aligned.
- Upgrade `vitest` and run the existing workspace test suite.
- Keep TypeScript 6 for the legacy compiler API and TypeScript 7 under `@typescript/native` for compiler and build commands.
- Apply the minimum audit-backed versions for `js-yaml`, `shell-quote`, and `undici`.
- Update patch and minor dependencies through the repository's age-gated dependency lane.
- Migrate the Biome schema URL to the installed CLI version.
- Bind captured console methods to their receiver and restore each original console property descriptor.
- Ignore only GHSA-86w9-cpqp-85rv in `deps:check` and print a warning until upstream publishes a `node-forge` fix.

Verification:

- `bun run deps:check`
- `bun run check`
- `bun run release:check:local`

Rollback scope:

- Revert workspace dependency manifests, `bun.lock`, and this migration record together.

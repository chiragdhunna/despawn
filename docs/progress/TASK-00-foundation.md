# TASK-00: Repository foundation

## Summary
Initialized the Despawn monorepo with pnpm workspaces, strict TypeScript configuration, ESLint flat config, Prettier, and Vitest. Scaffolded seven internal packages under `packages/` and two platform adapters under `adapters/`, each exporting `VERSION = '0.0.0'` and verified with a smoke test. Created minimal Vite starter apps for `apps/owner` (React) and `apps/viewer` (vanilla TypeScript targeting ES2018 with zero runtime dependencies). Set up GitHub Actions CI workflow to validate linting, formatting, typechecking, tests, and builds on push and pull requests to `main`. Added root repository files (`.gitignore`, `.editorconfig`, `.nvmrc`, `LICENSE`, `SECURITY.md`, `CONTRIBUTING.md`) and a Development section to `README.md`.

## Changes
- `AGENTS.md`: Tracked agent working guidelines unchanged.
- `.gitignore`: Configured ignored files and directories for workspace, artifacts, caches, and environment files.
- `.editorconfig`: Defined UTF-8, LF, 2-space indent, and newline rules across files.
- `.nvmrc`: Set Node.js version to 22.
- `LICENSE`: Added full Apache License 2.0 with copyright notice.
- `SECURITY.md`: Defined vulnerability reporting policy via GitHub Security Advisories on best-effort basis.
- `CONTRIBUTING.md`: Added contribution guidelines, root workspace commands, commit rules, and agent pointer.
- `pnpm-workspace.yaml`: Configured workspace patterns for `apps/*`, `packages/*`, and `adapters/*`.
- `package.json`: Configured root scripts (`build`, `lint`, `format`, `format:check`, `typecheck`, `test`, `clean`), packageManager (`pnpm@10.34.9`), and root devDependencies.
- `pnpm-lock.yaml`: Committed workspace dependency lockfile.
- `tsconfig.base.json`: Base TypeScript compiler options with strict checks, `moduleResolution: "Bundler"`, `target: "ES2022"`.
- `eslint.config.js`: ESLint flat configuration with typescript-eslint enforcing no-explicit-any, no-eval, and no-implied-eval.
- `.prettierrc`: Prettier formatting configuration (single quotes, semicolons, trailing commas "all", printWidth 100).
- `.prettierignore`: Configured Prettier ignore rules to protect specs, assets, and build outputs.
- `vitest.config.ts`: Workspace test configuration running smoke tests across packages and adapters.
- `packages/protocol`: Package scaffold with index export, tsconfig, and smoke test.
- `packages/crypto`: Package scaffold with index export, tsconfig, and smoke test.
- `packages/bundle`: Package scaffold with index export, tsconfig, and smoke test.
- `packages/render`: Package scaffold with index export, tsconfig, and smoke test.
- `packages/compose`: Package scaffold with index export, tsconfig, and smoke test.
- `packages/ui`: Package scaffold with index export, tsconfig, and smoke test.
- `packages/server-core`: Package scaffold with index export, tsconfig, and smoke test.
- `adapters/node`: Adapter scaffold with index export, tsconfig, and smoke test.
- `adapters/cloudflare`: Adapter scaffold with index export, tsconfig, and smoke test.
- `apps/owner`: Minimal Vite + React + TypeScript app rendering owner app title and protocol VERSION.
- `apps/viewer`: Minimal Vite + vanilla TypeScript app targeting ES2018 with zero runtime dependencies.
- `.github/workflows/ci.yml`: GitHub Actions CI pipeline running lint, format check, typecheck, test, and build.
- `README.md`: Added Development section documenting prerequisites, install, root commands, and directory structure.
- `docs/progress/TASK-00-foundation.md`: Progress report documenting implementation and verification details.

## Verification
- `pnpm install`: Pass. Installed workspace dependencies from lockfile in 660ms with pnpm 10.34.9.
- `pnpm lint`: Pass. ESLint completed with 0 errors across all workspace files.
- `pnpm format:check`: Pass. Prettier verified that all workspace files adhere to formatting rules.
- `pnpm typecheck`: Pass. `tsc --noEmit` passed on all 11 workspace packages and applications.
- `pnpm test`: Pass. Vitest ran 9 smoke test suites (9 tests passed).
- `pnpm build`: Pass. Vite built `apps/owner` (`dist/assets/index-*.js`, 219.65 kB) and `apps/viewer` (`dist/assets/index-*.js`, 0.89 kB).
- ES2018 viewer check: Pass. Inspected `apps/viewer/dist/assets/index-*.js` and parsed via TypeScript AST targeting `ES2018` with regex checks for modern tokens (`?.`, `??`, logical assignments, private fields, `.replaceAll`, `.at`), confirming zero modern-only syntax beyond ES2018.

## Dependencies added
| Name | Version | Licence | Size | Reason |
|---|---|---|---|---|
| `@eslint/js` | 9.39.5 | MIT | ~13 kB | ESLint JS recommended rules |
| `eslint` | 9.39.5 | MIT | ~3.0 MB | Linter engine |
| `prettier` | 3.10.1 | MIT | ~9.0 MB | Code formatting |
| `typescript` | 5.9.3 | Apache-2.0 | ~40 MB | TypeScript compiler and typechecker |
| `typescript-eslint` | 8.72.2 | MIT | ~2.5 MB | TypeScript parser and rules for ESLint |
| `vitest` | 3.2.7 | MIT | ~4.0 MB | Workspace test runner |
| `react` | 19.3.1 | MIT | ~316 kB | UI library for owner application |
| `react-dom` | 19.3.1 | MIT | ~2.6 MB | DOM renderer for React |
| `@types/react` | 19.3.0 | MIT | ~1.8 MB | TypeScript definitions for React |
| `@types/react-dom` | 19.3.0 | MIT | ~130 kB | TypeScript definitions for React DOM |
| `@vitejs/plugin-react` | 6.3.0 | MIT | ~70 kB | React plugin for Vite bundler |
| `vite` | 8.3.8 | MIT | ~14 MB | Build tool and dev server for web apps |

## Decisions made
- Configured `.prettierignore` to protect existing spec documents (`docs/**`), design tokens (`design/**`), assets (`assets/**`), and `README.md` from automatic table reformatting while enforcing formatting on new codebase files.
- Used `test.projects: ['packages/*', 'adapters/*']` in `vitest.config.ts` rather than `vitest.workspace.ts` to avoid Vitest workspace file deprecation warnings.
- Implemented `clean` script using cross-platform Node.js `fs.rmSync` in root and packages/apps scripts to avoid OS-dependent shell commands.

## Spec issues
none

## Noticed, not done
1. Vitest logged a warning that `esbuild@0.28.2` build scripts were ignored by pnpm; consider configuring `onlyBuiltDependencies` if native esbuild acceleration is desired in future tasks.
2. `adapters/aws` is referenced in `docs/ARCHITECTURE.md` section 12, but was not in the Task 0 prompt list of packages to scaffold.

## Commits
- `90434e4`: docs: add agent working rules
- `a9e5bb8`: chore: add repo config, license, and guidelines
- `bda8a8d`: chore: configure pnpm workspace, typescript, and tooling
- `2d5ac6a`: feat: scaffold packages and adapters skeletons
- `10ac173`: feat: scaffold owner and viewer applications
- `46d5761`: ci: add GitHub Actions continuous integration workflow
- `1a8890b`: docs: add development section to README

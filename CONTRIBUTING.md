# Contributing to Despawn

Thank you for contributing to Despawn!

## Development Setup

Prerequisites:
- Node.js >= 22 (see `.nvmrc`)
- pnpm 10.x

Clone the repository and install dependencies:
```bash
git clone https://github.com/chiragdhunna/despawn.git
cd despawn
pnpm install
```

## Workspace Commands

The following commands run across the monorepo from the root:
- `pnpm build`: Build all packages and applications
- `pnpm lint`: Run ESLint across workspace code
- `pnpm format`: Format files using Prettier
- `pnpm format:check`: Check formatting using Prettier
- `pnpm typecheck`: Run TypeScript type-checking across all packages and apps
- `pnpm test`: Run test suites using Vitest
- `pnpm clean`: Remove build artifacts and caches

## Commit Conventions

All commits must follow [Conventional Commits](https://www.conventionalcommits.org/):
- Prefixes: `feat:`, `fix:`, `docs:`, `chore:`, `test:`, `ci:`, `refactor:`
- Imperative mood, under 72 characters in subject line.

## AI Agents

AI coding agents working on this repository must read and strictly adhere to [AGENTS.md](AGENTS.md).

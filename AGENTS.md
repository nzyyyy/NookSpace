# Repository Guidelines

## Project Structure & Module Organization

NookSpace is a Tauri 2 desktop app with a React 19 frontend. Frontend code lives in `src/`: feature UI is grouped under `src/features/`, reusable primitives under `src/components/`, Zustand state under `src/stores/`, typed Tauri calls in `src/core/ipc.ts`, and shared helpers in `src/lib/`. Static assets belong in `public/`; product and architecture notes live in `docs/` and `docs/adr/`.

Rust code lives in `src-tauri/src/`. Keep commands thin in `commands.rs`; database, filesystem, import, and native behavior belong behind the `Library` module in `library/`. SQL migrations are in `src-tauri/src/library/migrations/`. Cross-runtime Node tests live in `tests/`.

## Architecture Boundary

Keep business rules, workflows, orchestration, and UI behavior in React + TypeScript. Rust should expose narrow IPC for capabilities that require it, such as SQLite, filesystem access, imports, QuickLook, or native dialogs. Avoid duplicating domain logic across runtimes.

## Build, Test, and Development Commands

- `pnpm install` installs the pinned pnpm dependencies.
- `pnpm tauri dev` runs the full desktop app with Vite hot reload.
- `pnpm dev` runs only the frontend development server.
- `pnpm test` runs Node's built-in test runner against `tests/*.test.mjs`.
- `pnpm build` type-checks TypeScript and creates the production frontend bundle.
- `cargo test --manifest-path src-tauri/Cargo.toml` runs Rust unit tests.
- `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check` checks Rust formatting.

Before opening a PR, run both test commands and `pnpm build`.

## Coding Style & Naming Conventions

Use two-space indentation and semicolons in TypeScript/TSX. Name React components and files in `PascalCase`, hooks as `useSomething`, stores/utilities in `camelCase`, and Rust functions/modules in `snake_case`. Prefer the `@/` frontend alias over long relative imports. Run `cargo fmt` for Rust changes. Keep IPC types mirrored between `src/core/ipc.ts` and Rust models, and reuse the existing `Library` boundary instead of issuing SQL from commands or UI code.

## Testing Guidelines

Use `node:test` plus `node:assert/strict`; name frontend logic tests `tests/<area>.test.mjs`. Put focused Rust tests in `#[cfg(test)]` modules near the behavior. Cover data-loss paths, transaction validation, recursive collection behavior, and stale-response handling. UI changes should include a manual Tauri-window check; attach screenshots when appearance changes.

## Commit & Pull Request Guidelines

History follows Conventional Commit-style subjects, for example `feat: v0.2 阅读与整理基础`. Use concise imperative prefixes such as `feat:`, `fix:`, `docs:`, or `test:`. PRs should explain user-visible behavior, list verification commands, link the relevant issue or product section, and call out schema or filesystem effects. Never commit local library data, generated `dist/`, or secrets.

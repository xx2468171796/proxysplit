# ProxySplit — agent entry point

Per-app proxy client for Windows (Go 1.26 + Wails 2 + sing-box TUN) with a commercial backend in `server/`.

## Read first
- `.ankotti/MEMORY.md` — live state, red lines, routing table to `docs/memory/<topic>.md`. Look things up with `node ~/.ankotti/ai-kit/mem.mjs <keywords>`; never read `docs/decisions.md` whole.
- `docs/architecture.md` — scale, module layout, invariants, acceptance checklist. A new domain or a boundary change updates it first.
- Company process: `standards_get name=project-design` (design), `standards_get name=change-workflow` (every change to this repo).

## Layout
- `*.go` (root) — Wails app bindings; `internal/` — core (sing-box config), service, updater, license, accel, aiguard …; `cmd/` — dev / test tools.
- `frontend/` — React 19 + `@ankotti/admin-ui`, layers `api / state / features / app`; `frontend/wailsjs/` is generated.
- `server/` — commercial API and admin console (pnpm workspace).
- `website/` — official site (React + `@ankotti/admin-ui` + dongxiao effects, standalone Vite); `pnpm --dir website check` includes the first-screen bundle gate; release copies `website/dist` into `apps/site`. Screenshots in `website/public/shots/` come from `pnpm --dir frontend dev` with `?showcase=1`.
- `scripts/` — builds and releases; `docs/` — design docs, `docs/memory/` topic notes, `docs/archive/` old material.

## Gates (run before handing back)
- Go: `go vet ./...` and `go test ./...`.
- Website: `pnpm --dir website check`.
- Frontend: `pnpm --dir frontend check` (typecheck, Biome, Vitest, admin-ui-audit, size). Preview without Wails: `pnpm --dir frontend dev` (mock backend; `?theme=dark`, `?gate=login|member`, `?split=1`, `?update=1|force`).

## Release
- Client only: `docs/memory/release-process.md` (signed build → Shenzhen incoming → `publish-client.py` → register → promote → verify). Whole site: `docs/RELEASE-PROCESS.md`.
- Signing key = bastion asset 116, written to `server/secrets/` only for the build and deleted right after. Never commit secrets, node links or tokens.

## Repo hygiene
- Build output goes to `output/` (keep only the last two releases locally; every version stays on the server) and `build/bin/`; both are git-ignored.
- Scratch work lives outside the repo and is deleted when done; merged branches are deleted locally and on both remotes (`gitea`, `origin`).

<!-- @format -->

# `apps/yourapps` (`Xernerx/yourapps`) — Agent Guidelines (`AGENTS.md`)

## 🧭 Overview

`d:\Xernerx Studios\apps\yourapps` is the standalone **YourApps** Discord-native forms and applications bot repository built on `@xernerx/framework`, `@xernerx/commands`, `@xernerx/stats`, `@xernerx/hooks`, `@xernerx/terminal`, and `@xernerx/websocket`.

## 🏗️ Key Modules (`src/`)

- `src/shard.ts`: Default entry point (`"main": "dist/shard.js"`) scaling `dist/main.js` across shards/clusters via `XernerxShardClient` (`totalShards: 'auto'`) and reporting aggregated multi-shard telemetry via `XernerxStats`.
- `src/main.ts`: Per-shard `XernerxClient` bootstrap (`intents: ['Guilds', 'GuildMessages']` — strictly no `MessageContent` intent and zero direct database connections; uses `API_TOKEN` for HTTP SDKs and `WS_TOKEN` for `@xernerx/websocket`).
- `src/lib/endpoints.ts`: Environment-aware endpoint helper (`DEVELOPMENT` routes to `*.dev.xernerx.com`; `CANARY` and `PRODUCTION` route to `*.xernerx.com`, with optional `API_URL`, `WS_URL`, `APP_URL` overrides).
- `src/commands/slash/{positions,review,submissions,setup,info}.ts`:
  - `/positions`: Components V2 viewer for open and configured application/poll positions with `Apply in Discord` / `Vote in Discord` (`LabelBuilder` across all 13 Modal V2 question types, dynamic conditional skip logic, min/max & regex validation, sequential modal chaining, and resumable drafts) and `Apply on Web`.
  - `/review`: Interactive Reviewer Queue across active submissions (`pending`, `interview`, `needs_info`) with Upvote/Downvote scorecards, Auto-Consensus thresholds, Staff-Only Internal Notes, Applicant Clarification requests, 1-Click Private Interview Threads/Channels, and Approve/Deny workflows.
  - `/submissions`: Components V2 submission list & inspector with optional `user` filter, status filtering across all 6 lifecycle states, and applicant self-service (`Answer Follow-Up` & `Withdraw`).
  - `/setup`: Checks whether the server has a `guilds.profiles` record (creating it if missing to mitigate pre-existing servers), syncs server metadata, and redirects admins directly to the Xernerx Dashboard (`?tab=applications`).
  - `/info`: Bot statistics, runtime telemetry, versions, and credits (matching `apps/virtue`).
- `src/commands/context/applications.ts`: User context menu (`Applications`) for quick submission history inspection.
- `src/events/{clientReady,guildCreate,guildDelete,autocompleteInteraction,buttonInteraction,selectMenuInteraction,modalInteraction}.ts`: Interaction routers, 60s WebSocket health/presence + scheduled open/close & live Apply panel sync, and `guilds.profiles` lifecycle (`guildCreate` creates profile, `guildDelete` deletes profile).
- `src/lib/{applicationFlow,reviewFlow,validation,permissions,guildSync}.ts`: Dynamic conditional form runner, validation engine, persistent draft syncing, full Components V2 (`MessageFlags.IsComponentsV2`) rendering across auto-synced Apply panels, submission log cards, archive cards, interview rooms, and applicant DMs, lifecycle role automation (`pendingRoles`, `rewardRoles`/`removeRoles`, `denyAddRoles`/`denyRemoveRoles`), native Discord staff polls, and `APIInteractionGuildMember`-safe permission checks.

## ⚠️ Important Rules

1. **Zero Database Connection in Bot & Zero `MessageContent`:** All persistence flows strictly through `@xernerx/websocket` (`yourapps` service in `../../suite/services/websocket/src/app/yourapps/server.ts`, backed by `/guilds` database collections `profiles`, `forms`, `submissions`, and `drafts`). Never add a direct MongoDB/database driver to `apps/yourapps`, and never request the `MessageContent` gateway intent.
2. **Dashboard-First Guild & Form Setup:** All server channel/role settings, auto-synced Apply panel deployments, and position/question creation live on the Xernerx Server Dashboard (`?tab=applications`); `/setup` redirects admins to the Dashboard, and destructive `Delete YourApps Setup` controls live exclusively in Dashboard `Settings.tsx` (never on the individual bot tab).
3. **Cross-Repo Sync with `suite` & `.github`:**
   - Keep `LICENSE` byte-for-byte identical to `../../suite/LICENSE` and `PLAIN_TEXT_LICENSE` in `../../suite/apps/www/src/app/license/page.tsx`.
   - Keep dashboard features (`../../suite/apps/app/src/components/dashboard/applications/*`), API routes (`../../suite/apps/api/src/app/secure/guilds/[id]/applications/*`), WebSocket actions, docs, and policy pages in sync.

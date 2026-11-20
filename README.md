<!-- @format -->

<p align="center">
  <img src="https://www.xernerx.com/banner.png" alt="YourApps — Xernerx Studios" width="100%" />
</p>

# YourApps — Discord-Native Forms & Applications Bot

**YourApps** is the official Discord-native forms, staff recruitment, and community applications bot by **Xernerx Studios**, built on [`@xernerx/framework`](https://docs.xernerx.com/packages/@xernerx/framework), [`@xernerx/commands`](https://docs.xernerx.com/packages/@xernerx/commands), [`@xernerx/stats`](https://docs.xernerx.com/packages/@xernerx/stats), [`@xernerx/terminal`](https://docs.xernerx.com/packages/@xernerx/terminal), and [`@xernerx/websocket`](https://docs.xernerx.com/packages/@xernerx/websocket).

- **Server Applications Dashboard:** [https://app.xernerx.com/dashboard?tab=applications](https://app.xernerx.com/dashboard?tab=applications)
- **Developer Documentation:** [https://docs.xernerx.com](https://docs.xernerx.com)

---

## ✨ Core Features & Architecture

- **Dashboard Setup + Seamless Discord & Web Experience:** Server admins configure channels, roles, starter templates, multi-step forms, native Discord polls, and auto-synced Components V2 Apply panels visually on the **Xernerx Server Dashboard** (`?tab=applications`), while applicants can apply either inside Discord (`/positions`) or on the web (`/servers/[id]/applications/[appId]`).
- **Conditional Modal V2 & Resumable Draft Engine (`src/lib/applicationFlow.ts`):** Launches native Discord Modal V2 forms (`LabelBuilder` across all 13 question types: Short Text, Paragraph, Number, Dropdown Menu, Radio Group, Checkbox Group, Yes/No, Single Checkbox, User/Role/Channel/Mentionable pickers, and File Uploads) with conditional skip logic, regex & min/max validation, scheduled open/close windows, submission/spot caps, anonymous responses, and cross-platform draft persistence.
- **Consensus Review, Interviews & Role Automation (`src/lib/reviewFlow.ts`):** Staff review submissions via Components V2 cards in `logChannel`, `/review`, `/submissions`, or the Dashboard—complete with upvote/downvote consensus thresholds, staff-only internal notes, applicant follow-up clarifications, 1-click private interview threads/channels, lifecycle role triggers (`pendingRoles`, `rewardRoles`/`removeRoles`, `denyAddRoles`/`denyRemoveRoles`), `archiveChannel` transcripts, and optional DMs.
- **Strict Data Minimization (`Zero Message Content` & `Zero Bot DB`):** Connects without the privileged `MessageContent` intent and communicates exclusively through `@xernerx/websocket` to the Xernerx Suite backend.

---

## 📄 License

Proprietary software governed by the **[Xernerx Studios Proprietary & SaaS License v1.0](https://xernerx.com/license)**. See [`LICENSE`](./LICENSE) for full terms.

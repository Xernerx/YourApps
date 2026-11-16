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

- **Dashboard Setup + Seamless Discord Experience:** Server admins configure channels, roles, multi-step application forms, and interactive Apply panels visually on the **Xernerx Server Dashboard** (`?tab=applications` via `/setup`), while applicants and reviewers submit and review everything natively inside Discord.
- **Modal V2 & Resumable Draft Engine (`src/lib/applicationFlow.ts`):** Launches native Discord Modal V2 forms (`LabelBuilder` supporting all 13 question types: Short Text, Paragraph, Number, Dropdown Menu, Radio Group, Checkbox Group, Yes/No, Single Checkbox, User/Role/Channel/Mentionable pickers, and File Uploads) for 1–5 questions and a paginated multi-modal Form Runner with automatic draft persistence for 6–25 question forms—never failing when applicants have Direct Messages disabled.
- **Automated Role & Archive Workflows (`src/lib/reviewFlow.ts`):** Approving an application automatically grants `rewardRoles`, strips `removeRoles`, updates the live review card in `logChannel`, archives the decision to `archiveChannel`, and optionally notifies the applicant via DM.
- **Strict Data Minimization (`Zero Message Content` & `Zero Bot DB`):** Connects without the privileged `MessageContent` intent and communicates exclusively through `@xernerx/websocket` to the Xernerx Suite backend.

---

## 📄 License

Proprietary software governed by the **[Xernerx Studios Proprietary & SaaS License v1.0](https://xernerx.com/license)**. See [`LICENSE`](./LICENSE) for full terms.

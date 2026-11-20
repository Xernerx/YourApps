# yourapps

## 6.1.0

### Minor Changes

- ## Conditional Forms, Consensus Review, Interview Rooms & Components V2 Panels
  
  Upgraded YourApps with conditional form logic, staff consensus voting, private interview rooms, applicant clarifications, scheduled open/close windows, and full Discord Components V2 Apply panels and review cards.
  
  ### Added
  
  - **Conditional Skip Logic & Answer Validation**: Show or skip questions dynamically based on earlier answers (`equals`, `not equals`, or `contains`) and validate text or numeric responses with length bounds, min/max values, URLs, emails, Discord IDs, or custom patterns.
  - **Staff Consensus Voting, Internal Notes & Follow-Up Clarifications**: Reviewers can upvote or downvote submissions with optional auto-approve and auto-deny vote thresholds, attach private staff-only notes, and request follow-up clarifications that applicants can answer directly in Discord or on the web.
  - **1-Click Private Interview Rooms & Native Staff Polls**: Open private interview threads or channels between applicants and reviewers directly from a submission card, and optionally attach native Discord polls to incoming applications.
  - **Scheduled Windows, Submission Caps & Anonymous Forms**: Schedule automatic open and close dates, auto-close positions once submission or approval caps are reached, and run anonymous polls or feedback forms that hide applicant identities from staff views.
  - **Applicant Self-Service Controls**: Applicants can answer follow-up clarification prompts or withdraw active applications directly from `/submissions` or their Direct Messages.
  
  ### Changed
  
  - **Components V2 Apply Panels, Review Cards & DMs**: Upgraded live channel Apply panels, submission log cards, archive transcripts, interview room cards, and applicant Direct Messages to native Discord Components V2 layouts—rendering inline 1-click Apply/Vote buttons for up to 8 positions and automatic dropdown selectors for larger forms.
  - **Automatic Apply Panel Synchronization**: Selecting or changing a server's Apply Panel Channel automatically publishes, moves, self-heals, or cleans up the live Discord Apply panel and keeps position availability synced in real time.
  - **Full Lifecycle Role Triggers & Modal Reliability**: Expanded automatic role actions to cover pending submission roles, approval grant/remove roles, and denial grant/remove roles while improving modal responsiveness and role permission checks across servers.

## 1.0.0

### Major Changes

- ## YourApps 1.0 — Xernerx Suite Launch
  
  Rebuilt from the ground up on the Xernerx ecosystem with native Discord Modals V2, Components V2 interfaces, web application portals, and Server Dashboard configuration.
  
  ### Added
  
  - **13-Type Application Forms & Modals V2**: Support for Short Text, Paragraph, Number, Dropdown Menu, Radio Group, Multi-Select Checkbox Group, Custom Yes/No, Checkbox, User, Role, Channel, Mentionable, and File Upload questions—launching sequential modals in Discord with automatic draft saving.
  - **Dual Discord & Web Application Portals**: Apply directly inside Discord (`/positions` and interactive channel Apply panels) or on the web from each server's application portal.
  - **Components V2 Reviewer Queue & Submissions Explorer**: Review pending applications, filter submissions by member or status (`/review`, `/submissions`, and the `Applications` user context menu), or open submissions directly in the Server Dashboard.
  - **Dashboard-First Server Setup & Automated Role Workflows**: Configure channels, reviewer permissions, eligibility rules, and automatic approval/denial role rewards on the Xernerx Server Dashboard via `/setup`, with automatic profile initialization for existing servers.
  - **Auto-Scaling Multi-Shard Architecture**: Built-in sharding support for reliable operation across thousands of Discord servers.

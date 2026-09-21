# Releases

## v0.2.1 — 2026-09-21

Patch release for Windows first-run setup.

- Fixed the `bootstrap.ps1` credential check so PowerShell reliably invokes Bun without corrupting the SQLite query.
- First-run password setup now proceeds normally when no saved owner credential exists.

## v0.2.0 — 2026-09-20

First public DIY self-hosting release.

- Added the Windows `bootstrap.ps1` launcher, including first-run owner-password setup, background startup, LAN verification, logs, and safe stop instructions.
- Added portable Full ZIP backup and restore with original attachments, integrity checks, shared maintenance links, attachment ordering, and legacy JSON import support.
- Improved vehicle selection, parts and consumable workflows, attachment previews and ordering, maintenance detail state, and mobile/table usability.
- Added calculator tools and expanded workflow, accessibility, API, self-hosting, and user documentation.

SumpLog is designed for one owner running it on their own Windows PC or server. Use a trusted LAN, NetBird, or Tailscale for remote access; do not expose port 3000 directly to the internet.

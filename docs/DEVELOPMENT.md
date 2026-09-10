# Development guide

## Prerequisites

- Bun 1.3 or a compatible newer release
- A current Chromium, Firefox, or Safari browser
- Build tools supported by the installed `sharp` package when a prebuilt binary is unavailable

## Commands

| Command | Result |
| --- | --- |
| `bun install` | Install dependencies |
| `bun run dev` | Run Vite on 5173 and hot-reloading Hono on 3000 |
| `bun run build` | Type-check and build the browser application |
| `bun run start` | Apply migrations and serve API plus `dist` on 3000 |
| `bun run db:generate` | Generate a migration from Drizzle schema changes |
| `bun run db:migrate` | Apply pending migrations explicitly |
| `bun run db:seed` | Seed demo data only when the vehicle table is empty |
| `bun test` | Run Bun unit, component, and API tests |
| `bun run check` | Run the production build and all tests |

The development client should be opened at `http://localhost:5173`; opening port 3000 before a build provides the API but may not provide a current client.

## Safe test isolation

API tests configure a regression database and upload directory before importing the server application. Do not point tests at `data/sumplog.db` or `data/uploads`. Test cleanup must close SQLite and remove only the resolved regression directory.

The suite covers API workflows and security, CSV escaping, formatting and mileage projection, calculators, vehicle deletion confirmation, top-bar semantics, and keyboard/accessibility behavior. A passing automated suite does not replace responsive testing of actual browser layout or a restore rehearsal using disposable data.

## Schema changes

1. Update `server/db/schema.ts`.
2. Run `bun run db:generate` and inspect the new SQL in `drizzle/`.
3. Add or update API tests for forward migration and the changed workflow.
4. Update backup validation and compatibility materialization when a new table or required relationship is added.
5. Update the architecture, API, user, and hosting documentation affected by the change.
6. Run `bun run check` against an isolated test directory.

Never edit an already released migration. Add a new ordered migration instead.

## UI conventions

- Keep the approved dark, clean parts-counter visual language; report/PDF backgrounds remain print-friendly.
- Every vehicle-scoped page must display the selected vehicle context.
- Use dropdowns populated from stored values where sensible and retain a custom-entry path.
- Desktop data views use sortable tables. Narrow containers switch to compact rows with primary data visible and secondary details expandable.
- Row disclosure must work by mouse, touch, Enter, and Space, and expose expanded state.
- Icon-only actions require accessible names, visible focus, and at least a practical touch target.
- Images use lazy reduced-size previews; editors request larger derivatives, and originals remain available.
- Destructive actions explain scope and require confirmation proportional to their impact.

## Definition of done

Before calling a change complete:

1. Run `bun run check`.
2. Exercise the affected create, edit, cancel, error, and delete paths with disposable records.
3. Check keyboard operation and focus return for affected dialogs and disclosures.
4. Check 320, 375, 414, 768, 1024, and 1440 px widths when layout changed.
5. Confirm vehicle switching, filters, sorting, selection, exports, and dashboard counts remain synchronized when relevant.
6. Update every documentation page whose claims or procedures changed.

## Current product boundary

The repository implements a single-owner DIY garage. Unlimited DIY vehicles are supported. Multi-user accounts, roles, customer/shop workflows, commercial licensing, hosted billing, native mobile apps, background jobs, and automatic cloud synchronization are not implemented.

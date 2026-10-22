# Chicane (Kanboard plugin)

Watch a project as a race track. Each task is a corner, and a task with subtasks is a chicane with one
turn per subtask. Finished road is paved and the road ahead is raw. Each person's car sits on the task
they are working on, every comment is a spectator in the stands, and stalled or abandoned work leaves
hazards on the road. Swimlanes are parallel racing lanes on one shared track.

The track is private by default. A project manager can open it to members, or share it outside the board
through an unguessable link, with or without task details.

## Install

Download `Chicane-1.0.0.zip` from the releases page, or install it from ModMenu, and unzip it into
`plugins/Chicane/` (the zip's single top-level folder is `Chicane`). There is no schema: settings live in
project metadata. Requires Kanboard `>=1.2.47` and PHP `>=8.4`.

## Settings

Project managers open **Project → Race track** in the project sidebar.

| Setting | Metadata key | Values | Default |
|---|---|---|---|
| Visibility | `chicane.visibility` | `off`, `members`, `public`, `map_only` | `off` |
| Window (days) | `chicane.window_days` | 1–365: open tasks plus tasks closed in the last N days | 30 |
| Units | `chicane.units` | `subtask`, `complexity` | `subtask` |
| Share token | `chicane.token` | 64 hex characters (32 random bytes) | created on first use |

**Units** decide how far the course is, for the track, the HUD and the summary alike:

- `subtask`: each subtask is one unit, and a task with no subtasks is one unit.
- `complexity`: each task is `n = max(1, score, subtask count)` units. With subtasks, the done share is
  `floor(n × done subtasks ÷ subtasks)`, whether the task is open or closed, so a task closed with
  unfinished subtasks still has road to drive. With no subtasks, all `n` are done once the task closes.

When visibility is `public` or `map_only`, the settings page shows the share link and the summary link as
read-only fields to copy. **Replace share link** issues a new token, and the old link stops working at once.

## Columns

The track never reads a column's title for its own logic. Each column gets a role instead:

| Role | Column titles (any case) | On the track |
|---|---|---|
| in progress | `In progress`, `Work in progress`, `Doing`, `WIP` | cars park on its open tasks; tasks idle 3+ days drop debris |
| done | `Done` | its open tasks with unfinished subtasks leave potholes |

When no title matches a role, it falls back by position: done is the last column, and in progress is the
column just before the done one. A fallback never takes a column that already has a role. Kanboard's default
board (Backlog, Ready, Work in progress, Done) matches by title; a board named Todo, Building, Shipped gets
Building as in progress and Shipped as done. Open work runs done first, then in progress, then the other
columns from the end of the board back.

## Visibility modes

| Mode | Members' race page | Share link (`/race/{token}`) |
|---|---|---|
| `off` | no race view | 404 |
| `members` | full detail | 404 |
| `public` | full detail | full detail, for anyone with the link |
| `map_only` | full detail | the track only, for anyone with the link |

`map_only` keeps the track, progress, cars, crowd and hazards, and drops task titles, comment text and real
names; drivers become initials (the first letters of two words, or the first two letters of one). The
redaction happens on the server, so those details never reach the browser.

When visibility is anything but `off`, a **Race** link in the project menu opens the members' view.

## Routes

| Route | Access | Returns |
|---|---|---|
| `/chicane/{project_id}` | project members | race page, full detail |
| `/chicane/{project_id}/state.json` | project members | state JSON with an ETag |
| `/race/{token}` | public, when visibility is `public` or `map_only` | race page |
| `/race/{token}/state.json` | same | state JSON with an ETag, redacted when `map_only` |
| `/race/{token}/summary.json` | same | the summary below |

The JSON routes answer `If-None-Match` with `304 Not Modified`. The race page polls `state.json` every 20 s
while the tab is visible and eases from the old track to the new one. On return it replays the change
since your last visit; that last-seen state is kept in your browser's `localStorage` only.

## Summary JSON

`/race/{token}/summary.json` is a small, token-authed answer for Chat or a script:

```json
{
  "project_id": 25,
  "progress_pct": 42.9,
  "distance_to_finish": 4,
  "cars": [{ "user": "CS", "task_id": null }],
  "updated_at": 1761100000
}
```

| Key | Meaning |
|---|---|
| `project_id` | the project's id |
| `progress_pct` | units done ÷ all units, as a percentage rounded to one decimal (always a number with a decimal point, e.g. `80.0`) |
| `distance_to_finish` | units still to drive (the HUD's "units to the flag") |
| `cars` | one entry per member with an open task in the in-progress column (see Columns): `user` is the name, `task_id` that task |
| `updated_at` | Unix time the state was built |

Units follow the project's `chicane.units`. In `map_only`, `user` is the initials and `task_id` is `null`.

## Feeds

Chicane reads from sibling plugins when they are installed and loaded, and works without any of them.

| Plugin | Adds | Without it |
|---|---|---|
| Presence | online cars glow, offline cars dim | cars render neutral (`online` is `null`) |
| Agents | agent livery and a bot badge on agent-driven cars | `agent_uids` is `[]` |
| TimeReport | level and XP plate from tracked time in the window | the plate is hidden |
| DependencyPlugin | a UI for managing "is blocked by" links between tasks | add the links in Kanboard's own task links; the track reads those core links either way and marks blocked cars with a barrier and a yellow flag |

A feed whose query fails is logged and left absent; the track still renders.

## Content Security Policy

The race page runs under Kanboard's default CSP (`default-src 'self'`) unchanged. PixiJS 8.22 and GSAP 3.15
are vendored under `Assets/vendor/` (see `VERSIONS.md`), with Pixi's `unsafe-eval` shim so nothing needs
`unsafe-eval`, and the page config travels as an inline `application/json` block rather than a script.
The plugin never calls `setContentSecurityPolicy()`, because that would replace the policy app-wide.

## Screenshots

No release screenshots ship yet. To see the track, run the suite's harness from the `kanboard-plugins`
repo: `testing/import-board.sh <prod_project_id>` copies a board, read-only, into the local Kanboard on
`:8081`, where Chicane is mounted. Set the imported project's visibility under **Race track** and open
**Race**.

## Development

- PHP tests: `./testing/run-plugin-tests.sh Chicane` from `kanboard-plugins`.
- JS tests: `node --test 'Chicane/Test/js/*.test.mjs'` (zero dependencies).
- Releases: tag `vX.Y.Z` equal to the `plugin.json` version; CI zips the plugin and attaches it.

License: MIT.

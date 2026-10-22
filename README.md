# Chicane

A Kanboard plugin that renders a project as a race track: tasks are cars, columns are
sectors, finished work crosses the line.

- Per-project settings live under **Project → Race track** (project managers only).
- Visibility: `off` (default), `members`, `public` (share link, full view) or `map_only`
  (share link, track without task details).
- Share links are random 64-hex tokens; **Replace share link** invalidates the old one.

Requires Kanboard >= 1.2.47 and PHP >= 8.4. Recommends Presence, Agents, TimeReport and
DependencyPlugin; it works without them.

License: MIT.

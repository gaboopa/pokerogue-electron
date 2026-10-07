# ADR-0001: Profiles are userData directories

## Decision

A profile is a `userData` directory. The default profile remains at the original Electron `userData` location without moving files. Named profiles live under `<root>/Profiles/<name>/`, where `<root>` is the original `userData` location. `<root>/active-profile.json` records the active name, or `null` for the default profile. Keybindings and the active-profile record are shared at `<root>`; Save data, cheat settings, Backups, intent journal, retention and Updates derive from the active profile's `userData` directory. The app takes its single-instance lock at `<root>` before switching to the active profile, then restarts when switching.

## Rejected alternatives

- Electron session partitions would require the Backup inventory to be re-rooted.
- Moving the default profile into `Profiles/` would require a storage migration.

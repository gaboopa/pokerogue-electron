# PokeRogue Offline

This context is the desktop wrapper that packages an upstream PokeRogue revision for local play. It owns the offline experience and the user's local data, not the upstream game's mechanics.

## Language

**PokeRogue Offline**:
The standalone desktop application that packages the upstream game for offline play.
_Avoid_: wrapper, application

**Upstream game**:
The PokeRogue game revision and its assets packaged by PokeRogue Offline; gameplay concepts are included here only when they explain a wrapper decision.
_Avoid_: PokeRogue Offline, game build

**Save data**:
A player's locally persisted game progress and game state.
_Avoid_: saves, browser storage

**Backup**:
A restorable, integrity-checked snapshot of save data.
_Avoid_: save copy, archive

**Release**:
A versioned PokeRogue Offline distributable that includes a specific upstream-game revision.
_Avoid_: build, installer

**Release contract**:
The shared rules that determine whether a Release is valid for publication and Update.

**Offline play**:
Gameplay served only from the packaged upstream game, with no gameplay network access.
_Avoid_: disconnected mode, local mode

**Update**:
A user-initiated check for a newer release, followed by download verification before installation.
_Avoid_: release, upstream synchronization

**Upstream synchronization**:
The maintainer workflow that incorporates a newer upstream-game revision before it can appear in a release.
_Avoid_: update

**Local configuration**:
Wrapper-specific user preferences, including keybindings and cheat settings, that are kept separately from save data.
_Avoid_: save data, game state

# Desktop shortcuts and game keybindings

## Desktop shortcuts

- `Ctrl/Cmd+R` or `F5`: reload the game
- `F11`: toggle full screen
- `F12`: toggle Developer Tools
- `Ctrl/Cmd+Shift+W`: Wiki
- `Ctrl/Cmd+Shift+D`: Pokédex
- `Ctrl/Cmd+Shift+E`: SearchDex
- `Ctrl/Cmd+Shift+T`: type calculator
- `Ctrl/Cmd+Shift+B`: team builder
- `Ctrl/Cmd+Shift+S`: Smogon
- `Ctrl/Cmd+Shift+Y`: type chart
- `Ctrl/Cmd+Shift+H`: horizontal type chart

## Remapping game controls

Choose **Keybindings → Open Keybindings File** to open the writable
`keymap.json` stored in the application's user-data directory. Each property
maps a physical source key to the game key it should produce:

```json
{
  "W": "ArrowUp",
  "S": "ArrowDown",
  "Z": "Enter"
}
```

Supported values are letters, digits, `ArrowUp`, `ArrowDown`, `ArrowLeft`,
`ArrowRight`, `Space`, `Enter`, `Escape`, and `Tab`. Invalid entries are
ignored. Choose **Reload Keybindings** after saving, or return focus to the app;
choose **Reset to Defaults** to restore the original controls.

Shortcuts containing Ctrl/Cmd, Alt, or Meta are never remapped.

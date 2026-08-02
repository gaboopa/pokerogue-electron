export const WEB_UTILITIES = Object.freeze([
  { label: "Wiki", accelerator: "CommandOrControl+Shift+W", url: "https://wiki.pokerogue.net/" },
  { label: "Pokédex", accelerator: "CommandOrControl+Shift+D", url: "https://wiki.pokerogue.net/dex:pokedex" },
  { label: "SearchDex", accelerator: "CommandOrControl+Shift+E", url: "https://sandstormer.github.io/PokeRogue-Dex/" },
  { label: "Type Calculator", accelerator: "CommandOrControl+Shift+T", url: "https://www.pkmn.help/" },
  { label: "Team Builder", accelerator: "CommandOrControl+Shift+B", url: "https://marriland.com/tools/team-builder/" },
  { label: "Smogon", accelerator: "CommandOrControl+Shift+S", url: "https://www.smogon.com/dex/sv/pokemon/" },
]);
export const CHART_UTILITIES = Object.freeze([
  { id: "type-chart", label: "Type Chart", accelerator: "CommandOrControl+Shift+Y", asset: "type-chart.png", width: 670, height: 1000 },
  { id: "horizontal-type-chart", label: "Horizontal Type Chart", accelerator: "CommandOrControl+Shift+H", asset: "type-chart-2.png", width: 1300, height: 600 },
]);
export function createUtilitiesSubmenu({ openExternal, openChart }) {
  return [...WEB_UTILITIES.map(item => ({ label: item.label, accelerator: item.accelerator, click: () => openExternal(item.url) })), { type: "separator" }, ...CHART_UTILITIES.map(item => ({ label: item.label, accelerator: item.accelerator, click: () => openChart(item) }))];
}

import { CHART_UTILITIES } from "../utilities.mjs";

const chart = CHART_UTILITIES.find(item => item.id === new URLSearchParams(location.search).get("chart"));
if (!chart) throw new Error("Unknown type chart");
const isMac = navigator.platform.startsWith("Mac");
document.title = chart.label;
document.getElementById("title").textContent = chart.label;
document.getElementById("shortcut").textContent = isMac ? `⌘⇧${chart.shortcut}` : `Ctrl+Shift+${chart.shortcut}`;
const image = document.getElementById("chart");
image.src = `../assets/${chart.asset}`;
image.alt = chart.label;
document.getElementById("close").addEventListener("click", () => window.close());

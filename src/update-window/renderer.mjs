import { currentUpdateStep, formatUpdateProgress } from "./progress.mjs";

const bridge = window.updateProgress;
const title = document.getElementById("title");
const steps = document.getElementById("steps");
const progressBar = document.getElementById("progress");
const labels = ["Download installer", "Verify size + SHA-256", "Back up saves (restart)", "Open installer"];

bridge.receive(update => {
  if (!update) return;
  title.textContent = `Updating to ${update.version}`;
  const { percent, size } = formatUpdateProgress(update.received, update.total);
  const current = currentUpdateStep(update);
  steps.replaceChildren(...labels.map((label, index) => {
    const row = document.createElement("div");
    row.className = `step${index === current ? " current" : index < current ? " done" : ""}`;
    const marker = document.createElement("span"); marker.className = "step-mark";
    const name = document.createElement("span"); name.className = "step-label"; name.textContent = label;
    row.append(marker, name);
    if (index === 0) { const value = document.createElement("span"); value.className = "step-value"; value.textContent = `${percent}% · ${size}`; row.append(value); }
    return row;
  }));
  progressBar.setAttribute("aria-valuenow", String(percent));
  progressBar.replaceChildren(...Array.from({ length: 20 }, (_, index) => {
    const segment = document.createElement("span");
    if (index < Math.round(percent / 5)) segment.className = "filled";
    return segment;
  }));
});

document.getElementById("cancel").addEventListener("click", () => bridge.cancel());
document.getElementById("window-close").addEventListener("click", () => bridge.close());

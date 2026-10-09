import { dialogSize } from "./size.mjs";
const bridge = window.confirmationDialog;
const title = document.getElementById("title");
const message = document.getElementById("message");
const detail = document.getElementById("detail");
const buttonContainer = document.getElementById("buttons");

const options = await bridge.options();
const buttons = options.buttons ?? ["OK"];
title.textContent = options.title ?? "";
title.parentElement.dataset.type = options.type === "none" ? "none" : options.type ?? "info";
message.textContent = options.message ?? "";
detail.textContent = options.detail ?? "";
detail.hidden = !options.detail;
for (const index of [...buttons.keys()].reverse()) {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = buttons[index];
  button.className = index === 0 ? "primary" : "secondary";
  button.dataset.index = String(index);
  button.addEventListener("click", () => bridge.respond(index));
  buttonContainer.append(button);
}

const focusIndex = options.defaultId ?? 0;
const focused = buttonContainer.querySelector(`[data-index="${focusIndex}"]`);
focused?.focus();
document.addEventListener("keydown", event => {
  if (event.key === "Escape") {
    if (options.cancelId !== undefined) { event.preventDefault(); bridge.respond(options.cancelId); }
    else if (buttons.length === 1) { event.preventDefault(); bridge.respond(0); }
    return;
  }
  if (event.key === "Enter" && document.activeElement instanceof HTMLButtonElement) {
    event.preventDefault();
    document.activeElement.click();
    return;
  }
  if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
  const available = [...buttonContainer.querySelectorAll("button")];
  const current = available.indexOf(document.activeElement);
  if (current < 0) return;
  event.preventDefault();
  available[(current + (event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 1) + available.length) % available.length].focus();
});

await Promise.race([document.fonts.ready, new Promise(resolve => setTimeout(resolve, 200))]);
const main = document.querySelector("main");
const content = document.getElementById("content");
const buttonsHeight = buttonContainer.offsetHeight;
const styles = getComputedStyle(main);
const verticalSpace = parseFloat(styles.paddingTop) + parseFloat(styles.paddingBottom) + buttonsHeight + parseFloat(styles.gap);
const frame = content.firstElementChild;
const measureHeight = () => document.querySelector(".titlebar").offsetHeight + verticalSpace + frame.getBoundingClientRect().height;
let corrections = 0;
bridge.onResized(({ capped }) => {
  content.style.overflowY = capped ? "auto" : "hidden";
  if (capped || frame.getBoundingClientRect().height <= content.clientHeight) return;
  const next = dialogSize(measureHeight(), corrections, true);
  if (!next) return;
  corrections = next.corrections;
  bridge.resize(next.height);
});
bridge.resize(dialogSize(measureHeight()).height);

import { formatBackupDate } from "./date-format.mjs";

const bridge = window.backupControl;
const rows = new Map();
const reasons = { manual: "Manual", update: "Before Update", restore: "Before Restore", cheat: "Before cheat change", unknown: "Unknown" };
const byId = id => document.getElementById(id);
let selected;

function updateRestore() {
  byId("restore").disabled = !selected || rows.get(selected)?.status !== "Verified";
}

function updateSelectedError() {
  const row = rows.get(selected);
  byId("error").textContent = row?.status === "Failed" ? `${row.error} Choose another Backup.` : "";
}

async function load() {
  try {
    const backups = await bridge.list();
    byId("empty").hidden = backups.length !== 0;
    for (const backup of backups) {
      const row = document.createElement("div");
      const cursor = document.createElement("span");
      const created = document.createElement("span");
      const reason = document.createElement("span");
      const integrity = document.createElement("span");
      row.className = "backup-row";
      row.tabIndex = 0;
      row.setAttribute("role", "button");
      cursor.className = "cursor-cell";
      created.className = "date";
      created.textContent = formatBackupDate(backup.createdAt, new Date());
      reason.className = "reason";
      reason.textContent = reasons[backup.reason] ?? "Unknown";
      integrity.className = "integrity checking";
      integrity.textContent = "Checking…";
      row.append(cursor, created, reason, integrity);
      row.addEventListener("click", () => {
        document.querySelector(".backup-row.selected")?.classList.remove("selected");
        row.classList.add("selected");
        selected = backup.name;
        updateRestore();
        updateSelectedError();
      });
      row.addEventListener("keydown", event => {
        if (event.key === "Enter" || event.key === " ") { event.preventDefault(); row.click(); }
      });
      byId("backups").append(row);
      rows.set(backup.name, { row, cursor, integrity, status: "Checking…", error: "" });
    }
    for (const backup of backups) {
      const result = await bridge.verify(backup.name);
      const row = rows.get(backup.name);
      row.status = result.status;
      row.error = result.error;
      row.integrity.textContent = result.status;
      row.integrity.title = result.error;
      row.integrity.className = `integrity ${result.status === "Verified" ? "verified" : result.status === "Failed" ? "failed" : "checking"}`;
      if (selected === backup.name) updateSelectedError();
      updateRestore();
    }
  } catch (error) { byId("error").textContent = error.message; }
}

byId("restore").addEventListener("click", () => { if (selected && rows.get(selected)?.status === "Verified") void bridge.restore(selected).catch(error => { byId("error").textContent = error.message; }); });
byId("choose").addEventListener("click", () => void bridge.chooseFolder().catch(error => { byId("error").textContent = error.message; }));
byId("close").addEventListener("click", () => void bridge.close());
byId("window-close").addEventListener("click", () => void bridge.close());
if (bridge) void load();
else byId("error").textContent = "Backup controls failed to initialize. Close this window and reopen it from the Restore Backup menu.";

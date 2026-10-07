const bridge = window.backupControl;
const rows = new Map();
const reasons = { manual: "Manual", update: "Before Update", restore: "Before Restore", cheat: "Before cheat change", unknown: "Unknown" };
const byId = id => document.getElementById(id);
let selected;

function updateRestore() {
  byId("restore").disabled = !selected || rows.get(selected)?.status !== "Verified";
}

async function load() {
  try {
    const backups = await bridge.list();
    byId("empty").hidden = backups.length !== 0;
    for (const backup of backups) {
      const row = document.createElement("tr");
      const created = document.createElement("td");
      const reason = document.createElement("td");
      const integrity = document.createElement("td");
      created.textContent = backup.createdAt && Number.isFinite(Date.parse(backup.createdAt)) ? new Date(backup.createdAt).toLocaleString() : "";
      reason.textContent = reasons[backup.reason] ?? "Unknown";
      integrity.textContent = "Checking…";
      row.append(created, reason, integrity);
      row.addEventListener("click", () => {
        document.querySelector("tr.selected")?.classList.remove("selected");
        row.classList.add("selected");
        selected = backup.name;
        updateRestore();
      });
      byId("backups").append(row);
      rows.set(backup.name, { integrity, status: "Checking…" });
    }
    for (const backup of backups) {
      const result = await bridge.verify(backup.name);
      const row = rows.get(backup.name);
      row.status = result.status;
      row.integrity.textContent = result.status;
      row.integrity.title = result.error;
      updateRestore();
    }
  } catch (error) { byId("error").textContent = error.message; }
}

byId("restore").addEventListener("click", () => { if (selected && rows.get(selected)?.status === "Verified") void bridge.restore(selected).catch(error => { byId("error").textContent = error.message; }); });
byId("choose").addEventListener("click", () => void bridge.chooseFolder().catch(error => { byId("error").textContent = error.message; }));
byId("close").addEventListener("click", () => void bridge.close());
if (bridge) void load();
else byId("error").textContent = "Backup controls failed to initialize. Close this window and reopen it from the Restore Backup menu.";

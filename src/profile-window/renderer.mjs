const bridge = window.profileControl;
const form = document.getElementById("create-form");
const input = document.getElementById("profile-name");
const error = document.getElementById("error");
const cancel = document.getElementById("cancel");
const hint = "Gets its own saves, cheats and Backups. The app restarts.";

function clearError() {
  error.textContent = hint;
  error.classList.remove("invalid");
  input.classList.remove("invalid");
}

function showError(message) {
  error.textContent = message;
  error.classList.add("invalid");
  input.classList.add("invalid");
}

input.addEventListener("input", clearError);

form.addEventListener("submit", async event => {
  event.preventDefault();
  clearError();
  form.classList.add("busy");
  try { await bridge.create(input.value); }
  catch (failure) { showError(failure.message); }
  finally { form.classList.remove("busy"); }
});

cancel.addEventListener("click", () => void bridge.close());
document.getElementById("window-close").addEventListener("click", () => void bridge.close());

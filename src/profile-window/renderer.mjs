const bridge = window.profileControl;
const form = document.getElementById("create-form");
const input = document.getElementById("profile-name");
const error = document.getElementById("error");
const cancel = document.getElementById("cancel");

form.addEventListener("submit", async event => {
  event.preventDefault();
  error.textContent = "";
  form.classList.add("busy");
  try { await bridge.create(input.value); }
  catch (failure) { error.textContent = failure.message; }
  finally { form.classList.remove("busy"); }
});

cancel.addEventListener("click", () => void bridge.close());

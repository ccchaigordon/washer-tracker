const grid = document.getElementById("grid");
const updated = document.getElementById("updated");
const btn = document.getElementById("refresh");
const titleEl = document.querySelector("h1");
const subtitleEl = document.getElementById("subtitle");
const btnText = document.querySelector(".btn-text");

let CONFIG = null;

function tile(label, status, time) {
  const statusLower = status.toLowerCase();
  const cls = statusLower === "available" ? "ok" : statusLower === "occupied" ? "busy" : statusLower === "error" ? "error" : "unk";
  return `
    <div class="card">
      <h3>${label}</h3>
      <div class="badge ${cls}">${status}</div>
      <div class="time-stamp">${time ? new Date(time).toLocaleTimeString() : ""}</div>
    </div>`;
}

async function loadConfig() {
  const res = await fetch("/api/config", { cache: "no-store" });
  if (!res.ok) throw new Error("Missing config from server. Ensure env vars are set.");
  CONFIG = await res.json();
  titleEl.textContent = CONFIG.title || "Laundry Status";
  if (subtitleEl) subtitleEl.textContent = CONFIG.ui?.showLocation ? (CONFIG.location || "") : "";
}

async function checkAll() {
  updated.textContent = "Checking…";
  btnText.innerHTML = '<span class="loading"></span> Checking';
  btn.disabled = true;
  
  const body = {
    machines: CONFIG.machines.map(m => ({
      id: m.id,
      name: m.name,
      machineNo: m.machineNo,
      // Optional per-machine overrides:
      ...(m.amount != null ? { amount: m.amount } : {}),
      ...(m.duration != null ? { duration: m.duration } : {}),
      ...(m.mode ? { mode: m.mode } : {}),
      ...(m.paymentAmount ? { paymentAmount: m.paymentAmount } : {})
    })),
    // Site-wide defaults:
    defaults: CONFIG.defaults || null
  };
  
  try {
    const res = await fetch("/api/check", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = await res.json();

    updated.textContent = `Last checked: ${new Date(data.checkedAt).toLocaleTimeString()}`;
    grid.innerHTML = data.machines.map(m => {
      const label = CONFIG.machines.find(x => x.id === m.id)?.label || m.id;
      return tile(label, m.status, data.checkedAt);
    }).join("");
  } catch (error) {
    updated.textContent = "Error checking status";
    console.error("Error:", error);
  } finally {
    btnText.textContent = "Refresh Status";
    btn.disabled = false;
  }
}

btn.addEventListener("click", checkAll);

(async () => {
  try {
    await loadConfig();
    checkAll();
  } catch (error) {
    console.error("Failed to load config:", error);
    updated.textContent = "Failed to load configuration";
  }
})();
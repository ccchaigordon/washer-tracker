const grid = document.getElementById("grid");
const updated = document.getElementById("updated");
const btn = document.getElementById("refresh");
const titleEl = document.querySelector("h1");
const subtitleEl = document.getElementById("subtitle");
const btnText = document.querySelector(".btn-text");
const hostelSelect = document.getElementById("hostelSelect");

let CONFIG = null;
let CURRENT_HOSTEL = null;

function tile(label, status, time) {
  const statusLower = status.toLowerCase();
  const cls = statusLower === "available" ? "ok" : statusLower === "occupied" ? "busy" : statusLower === "error" ? "error" : "unk";
  return `
    <div class="card">
      <h3>${label}</h3>
      <div class="badge ${cls}">${status}</div>
      <div class="time-row">
        <span class="time-stamp">${time ? new Date(time).toLocaleTimeString() : ""}</span>
      </div>
    </div>`;
}

async function loadConfig(hostelId) {
  const url = hostelId ? `/api/config?hostel=${encodeURIComponent(hostelId)}` : "/api/config";
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error("Missing config from server. Ensure env vars are set.");
  CONFIG = await res.json();
  titleEl.textContent = CONFIG.title || "Laundry Status";
  if (subtitleEl) subtitleEl.textContent = CONFIG.ui?.showLocation ? (CONFIG.location || "") : "";
  CURRENT_HOSTEL = hostelId || null;

  if (hostelSelect && Array.isArray(CONFIG.hostels)) {
    const options = ["<option value=\"\" disabled selected>Select hostel…</option>"]
      .concat(CONFIG.hostels.map(h => `<option value="${h.id}">${h.title || h.id}</option>`));
    hostelSelect.innerHTML = options.join("");
    hostelSelect.value = CURRENT_HOSTEL || "";
  }

  if (!CURRENT_HOSTEL && subtitleEl) {
    subtitleEl.textContent = "Please select one hostel to proceed";
  }
}

async function checkAll() {
  const selectedNow = hostelSelect ? (hostelSelect.value || null) : CURRENT_HOSTEL;
  if (selectedNow !== CURRENT_HOSTEL) CURRENT_HOSTEL = selectedNow;
  if (!CURRENT_HOSTEL) {
    updated.textContent = "Select a hostel to view status";
    grid.innerHTML = "";
    btn.disabled = true;
    return;
  }

  updated.textContent = "Checking…";
  btnText.innerHTML = '<span class="loading"></span> Checking';
  btn.disabled = true;
  
  const body = {
    hostel: CURRENT_HOSTEL,
    machines: CONFIG.machines.map(m => ({
      id: m.id,
      name: m.name,
      machineNo: m.machineNo,
      ...(m.amount != null ? { amount: m.amount } : {}),
      ...(m.duration != null ? { duration: m.duration } : {}),
      ...(m.mode ? { mode: m.mode } : {}),
      ...(m.paymentAmount ? { paymentAmount: m.paymentAmount } : {})
    })),
    defaults: CONFIG.defaults || null
  };
  
  try {
    const res = await fetch("/api/check", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = await res.json();

    updated.textContent = `Last checked: ${new Date(data.checkedAt).toLocaleTimeString()}`;
    grid.innerHTML = data.machines.map(m => {
      const meta = CONFIG.machines.find(x => x.id === m.id) || {};
      const label = meta.label || m.id;
      return tile(label, m.status, data.checkedAt);
    }).join("");

    const hasDryer = CONFIG.machines.some(meta => String(meta.id || "").toUpperCase().startsWith("D") || /-d\d*/i.test(String(meta.machineNo || "")) || /dryer/i.test(String(meta.label || meta.name || "")));
    if (hasDryer) showToast("Dryer status seems to be inaccurate (for now). Based on washer status, available dryers are usually more.");
  } catch (error) {
    updated.textContent = "Error checking status";
    console.error("Error:", error);
  } finally {
    btnText.textContent = "Refresh Status";
    btn.disabled = false;
  }
}

function showToast(message) {
  const el = document.getElementById("toast");
  if (!el) return;
  el.innerHTML = `<button class="close" aria-label="Close" onclick="this.parentElement.classList.remove('show')">×</button>${message}`;
  el.classList.add("show");
}

btn.addEventListener("click", checkAll);
if (hostelSelect) {
  hostelSelect.addEventListener("change", async () => {
    try {
      const selected = hostelSelect.value || null;
      CURRENT_HOSTEL = selected;
      await loadConfig(selected);
      btn.disabled = !CURRENT_HOSTEL;
      updated.textContent = CURRENT_HOSTEL ? "Click Refresh to load status" : "Select a hostel to view status";
      grid.innerHTML = "";
    } catch (e) {
      console.error(e);
    }
  });
}

(async () => {
  try {
    await loadConfig();
    CURRENT_HOSTEL = null;
    btn.disabled = true;
    updated.textContent = "Select a hostel to view status";
    grid.innerHTML = "";
  } catch (error) {
    console.error("Failed to load config:", error);
    updated.textContent = "Failed to load configuration";
  }
})();
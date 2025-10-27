export const config = { runtime: "edge" };

const UPSTREAM_ENDPOINT = String(process.env.UPSTREAM_ENDPOINT || "");
const UPSTREAM_ORIGIN = process.env.UPSTREAM_ORIGIN || "";
const UPSTREAM_REFERER = process.env.UPSTREAM_REFERER || "";
const UPSTREAM_X_REQUESTED_WITH = process.env.UPSTREAM_X_REQUESTED_WITH || "";
const UPSTREAM_HEADERS_JSON = process.env.UPSTREAM_HEADERS_JSON || "";

const DEFAULT_AMOUNT = Number(process.env.DEFAULT_AMOUNT ?? 4.5);
const DEFAULT_DURATION = Number(process.env.DEFAULT_DURATION ?? 37);
const DEFAULT_MODE = String(process.env.DEFAULT_MODE || "warm");

function readBase(): any {
  try {
    return JSON.parse(process.env.BASE_PAYLOAD_JSON || "{}");
  } catch {
    return {};
  }
}

function sanitizeString(x: unknown, max = 64): string {
  return String(x ?? "").slice(0, max).replace(/[^\w\-\.]/g, "");
}

type MachineStatus = "Available" | "Occupied" | "Unknown" | "Error";

async function classifyProbe(body: any): Promise<Exclude<MachineStatus, "Error">> {
  if (!UPSTREAM_ENDPOINT) throw new Error("Missing UPSTREAM_ENDPOINT env");
  const url = UPSTREAM_ENDPOINT.includes("?") ? `${UPSTREAM_ENDPOINT}&v=${Date.now()}` : `${UPSTREAM_ENDPOINT}?v=${Date.now()}`;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "Accept": "application/json,text/plain,*/*"
  };
  if (UPSTREAM_ORIGIN) headers["Origin"] = UPSTREAM_ORIGIN;
  if (UPSTREAM_REFERER) headers["Referer"] = UPSTREAM_REFERER;
  if (UPSTREAM_X_REQUESTED_WITH) headers["X-Requested-With"] = UPSTREAM_X_REQUESTED_WITH;
  if (UPSTREAM_HEADERS_JSON) {
    try {
      const extra = JSON.parse(UPSTREAM_HEADERS_JSON);
      for (const k of Object.keys(extra || {})) {
        const v = String((extra as any)[k]);
        if (v) headers[k] = v;
      }
    } catch {}
  }

  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    redirect: "manual"
  });

  const text = await res.text();
  try {
    console.log("[response]", {
      status: res.status,
      ok: res.ok,
      snippet: text.slice(0, 400)
    });
  } catch {}
  let json: any = null;
  try { json = text ? JSON.parse(text) : null; } catch {}

  if (res.status === 200) {
    if (json?.status === "url" || typeof json?.data?.url === "string") return "Available";
    if (/running/i.test(text)) return "Occupied";
    return "Available";
  }

  if (res.status === 409 || /\brunning\b/i.test(text)) return "Occupied";
  if (res.status === 400) {
    if (/version/i.test(text)) return "Unknown";
    return "Unknown";
  }

  if (res.ok) return "Available";

  return "Unknown";
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "POST only" }), { status: 405, headers: { "Content-Type": "application/json" } });
  }

  let payload: any;
  try {
    payload = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), { status: 400, headers: { "Content-Type": "application/json" } });
  }

  const list: any[] = Array.isArray(payload?.machines) ? payload.machines : [];
  if (!list.length) {
    return new Response(JSON.stringify({ error: "machines[] required" }), { status: 400, headers: { "Content-Type": "application/json" } });
  }

  const base = readBase();

  const targets = list.slice(0, 20).map((m: any) => ({
    id: sanitizeString(m.id),
    name: sanitizeString(m.name, 128) || "GENERIC",
    machineNo: sanitizeString(m.machineNo, 128)
  })).filter(x => x.machineNo);

  const bodies = targets.map((t: any) => {
    const b = structuredClone(base);
    b.machine = { ...(base.machine || {}), name: t.name };
    b.outlet = { ...(base.outlet || {}), machineNo: t.machineNo };
    if (!b.time) b.time = new Date().toISOString();

    if (typeof b.amount !== "number") b.amount = DEFAULT_AMOUNT;
    if (typeof b.duration !== "number") b.duration = DEFAULT_DURATION;
    if (!b.mode) b.mode = DEFAULT_MODE;
    if (!b.paymentAmount && typeof b.amount === "number") b.paymentAmount = b.amount.toFixed(2);

    if (payload.defaults) {
      const { amount, duration, mode, paymentAmount } = payload.defaults;
      if (amount != null) b.amount = amount;
      if (duration != null) b.duration = duration;
      if (mode) b.mode = sanitizeString(mode, 16);
      if (paymentAmount) b.paymentAmount = String(paymentAmount);
    }
    if (typeof t.amount === "number") b.amount = t.amount;
    if (typeof t.duration === "number") b.duration = t.duration;
    if (t.mode) b.mode = sanitizeString(t.mode, 16);
    if (t.paymentAmount) b.paymentAmount = String(t.paymentAmount);

    return { t, b };
  });

  const results: Array<{ id: string; status: MachineStatus }> = [];
  for (const { t, b } of bodies) {
    try {
      try {
        console.log("[request]", {
          id: String(t.id || t.machineNo),
          body: b
        });
      } catch {}
      const status = await classifyProbe(b);
      results.push({ id: String(t.id || t.machineNo), status });
      try {
        console.log("[machine][status]", { id: String(t.id || t.machineNo), status });
      } catch {}
    } catch (e) {
      results.push({ id: String(t.id || t.machineNo), status: "Error" });
    }
  }

  return new Response(JSON.stringify({ checkedAt: new Date().toISOString(), machines: results }), {
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }
  });
}

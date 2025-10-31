export const config = { runtime: "edge" };

const UPSTREAM_ENDPOINT = String(process.env.UPSTREAM_ENDPOINT || "");
const UPSTREAM_ORIGIN = process.env.UPSTREAM_ORIGIN || "";
const UPSTREAM_REFERER = process.env.UPSTREAM_REFERER || "";
const UPSTREAM_X_REQUESTED_WITH = process.env.UPSTREAM_X_REQUESTED_WITH || "";
const UPSTREAM_HEADERS_JSON = process.env.UPSTREAM_HEADERS_JSON || "";
const DRYER_STATUS_ENDPOINT = String(process.env.DRYER_STATUS_ENDPOINT || "");

// Washer
const DEFAULT_AMOUNT = Number(process.env.DEFAULT_AMOUNT ?? 4.5);
const DEFAULT_DURATION = Number(process.env.DEFAULT_DURATION ?? 37);
const DEFAULT_MODE = String(process.env.DEFAULT_MODE || "warm");

// Dryer
const DEFAULT_DRYER_AMOUNT = Number(process.env.DEFAULT_DRYER_AMOUNT ?? DEFAULT_AMOUNT);
const DEFAULT_DRYER_DURATION = Number(process.env.DEFAULT_DRYER_DURATION ?? 40);
const DEFAULT_DRYER_TEMPERATURE = String(process.env.DEFAULT_DRYER_TEMPERATURE || "low");

const CHECKOUT_URL_RE =
  /https:\/\/pg\.revenuemonster\.my\/v3\/checkout\?checkoutId=[A-Za-z0-9_-]+/;

// JSON bases
function readJSONEnv<T = any>(key: string, fallback: T): T {
  try {
    const raw = process.env[key];
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function resolveWasherBase(hostelId?: string): any {
  const id = String(hostelId || "").trim().toUpperCase();
  const tryKeys = [
    id ? `BASE_WASHER_PAYLOAD_JSON_${id}` : "",
    "BASE_WASHER_PAYLOAD_JSON",
    id ? `BASE_PAYLOAD_JSON_${id}` : "",
    "BASE_PAYLOAD_JSON"
  ].filter(Boolean);
  for (const k of tryKeys) {
    const v = readJSONEnv<any>(k, null as any);
    if (v && typeof v === "object" && Object.keys(v).length) return clone(v);
  }
  return null;
}

function resolveDryerBase(hostelId?: string): any {
  const id = String(hostelId || "").trim().toUpperCase();
  const tryKeys = [
    id ? `BASE_DRYER_PAYLOAD_JSON_${id}` : "",
    "BASE_DRYER_PAYLOAD_JSON",
    id ? `DRYER_BASE_PAYLOAD_JSON_${id}` : "",
    "DRYER_BASE_PAYLOAD_JSON"
  ].filter(Boolean);
  for (const k of tryKeys) {
    const v = readJSONEnv<any>(k, null as any);
    if (v && typeof v === "object" && Object.keys(v).length) return clone(v);
  }
  return null;
}

function sanitizeString(x: unknown, max = 64): string {
  return String(x ?? "").slice(0, max).replace(/[^\w\-\.]/g, "");
}

type MachineStatus = "Available" | "Occupied" | "Unknown" | "Error";
type Kind = "washer" | "dryer";

function detectKind(machineNo?: string, name?: string): Kind {
  const a = String(machineNo || "").toLowerCase();
  const b = String(name || "").toLowerCase();
  if (/-d\d*$/i.test(a) || /-d\d*$/i.test(b) || /-d(?![a-z])/i.test(a) || /-d(?![a-z])/i.test(b)) return "dryer";
  if (/-w\d*$/i.test(a) || /-w\d*$/i.test(b) || /-w(?![a-z])/i.test(a) || /-w(?![a-z])/i.test(b)) return "washer";
  return "washer";
}

function clone<T>(x: T): T {
  try { return structuredClone(x); } catch { return JSON.parse(JSON.stringify(x)); }
}

function baseFor(kind: Kind, hostelId?: string): any {
  if (kind === "washer") {
    const resolved = resolveWasherBase(hostelId);
    if (resolved) return resolved;
    return {
      machine: {
        type: "Washer",
        capacity: "13kg",
        online: true,
        running: false,
        outletName: "USM05",
        priceData: [
          { defaultmode: "cold", runtime: 37, name: "cold", price: DEFAULT_AMOUNT },
          { defaultmode: "cold", runtime: 37, name: "warm", price: DEFAULT_AMOUNT },
          { defaultmode: "cold", runtime: 37, name: "hot",  price: DEFAULT_AMOUNT }
        ]
      },
      outlet: { outletCode: "undefined", operatorCode: "undefined" }
    };
  } else {
    const resolved = resolveDryerBase(hostelId);
    if (resolved) return resolved;
    return {
      machine: {
        type: "Dryer",
        capacity: "10kg",
        online: true,
        running: false,
        outletName: "USM05",
        priceData: {
          runTime: 10,
          maxPrice: 20,
          minPrice: DEFAULT_DRYER_AMOUNT,
          initialTime: 40,
          default: "low",
          temperature: ["low", "medium", "high"]
        }
      },
      outlet: { outletCode: "undefined", operatorCode: "undefined" }
    };
  }
}

const occupiedHintRe = /\b(running|occupied|in\s*use|busy|processing)\b/i;

async function classifyProbe(body: any): Promise<Exclude<MachineStatus, "Error">> {
  if (!UPSTREAM_ENDPOINT) throw new Error("Missing UPSTREAM_ENDPOINT env");
  const url = UPSTREAM_ENDPOINT.includes("?")
    ? `${UPSTREAM_ENDPOINT}&v=${Date.now()}`
    : `${UPSTREAM_ENDPOINT}?v=${Date.now()}`;

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
  let json: any = null;
  try { json = text ? JSON.parse(text) : null; } catch {}

  try {
    console.log("[response]", {
      status: res.status,
      ok: res.ok,
      snippet: text.slice(0, 400)
    });
  } catch {}

  const findCheckoutUrl = (): string | null => {
    if (json && typeof json === "object") {
      const candidates = [
        json?.data?.url,
        json?.url,
        json?.checkoutUrl,
        json?.data?.checkoutUrl
      ].filter(Boolean) as string[];
      for (const u of candidates) if (CHECKOUT_URL_RE.test(String(u))) return String(u);
    }
    const m = text.match(CHECKOUT_URL_RE);
    return m ? m[0] : null;
  };

  if (res.status === 200) {
    const checkoutUrl = findCheckoutUrl();
    if (checkoutUrl) return "Available";
    if (occupiedHintRe.test(text) || occupiedHintRe.test(JSON.stringify(json || {}))) return "Occupied";
    return "Unknown";
  }

  if (res.status === 409 || occupiedHintRe.test(text)) return "Occupied";
  if (res.status === 400) return "Unknown";

  if (res.ok) return "Unknown";

  return "Unknown";
}

function resolveOperatorId(hostelId?: string): string {
  const id = String(hostelId || "").trim().toUpperCase();
  const tryKeys = [
    id ? `DRYER_OPERATOR_ID_${id}` : "",
    id ? `OPERATOR_ID_${id}` : "",
    "DRYER_OPERATOR_ID",
    "OPERATOR_ID"
  ].filter(Boolean);
  for (const k of tryKeys) {
    const v = process.env[k];
    if (v && String(v).trim()) return String(v).trim();
  }
  return "";
}

async function classifyDryerByGetMachine(machineNo: string, hostelId?: string): Promise<Exclude<MachineStatus, "Error">> {
  const operatorId = resolveOperatorId(hostelId);
  if (!DRYER_STATUS_ENDPOINT || !operatorId || !machineNo) return "Unknown";

  const url = DRYER_STATUS_ENDPOINT.includes("?")
    ? `${DRYER_STATUS_ENDPOINT}&v=${Date.now()}`
    : `${DRYER_STATUS_ENDPOINT}?v=${Date.now()}`;

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
    body: JSON.stringify({ machineNo, operatorId }),
    redirect: "manual"
  });

  const textRaw = await res.text();
  const cleaned = String(textRaw || "").replace(/\s|"/g, "").trim();
  const matchSegments = cleaned.match(/[A-Za-z0-9+/=]+/g);
  const token = matchSegments && matchSegments.length ? matchSegments[matchSegments.length - 1] : cleaned;

  try {
    console.log("[dryer][getMachine]", { machineNo, status: res.status, tokenSnippet: token.slice(-6) });
  } catch {}

  if (!res.ok) return "Unknown";

  if (token.endsWith("==")) return "Available";
  return "Occupied";
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

  const targets = list
    .slice(0, 20)
    .map((m: any) => ({
      id: sanitizeString(m.id),
      label: sanitizeString(m.label, 128),
      name: sanitizeString(m.name, 128) || "GENERIC",
      machineNo: sanitizeString(m.machineNo, 128),
      amount: typeof m.amount === "number" ? m.amount : undefined,
      duration: typeof m.duration === "number" ? m.duration : undefined,
      mode: m.mode ? sanitizeString(m.mode, 16) : undefined,
      temperature: m.temperature ? sanitizeString(m.temperature, 16) : undefined
    }))
    .filter(x => x.machineNo);

  const results: Array<{ id: string; status: MachineStatus }> = [];

  const hostelId = String(payload?.hostel || "").trim();

  for (const t of targets) {
    const kind = detectKind(t.machineNo, t.name);
    let b = baseFor(kind, hostelId);

    // Common fields for washer payload
    b.machine = { ...(b.machine || {}), name: t.name };
    b.outlet = { ...(b.outlet || {}), machineNo: t.machineNo };
    if (!b.time) b.time = new Date().toISOString();

    if (kind === "washer") {
      if (typeof b.amount !== "number") b.amount = DEFAULT_AMOUNT;
      if (typeof b.duration !== "number") b.duration = DEFAULT_DURATION;
      if (!b.mode) b.mode = DEFAULT_MODE;

      if (payload.defaults) {
        const { amount, duration, mode, paymentAmount } = payload.defaults;
        if (amount != null) b.amount = amount;
        if (duration != null) b.duration = duration;
        if (mode) b.mode = sanitizeString(mode, 16);
        if (paymentAmount) b.paymentAmount = String(paymentAmount);
      }
      if (typeof t.amount === "number") b.amount = t.amount;
      if (typeof t.duration === "number") b.duration = t.duration;
      if (t.mode) b.mode = t.mode;

      if ("temperature" in b) delete (b as any).temperature;
    } else {
      if (typeof b.amount !== "number") b.amount = DEFAULT_DRYER_AMOUNT;
      if (typeof b.duration !== "number") b.duration = DEFAULT_DRYER_DURATION;
      if (!b.temperature) b.temperature = DEFAULT_DRYER_TEMPERATURE;

      if (payload.defaults) {
        const { amount, duration, temperature, paymentAmount } = payload.defaults;
        if (amount != null) b.amount = amount;
        if (duration != null) b.duration = duration;
        if (temperature) b.temperature = sanitizeString(temperature, 16);
        if (paymentAmount) b.paymentAmount = String(paymentAmount);
      }
      if (typeof t.amount === "number") b.amount = t.amount;
      if (typeof t.duration === "number") b.duration = t.duration;
      if (t.temperature) b.temperature = t.temperature;

      if ("mode" in b) delete (b as any).mode;
    }

    if (!b.paymentAmount && typeof b.amount === "number") {
      b.paymentAmount = b.amount.toFixed(2);
    }

    try {
      if (kind === "dryer") {
        const status = await classifyDryerByGetMachine(t.machineNo, hostelId);
        results.push({ id: String(t.id || t.machineNo), status });
      } else {
        try {
          console.log("[request]", { id: String(t.id || t.machineNo), kind, body: b });
        } catch {}
        const status = await classifyProbe(b);
        results.push({ id: String(t.id || t.machineNo), status });
      }
      try { console.log("[machine][status]", { id: String(t.id || t.machineNo), status: results[results.length - 1].status }); } catch {}
    } catch {
      results.push({ id: String(t.id || t.machineNo), status: "Error" });
    }
  }

  return new Response(JSON.stringify({ checkedAt: new Date().toISOString(), machines: results }), {
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }
  });
}

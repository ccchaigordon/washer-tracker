export const config = { runtime: "edge" };

function parseJSONEnv<T>(key: string, fallback: T): T {
  try {
    const raw = process.env[key];
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return (parsed ?? fallback) as T;
  } catch {
    return fallback;
  }
}

export default async function handler(req?: Request): Promise<Response> {
  const url = req ? new URL(req.url) : null;
  const selectedHostel = url?.searchParams.get("hostel") || "";

  const sites = parseJSONEnv<any[]>("PUBLIC_SITES_JSON", []);

  function normalizeId(x: string): string {
    return String(x || "").trim();
  }

  if (Array.isArray(sites) && sites.length) {
    const siteById: Record<string, any> = {};
    for (const s of sites) siteById[normalizeId(s.id)] = s;
    const chosen = siteById[normalizeId(selectedHostel)];

    if (chosen) {
      const body: any = {
        title: chosen.title || "Laundry Status",
        location: chosen.location || process.env.PUBLIC_LOCATION || "",
        ui: { showLocation: (process.env.PUBLIC_UI_SHOW_LOCATION ?? "true").toLowerCase() !== "false" },
        machines: Array.isArray(chosen.machines) ? chosen.machines : [],
        hostels: sites.map(s => ({ id: s.id, title: s.title || s.id })),
        selectedHostel: chosen.id
      };
      if (chosen.defaults) body.defaults = chosen.defaults;

      return new Response(JSON.stringify(body), {
        headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }
      });
    }

    const shell: any = {
      title: "Laundry Status",
      location: "",
      ui: { showLocation: (process.env.PUBLIC_UI_SHOW_LOCATION ?? "true").toLowerCase() !== "false" },
      machines: [],
      hostels: sites.map(s => ({ id: s.id, title: s.title || s.id })),
      selectedHostel: ""
    };
    return new Response(JSON.stringify(shell), {
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }
    });
  }

  const title = process.env.PUBLIC_TITLE || "Laundry Status";
  const location = process.env.PUBLIC_LOCATION || "";
  const showLocation = (process.env.PUBLIC_UI_SHOW_LOCATION ?? "true").toLowerCase() !== "false";

  const machines = parseJSONEnv<any[]>("PUBLIC_MACHINES_JSON", []);
  const defaults = parseJSONEnv<any | null>("PUBLIC_DEFAULTS_JSON", null);

  const body: any = {
    title,
    location,
    ui: { showLocation },
    machines,
    hostels: [{ id: "", title: title }],
    selectedHostel: ""
  };
  if (defaults) body.defaults = defaults;

  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }
  });
}



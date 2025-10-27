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

export default async function handler(): Promise<Response> {
  const title = process.env.PUBLIC_TITLE || "Laundry Status";
  const location = process.env.PUBLIC_LOCATION || "";
  const showLocation = (process.env.PUBLIC_UI_SHOW_LOCATION ?? "true").toLowerCase() !== "false";

  const machines = parseJSONEnv<any[]>("PUBLIC_MACHINES_JSON", []);
  const defaults = parseJSONEnv<any | null>("PUBLIC_DEFAULTS_JSON", null);

  const body: any = {
    title,
    location,
    ui: { showLocation },
    machines
  };
  if (defaults) body.defaults = defaults;

  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }
  });
}



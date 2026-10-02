// Thin client for the Qloo hackathon API.
// Docs: /v2/insights is GET with query-string params, key goes in the X-Api-Key header.

export type QlooEntity = {
  id: string;
  name: string;
  type: string; // e.g. urn:entity:artist
  popularity: number | null; // 0..1 percentile
  affinity: number | null; // 0..1 from query.affinity
  tags: string[]; // human readable tag names
  address: string | null;
  sourceQuery: string; // short label of the request that produced it
};

export type Params = Record<string, string | number | undefined>;

export const ENTITY_TYPES = [
  "urn:entity:artist",
  "urn:entity:book",
  "urn:entity:brand",
  "urn:entity:destination",
  "urn:entity:movie",
  "urn:entity:person",
  "urn:entity:place",
  "urn:entity:podcast",
  "urn:entity:tv_show",
  "urn:entity:video_game",
] as const;

export class QlooError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

type FetchLike = typeof fetch;

export class QlooClient {
  private key: string;
  private base: string;
  private fetchImpl: FetchLike;
  calls = 0;

  constructor(opts: { apiKey: string; baseUrl?: string; fetchImpl?: FetchLike }) {
    this.key = opts.apiKey;
    this.base = (opts.baseUrl || "https://hackathon.api.qloo.com").replace(/\/$/, "");
    this.fetchImpl = opts.fetchImpl || fetch;
  }

  private async get(path: string, params: Params): Promise<any> {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v === undefined || v === "") continue;
      qs.set(k, String(v));
    }
    const url = `${this.base}${path}?${qs.toString()}`;
    this.calls += 1;
    const res = await this.fetchImpl(url, {
      headers: { "X-Api-Key": this.key, accept: "application/json" },
      cache: "no-store",
    });
    const text = await res.text();
    let body: any = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = { raw: text };
    }
    if (!res.ok) {
      const msg = body?.error?.message || body?.message || body?.raw || res.statusText;
      throw new QlooError(`Qloo ${path} failed (${res.status}): ${String(msg).slice(0, 200)}`, res.status);
    }
    return body;
  }

  async insights(params: Params, label: string): Promise<QlooEntity[]> {
    if (!params["filter.type"]) throw new QlooError("filter.type is required", 400);
    const body = await this.get("/v2/insights", { take: 15, ...params });
    const list = body?.results?.entities ?? body?.results ?? [];
    return Array.isArray(list) ? list.map((e: any) => normalize(e, String(params["filter.type"]), label)) : [];
  }

  async search(query: string, types?: string, take = 5): Promise<QlooEntity[]> {
    const body = await this.get("/search", { query, types, take });
    const list = body?.results ?? body?.entities ?? [];
    return Array.isArray(list) ? list.map((e: any) => normalize(e, e?.types?.[0] || e?.type || "", `search: ${query}`)) : [];
  }

  async tags(query: string, take = 10): Promise<{ id: string; name: string; type: string }[]> {
    const body = await this.get("/v2/tags", { "filter.query": query, take });
    const list = body?.results?.tags ?? body?.results ?? [];
    if (!Array.isArray(list)) return [];
    return list.map((t: any) => ({ id: String(t.id ?? t.tag_id ?? ""), name: String(t.name ?? ""), type: String(t.type ?? t.subtype ?? "") }));
  }
}

export function normalize(e: any, fallbackType: string, label: string): QlooEntity {
  const tags: string[] = Array.isArray(e?.tags)
    ? e.tags
        .map((t: any) => (typeof t === "string" ? t : t?.name))
        .filter((x: any) => typeof x === "string" && x.length > 0)
        .slice(0, 6)
    : [];
  const affinity = typeof e?.query?.affinity === "number" ? e.query.affinity : null;
  return {
    id: String(e?.entity_id ?? e?.id ?? ""),
    name: String(e?.name ?? "Unknown"),
    type: String(e?.subtype ?? e?.type ?? fallbackType),
    popularity: typeof e?.popularity === "number" ? e.popularity : null,
    affinity,
    tags,
    address: e?.properties?.address ? String(e.properties.address) : null,
    sourceQuery: label,
  };
}

export function shortType(type: string): string {
  return type.replace("urn:entity:", "").replace("_", " ");
}

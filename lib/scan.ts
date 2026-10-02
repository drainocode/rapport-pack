import { QlooClient, QlooEntity, Params } from "./qloo";

export type ScanInput = {
  callerCity: string; // the market the agent will be serving, e.g. "Manchester"
  agentCity: string; // where the agent lives, e.g. "Lagos"
  ageBand?: string; // one of Qloo's age bands, optional
  lineOfBusiness: string; // e.g. "broadband technical support"
};

export const AGE_BANDS = ["24_and_younger", "25_to_29", "30_to_34", "35_to_44", "45_to_54", "55_and_older"];

// Categories we scan for each city. Places use filter.location.query (they are physical),
// media and brands use signal.location.query (taste of people in that area).
export const SCAN_TYPES: { type: string; label: string; mode: "filter" | "signal" }[] = [
  { type: "urn:entity:artist", label: "Music", mode: "signal" },
  { type: "urn:entity:tv_show", label: "TV", mode: "signal" },
  { type: "urn:entity:movie", label: "Film", mode: "signal" },
  { type: "urn:entity:brand", label: "Brands", mode: "signal" },
  { type: "urn:entity:place", label: "Local spots", mode: "filter" },
];

export type CityScan = { city: string; byType: Record<string, QlooEntity[]>; errors: string[] };

export type ScanResult = {
  caller: CityScan;
  agent: CityScan;
  shared: QlooEntity[]; // same entity ranks in both cities
  bridges: Record<string, QlooEntity[]>; // caller-market picks seeded by the agent's own taste
  pool: Record<string, QlooEntity>; // every entity seen, by id
  qlooCalls: number;
};

function locParams(mode: "filter" | "signal", city: string): Params {
  return mode === "filter" ? { "filter.location.query": city } : { "signal.location.query": city };
}

export async function scanCity(q: QlooClient, city: string, ageBand?: string, types = SCAN_TYPES): Promise<CityScan> {
  const byType: Record<string, QlooEntity[]> = {};
  const errors: string[] = [];
  await Promise.all(
    types.map(async (t) => {
      const params: Params = { "filter.type": t.type, ...locParams(t.mode, city), take: 12 };
      if (ageBand && t.mode === "signal") params["signal.demographics.age"] = ageBand;
      try {
        byType[t.type] = await q.insights(params, `${t.label} in ${city}`);
      } catch (e: any) {
        byType[t.type] = [];
        errors.push(`${t.label} in ${city}: ${e?.message || e}`);
      }
    })
  );
  return { city, byType, errors };
}

export function findShared(a: CityScan, b: CityScan): QlooEntity[] {
  const out: QlooEntity[] = [];
  for (const type of Object.keys(a.byType)) {
    const ids = new Set((b.byType[type] || []).map((e) => e.id));
    for (const e of a.byType[type] || []) if (e.id && ids.has(e.id)) out.push(e);
  }
  return out;
}

// For media types, ask Qloo: "given what the agent already likes, what does the caller's market
// like that sits closest to it?" That is the bridge an agent can talk about honestly.
export async function findBridges(q: QlooClient, agent: CityScan, callerCity: string, ageBand?: string) {
  const bridges: Record<string, QlooEntity[]> = {};
  const errors: string[] = [];
  const media = SCAN_TYPES.filter((t) => t.mode === "signal" && t.type !== "urn:entity:brand");
  await Promise.all(
    media.map(async (t) => {
      const seeds = (agent.byType[t.type] || []).slice(0, 5).map((e) => e.id).filter(Boolean);
      if (seeds.length === 0) return;
      const params: Params = {
        "filter.type": t.type,
        "signal.location.query": callerCity,
        "signal.interests.entities": seeds.join(","),
        "filter.exclude.entities": seeds.join(","),
        take: 8,
      };
      if (ageBand) params["signal.demographics.age"] = ageBand;
      try {
        bridges[t.type] = await q.insights(params, `${t.label} bridge into ${callerCity}`);
      } catch (e: any) {
        errors.push(`${t.label} bridge: ${e?.message || e}`);
      }
    })
  );
  return { bridges, errors };
}

export async function runScan(q: QlooClient, input: ScanInput): Promise<ScanResult> {
  const [caller, agent] = await Promise.all([
    scanCity(q, input.callerCity, input.ageBand),
    scanCity(q, input.agentCity),
  ]);
  const shared = findShared(caller, agent);
  const { bridges, errors } = await findBridges(q, agent, input.callerCity, input.ageBand);
  caller.errors.push(...errors);
  const pool: Record<string, QlooEntity> = {};
  const add = (e: QlooEntity) => {
    if (e.id && !pool[e.id]) pool[e.id] = e;
  };
  Object.values(caller.byType).flat().forEach(add);
  Object.values(agent.byType).flat().forEach(add);
  Object.values(bridges).flat().forEach(add);
  return { caller, agent, shared, bridges, pool, qlooCalls: q.calls };
}

// Compact text version handed to the language model. Ids are kept so the model can cite them.
export function scanDigest(s: ScanResult): string {
  const line = (e: QlooEntity) =>
    `${e.id} | ${e.name}${e.address ? ` (${e.address})` : ""}${e.affinity != null ? ` | affinity ${e.affinity.toFixed(2)}` : ""}${e.tags.length ? ` | ${e.tags.slice(0, 3).join(", ")}` : ""}`;
  const block = (title: string, list: QlooEntity[]) => (list.length ? `## ${title}\n${list.map(line).join("\n")}` : "");
  const parts: string[] = [];
  for (const t of SCAN_TYPES) parts.push(block(`Caller market (${s.caller.city}): ${t.label}`, s.caller.byType[t.type] || []));
  for (const t of SCAN_TYPES) parts.push(block(`Agent home (${s.agent.city}): ${t.label}`, (s.agent.byType[t.type] || []).slice(0, 6)));
  parts.push(block("Shared: ranks in both cities", s.shared));
  for (const t of SCAN_TYPES) parts.push(block(`Bridge picks in ${s.caller.city} seeded by agent taste: ${t.label}`, s.bridges[t.type] || []));
  return parts.filter(Boolean).join("\n\n");
}

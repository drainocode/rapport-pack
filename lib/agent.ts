import { QlooClient, QlooEntity, ENTITY_TYPES } from "./qloo";
import { ScanInput, ScanResult, runScan, scanDigest } from "./scan";
import { ChatFn, ChatMessage, ToolSpec, extractJson } from "./llm";

export type Pack = {
  headline: string;
  snapshot: { category: string; entityIds: string[]; note: string }[];
  sharedGround: { entityId: string; why: string }[];
  openers: { line: string; useWhen: string; entityIds: string[] }[];
  avoid: string[];
  rolePlays: { title: string; callerProfile: string; situation: string; goodMove: string; entityIds: string[] }[];
  quiz: { q: string; options: string[]; answerIndex: number; explain: string }[];
};

export type PackResult = {
  input: ScanInput;
  pack: Pack;
  entities: Record<string, QlooEntity>;
  scan: { shared: string[]; errors: string[] };
  trace: { step: string; detail: string }[];
  grounding: { removed: string[] };
  qlooCalls: number;
};

const TOOLS: ToolSpec[] = [
  {
    type: "function",
    function: {
      name: "qloo_insights",
      description:
        "Ask Qloo's taste graph for entities ranked by affinity. Use to dig deeper than the starting scan, for example films popular with 45 to 54 year olds in the caller city, or artists that people who like a given artist also love there.",
      parameters: {
        type: "object",
        properties: {
          entity_type: { type: "string", enum: [...ENTITY_TYPES] },
          city: { type: "string", description: "Locality name, e.g. 'Manchester'" },
          age_band: {
            type: "string",
            enum: ["24_and_younger", "25_to_29", "30_to_34", "35_to_44", "45_to_54", "55_and_older"],
          },
          seed_entity_ids: { type: "array", items: { type: "string" }, description: "Qloo entity ids to use as taste signal" },
          tag_ids: { type: "array", items: { type: "string" }, description: "Qloo tag ids from qloo_tags to filter by" },
          take: { type: "integer", minimum: 1, maximum: 15 },
        },
        required: ["entity_type"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "qloo_search",
      description: "Look up Qloo entity ids by name, e.g. a football club, a show or an artist the trainer mentioned.",
      parameters: {
        type: "object",
        properties: { query: { type: "string" }, entity_type: { type: "string", enum: [...ENTITY_TYPES] } },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "qloo_tags",
      description: "Find valid Qloo tag ids by keyword (genres, cuisines). Needed before filtering by tag.",
      parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
    },
  },
];

const SYSTEM = `You are a contact centre trainer's assistant. You build a "rapport pack": a one-page cultural briefing that helps an agent living in one city build honest rapport with callers from another market, plus training material.

Rules:
- Only mention films, shows, artists, brands or places that appear in the Qloo data you were given or fetched with tools. Cite them by their Qloo entity id in the entityIds fields. Never invent cultural facts, scores or dates.
- Rapport is earned, not forced. Openers are for when the caller opens the door (hold time, a mention of the weekend, a background noise). The fix for the caller's problem always comes first.
- Keep it safe: no politics, religion, accents, money, or guessing someone's background from their voice.
- The agent must never pretend to be local or to like something they do not. Shared ground and bridge picks exist so they can be truthful.
- Write plainly, like an experienced team lead. Short sentences. Do not use the em dash character.

You may call tools up to 4 times to fill gaps (for example to check the caller's age band or to find a bridge). Then reply with JSON only, matching:
{"headline": string,
 "snapshot": [{"category": string, "entityIds": [string], "note": string}],
 "sharedGround": [{"entityId": string, "why": string}],
 "openers": [{"line": string, "useWhen": string, "entityIds": [string]}],
 "avoid": [string],
 "rolePlays": [{"title": string, "callerProfile": string, "situation": string, "goodMove": string, "entityIds": [string]}],
 "quiz": [{"q": string, "options": [string,string,string,string], "answerIndex": 0, "explain": string}]}
Give 4 to 5 snapshot rows, 2 to 4 sharedGround items, 5 openers, 4 avoid lines, 3 role plays tied to the line of business, and 5 quiz questions that test judgement, not trivia.`;

export async function runTool(q: QlooClient, name: string, args: any, pool: Record<string, QlooEntity>): Promise<string> {
  const add = (list: QlooEntity[]) => list.forEach((e) => e.id && (pool[e.id] = pool[e.id] || e));
  const brief = (list: QlooEntity[]) =>
    list.map((e) => `${e.id} | ${e.name}${e.affinity != null ? ` | affinity ${e.affinity.toFixed(2)}` : ""}${e.tags.length ? ` | ${e.tags.slice(0, 3).join(", ")}` : ""}`).join("\n") || "(no results)";
  if (name === "qloo_insights") {
    const type = String(args.entity_type || "");
    if (!ENTITY_TYPES.includes(type as any)) return "Error: unsupported entity_type";
    const params: Record<string, string | number | undefined> = { "filter.type": type, take: Math.min(Number(args.take) || 10, 15) };
    if (args.city) params[type === "urn:entity:place" || type === "urn:entity:destination" ? "filter.location.query" : "signal.location.query"] = String(args.city);
    if (args.age_band) params["signal.demographics.age"] = String(args.age_band);
    if (Array.isArray(args.seed_entity_ids) && args.seed_entity_ids.length) params["signal.interests.entities"] = args.seed_entity_ids.slice(0, 10).join(",");
    if (Array.isArray(args.tag_ids) && args.tag_ids.length) params["filter.tags"] = args.tag_ids.slice(0, 5).join(",");
    const list = await q.insights(params, `agent: ${type.replace("urn:entity:", "")}${args.city ? ` in ${args.city}` : ""}`);
    add(list);
    return brief(list);
  }
  if (name === "qloo_search") {
    const list = await q.search(String(args.query || ""), args.entity_type ? String(args.entity_type) : undefined);
    add(list);
    return brief(list);
  }
  if (name === "qloo_tags") {
    const tags = await q.tags(String(args.query || ""));
    return tags.map((t) => `${t.id} | ${t.name} | ${t.type}`).join("\n") || "(no tags)";
  }
  return "Error: unknown tool";
}

// Drops anything the model cites that Qloo did not actually return. Returns what was removed.
export function groundPack(raw: any, pool: Record<string, QlooEntity>): { pack: Pack; removed: string[] } {
  const removed: string[] = [];
  const keep = (ids: unknown): string[] => {
    if (!Array.isArray(ids)) return [];
    return ids.filter((id) => {
      const ok = typeof id === "string" && !!pool[id];
      if (!ok) removed.push(String(id));
      return ok;
    }) as string[];
  };
  const str = (v: unknown) => (typeof v === "string" ? v.replace(/\u2014/g, ", ") : "");
  const pack: Pack = {
    headline: str(raw?.headline),
    snapshot: (raw?.snapshot || [])
      .map((r: any) => ({ category: str(r.category), entityIds: keep(r.entityIds), note: str(r.note) }))
      .filter((r: any) => r.entityIds.length > 0),
    sharedGround: (raw?.sharedGround || [])
      .filter((r: any) => {
        const ok = typeof r?.entityId === "string" && !!pool[r.entityId];
        if (!ok) removed.push(String(r?.entityId));
        return ok;
      })
      .map((r: any) => ({ entityId: r.entityId, why: str(r.why) })),
    openers: (raw?.openers || []).map((r: any) => ({ line: str(r.line), useWhen: str(r.useWhen), entityIds: keep(r.entityIds) })),
    avoid: (raw?.avoid || []).map(str).filter(Boolean),
    rolePlays: (raw?.rolePlays || []).map((r: any) => ({
      title: str(r.title),
      callerProfile: str(r.callerProfile),
      situation: str(r.situation),
      goodMove: str(r.goodMove),
      entityIds: keep(r.entityIds),
    })),
    quiz: (raw?.quiz || [])
      .filter((r: any) => Array.isArray(r?.options) && r.options.length === 4 && Number.isInteger(r.answerIndex) && r.answerIndex >= 0 && r.answerIndex < 4)
      .map((r: any) => ({ q: str(r.q), options: r.options.map(str), answerIndex: r.answerIndex, explain: str(r.explain) })),
  };
  return { pack, removed };
}

export async function buildPack(q: QlooClient, chat: ChatFn, input: ScanInput, maxToolRounds = 4): Promise<PackResult> {
  const trace: PackResult["trace"] = [];
  const scan: ScanResult = await runScan(q, input);
  trace.push({
    step: "Taste scan",
    detail: `Scanned music, TV, film, brands and local spots for ${input.callerCity} and ${input.agentCity}. ${scan.shared.length} shared entities, ${Object.values(scan.bridges).flat().length} bridge picks.`,
  });
  const pool = scan.pool;
  if (Object.keys(pool).length === 0) {
    throw new Error(
      `Qloo returned no data for these cities. ${[...scan.caller.errors, ...scan.agent.errors].slice(0, 2).join(" ")}`.trim()
    );
  }

  const messages: ChatMessage[] = [
    { role: "system", content: SYSTEM },
    {
      role: "user",
      content: `Caller market: ${input.callerCity}\nAgent home city: ${input.agentCity}\nTypical caller age band: ${input.ageBand || "not given"}\nLine of business: ${input.lineOfBusiness}\n\nStarting Qloo scan (id | name | affinity | tags):\n\n${scanDigest(scan)}`,
    },
  ];

  let final: string | null = null;
  for (let round = 0; round <= maxToolRounds; round++) {
    const allowTools = round < maxToolRounds;
    const reply = await chat(messages, allowTools ? TOOLS : [], !allowTools);
    if (allowTools && reply.tool_calls.length) {
      messages.push({ role: "assistant", content: reply.content, tool_calls: reply.tool_calls });
      for (const call of reply.tool_calls) {
        let args: any = {};
        try {
          args = JSON.parse(call.function.arguments || "{}");
        } catch {
          args = {};
        }
        let out: string;
        try {
          out = await runTool(q, call.function.name, args, pool);
        } catch (e: any) {
          out = `Error: ${e?.message || e}`;
        }
        trace.push({ step: `Agent tool: ${call.function.name}`, detail: JSON.stringify(args).slice(0, 220) });
        messages.push({ role: "tool", tool_call_id: call.id, content: out.slice(0, 6000) });
      }
      continue;
    }
    final = reply.content;
    break;
  }
  if (!final) throw new Error("The model did not produce a pack");

  let raw: any;
  try {
    raw = extractJson(final);
  } catch {
    messages.push({ role: "assistant", content: final });
    messages.push({ role: "user", content: "Reply again with the JSON object only." });
    const retry = await chat(messages, [], true);
    raw = extractJson(retry.content || "");
  }
  const { pack, removed } = groundPack(raw, pool);
  trace.push({
    step: "Grounding check",
    detail: removed.length
      ? `Removed ${removed.length} reference(s) the model made that Qloo did not return.`
      : "Every cultural reference in the pack traces back to a Qloo result.",
  });

  return {
    input,
    pack,
    entities: pool,
    scan: { shared: scan.shared.map((e) => e.id), errors: [...scan.caller.errors, ...scan.agent.errors] },
    trace,
    grounding: { removed },
    qlooCalls: q.calls,
  };
}

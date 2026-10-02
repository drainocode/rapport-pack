import { describe, it, expect } from "vitest";
import { QlooClient } from "../lib/qloo";
import { runScan } from "../lib/scan";
import { buildPack, groundPack } from "../lib/agent";
import type { ChatFn } from "../lib/llm";

// Fake Qloo: returns entities whose ids encode the request so we can check params were sent right.
function fakeQloo(log: string[]) {
  return (async (url: string, init?: any) => {
    log.push(url);
    if (init?.headers?.["X-Api-Key"] !== "k") return new Response("{}", { status: 401 });
    const u = new URL(url);
    if (u.pathname === "/v2/insights") {
      const type = u.searchParams.get("filter.type")!.replace("urn:entity:", "");
      const city = u.searchParams.get("signal.location.query") || u.searchParams.get("filter.location.query") || "x";
      const seeded = u.searchParams.has("signal.interests.entities");
      const shared = { entity_id: `${type}-shared`, name: `Shared ${type}`, subtype: `urn:entity:${type}`, query: { affinity: 0.9 }, tags: [{ name: "pop" }] };
      const own = [1, 2, 3].map((i) => ({
        entity_id: `${type}-${city}-${seeded ? "bridge" : "top"}-${i}`,
        name: `${city} ${type} ${i}`,
        subtype: `urn:entity:${type}`,
        query: { affinity: 1 - i / 10 },
        tags: [],
      }));
      return new Response(JSON.stringify({ success: true, results: { entities: seeded ? own : [shared, ...own] } }), { status: 200 });
    }
    if (u.pathname === "/search") {
      return new Response(JSON.stringify({ results: [{ entity_id: "club-1", name: "Some Club", types: ["urn:entity:brand"] }] }), { status: 200 });
    }
    return new Response("{}", { status: 404 });
  }) as typeof fetch;
}

const input = { callerCity: "Manchester", agentCity: "Lagos", ageBand: "35_to_44", lineOfBusiness: "broadband support" };

describe("scan", () => {
  it("scans both cities, finds shared entities and seeded bridges", async () => {
    const log: string[] = [];
    const q = new QlooClient({ apiKey: "k", baseUrl: "https://hackathon.api.qloo.com", fetchImpl: fakeQloo(log) });
    const s = await runScan(q, input);
    expect(s.caller.errors).toEqual([]);
    expect(s.shared.map((e) => e.id)).toContain("artist-shared");
    expect(s.bridges["urn:entity:artist"][0].id).toBe("artist-Manchester-bridge-1");
    // places must use filter.location.query, media must use signal.location.query
    expect(log.some((l) => l.includes("filter.type=urn%3Aentity%3Aplace") && l.includes("filter.location.query=Manchester"))).toBe(true);
    expect(log.some((l) => l.includes("filter.type=urn%3Aentity%3Aartist") && l.includes("signal.location.query=Manchester") && l.includes("signal.demographics.age=35_to_44"))).toBe(true);
    // brands are not used for bridges
    expect(s.bridges["urn:entity:brand"]).toBeUndefined();
    expect(log.every((l) => l.startsWith("https://hackathon.api.qloo.com/"))).toBe(true);
  });
});

describe("grounding", () => {
  it("drops ids the model invented", () => {
    const pool: any = { a: { id: "a", name: "A" } };
    const { pack, removed } = groundPack(
      {
        headline: "Hi \u2014 there",
        snapshot: [{ category: "Music", entityIds: ["a", "fake"], note: "n" }, { category: "Empty", entityIds: ["nope"], note: "" }],
        sharedGround: [{ entityId: "a", why: "w" }, { entityId: "ghost", why: "w" }],
        openers: [],
        avoid: ["x"],
        rolePlays: [],
        quiz: [{ q: "q", options: ["1", "2", "3", "4"], answerIndex: 1, explain: "e" }, { q: "bad", options: ["1"], answerIndex: 0, explain: "" }],
      },
      pool
    );
    expect(pack.snapshot).toHaveLength(1);
    expect(pack.snapshot[0].entityIds).toEqual(["a"]);
    expect(pack.sharedGround).toHaveLength(1);
    expect(pack.quiz).toHaveLength(1);
    expect(pack.headline).not.toContain("\u2014");
    expect(removed.sort()).toEqual(["fake", "ghost", "nope"]);
  });
});

describe("agent loop", () => {
  it("calls a tool, then returns a grounded pack", async () => {
    const log: string[] = [];
    const q = new QlooClient({ apiKey: "k", fetchImpl: fakeQloo(log) });
    let turn = 0;
    const chat: ChatFn = async (messages, tools) => {
      turn++;
      if (turn === 1) {
        expect(tools.length).toBe(3);
        expect(messages[1].content).toContain("artist-shared");
        return {
          content: null,
          tool_calls: [{ id: "t1", type: "function", function: { name: "qloo_search", arguments: JSON.stringify({ query: "Some Club" }) } }],
        };
      }
      const last = messages[messages.length - 1] as any;
      expect(last.role).toBe("tool");
      expect(last.content).toContain("club-1");
      return {
        content: JSON.stringify({
          headline: "Manchester callers",
          snapshot: [{ category: "Music", entityIds: ["artist-Manchester-top-1"], note: "n" }],
          sharedGround: [{ entityId: "artist-shared", why: "both" }],
          openers: [{ line: "Busy weekend?", useWhen: "caller mentions weekend", entityIds: ["club-1", "made-up"] }],
          avoid: ["politics"],
          rolePlays: [],
          quiz: [],
        }),
        tool_calls: [],
      };
    };
    const r = await buildPack(q, chat, input);
    expect(r.pack.openers[0].entityIds).toEqual(["club-1"]);
    expect(r.grounding.removed).toEqual(["made-up"]);
    expect(r.trace.map((t) => t.step)).toEqual(["Taste scan", "Agent tool: qloo_search", "Grounding check"]);
    expect(r.qlooCalls).toBeGreaterThan(10);
  });

  it("fails clearly when Qloo returns nothing", async () => {
    const q = new QlooClient({ apiKey: "wrong", fetchImpl: fakeQloo([]) });
    const chat: ChatFn = async () => ({ content: "{}", tool_calls: [] });
    await expect(buildPack(q, chat, input)).rejects.toThrow(/no data/);
  });
});

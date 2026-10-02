"use client";

import { useState } from "react";
import type { PackResult } from "@/lib/agent";
import type { QlooEntity } from "@/lib/qloo";

const PRESETS = [
  { callerCity: "Manchester", agentCity: "Lagos", ageBand: "35_to_44", lineOfBusiness: "broadband technical support" },
  { callerCity: "Houston", agentCity: "Manila", ageBand: "45_to_54", lineOfBusiness: "health insurance claims" },
  { callerCity: "Toronto", agentCity: "Nairobi", ageBand: "25_to_29", lineOfBusiness: "online retail returns" },
];

const AGE_LABELS: Record<string, string> = {
  "": "Any age",
  "24_and_younger": "24 and younger",
  "25_to_29": "25 to 29",
  "30_to_34": "30 to 34",
  "35_to_44": "35 to 44",
  "45_to_54": "45 to 54",
  "55_and_older": "55 and older",
};

function Chip({ e }: { e?: QlooEntity }) {
  if (!e) return null;
  const pct = e.affinity != null ? Math.round(e.affinity * 100) : null;
  return (
    <span className="chip" title={`${e.type.replace("urn:entity:", "")} from Qloo: ${e.sourceQuery}`}>
      {e.name}
      {pct != null && (
        <span className="bar" aria-label={`affinity ${pct}%`}>
          <span style={{ width: `${pct}%` }} />
        </span>
      )}
    </span>
  );
}

function toMarkdown(r: PackResult): string {
  const n = (id: string) => r.entities[id]?.name || id;
  const p = r.pack;
  const lines = [
    `# Rapport pack: ${r.input.agentCity} agents serving ${r.input.callerCity} callers`,
    `Line of business: ${r.input.lineOfBusiness}`,
    "",
    p.headline,
    "",
    "## What callers there love",
    ...p.snapshot.map((s) => `- ${s.category}: ${s.entityIds.map(n).join(", ")}. ${s.note}`),
    "",
    "## Honest shared ground",
    ...p.sharedGround.map((s) => `- ${n(s.entityId)}: ${s.why}`),
    "",
    "## Openers (only when the caller opens the door)",
    ...p.openers.map((o) => `- "${o.line}" Use when: ${o.useWhen}`),
    "",
    "## Avoid",
    ...p.avoid.map((a) => `- ${a}`),
    "",
    "## Role plays",
    ...p.rolePlays.flatMap((rp, i) => [`### ${i + 1}. ${rp.title}`, `Caller: ${rp.callerProfile}`, `Situation: ${rp.situation}`, `Good move: ${rp.goodMove}`, ""]),
    "## Quiz",
    ...p.quiz.flatMap((qz, i) => [
      `${i + 1}. ${qz.q}`,
      ...qz.options.map((o, j) => `   ${String.fromCharCode(65 + j)}. ${o}`),
      `   Answer: ${String.fromCharCode(65 + qz.answerIndex)}. ${qz.explain}`,
      "",
    ]),
    "Cultural data from Qloo's taste graph.",
  ];
  return lines.join("\n");
}

export default function Home() {
  const [form, setForm] = useState(PRESETS[0]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<PackResult | null>(null);
  const [showAnswers, setShowAnswers] = useState(false);

  async function submit(ev: React.FormEvent) {
    ev.preventDefault();
    setLoading(true);
    setError("");
    setResult(null);
    setShowAnswers(false);
    try {
      const res = await fetch("/api/pack", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(form) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Request failed");
      setResult(data);
    } catch (e: any) {
      setError(e.message || "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  function download() {
    if (!result) return;
    const blob = new Blob([toMarkdown(result)], { type: "text/markdown" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `rapport-pack-${result.input.callerCity.toLowerCase().replace(/\s+/g, "-")}.md`;
    a.click();
  }

  const ent = (id: string) => result?.entities[id];

  return (
    <main>
      <h1>Rapport Pack</h1>
      <p className="sub">
        A one-page cultural briefing, three role plays and a short quiz for contact centre agents who serve callers in another country.
        Built on Qloo&apos;s taste graph so every reference is something people in that market actually like.
      </p>

      <form className="card" onSubmit={submit}>
        <div className="row presets no-print" style={{ marginBottom: 12 }}>
          <span className="muted">Try:</span>
          {PRESETS.map((p) => (
            <button type="button" className="ghost" key={p.callerCity} onClick={() => setForm(p)}>
              {p.agentCity} to {p.callerCity}
            </button>
          ))}
        </div>
        <div className="grid">
          <div>
            <label htmlFor="callerCity">Callers are in</label>
            <input id="callerCity" value={form.callerCity} onChange={(e) => setForm({ ...form, callerCity: e.target.value })} required />
          </div>
          <div>
            <label htmlFor="agentCity">Agents live in</label>
            <input id="agentCity" value={form.agentCity} onChange={(e) => setForm({ ...form, agentCity: e.target.value })} required />
          </div>
          <div>
            <label htmlFor="ageBand">Typical caller age</label>
            <select id="ageBand" value={form.ageBand} onChange={(e) => setForm({ ...form, ageBand: e.target.value })}>
              {Object.entries(AGE_LABELS).map(([v, l]) => (
                <option key={v} value={v}>{l}</option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="lob">Line of business</label>
            <input id="lob" value={form.lineOfBusiness} onChange={(e) => setForm({ ...form, lineOfBusiness: e.target.value })} />
          </div>
        </div>
        <div className="row" style={{ marginTop: 14 }}>
          <button type="submit" disabled={loading}>{loading ? "Building pack (about 20 seconds)..." : "Build rapport pack"}</button>
        </div>
      </form>

      {error && <div className="card err">{error}</div>}

      {result && (
        <>
          <div className="card">
            <div className="row no-print" style={{ justifyContent: "space-between", marginBottom: 8 }}>
              <span className="muted">{result.input.agentCity} agents serving {result.input.callerCity} callers, {result.input.lineOfBusiness}</span>
              <div className="row">
                <button type="button" className="ghost" onClick={download}>Download .md</button>
                <button type="button" className="ghost" onClick={() => window.print()}>Print</button>
              </div>
            </div>
            <h2>{result.pack.headline}</h2>
          </div>

          <div className="card">
            <h2>What callers in {result.input.callerCity} love</h2>
            {result.pack.snapshot.map((s, i) => (
              <div key={i} style={{ marginBottom: 12 }}>
                <h3>{s.category}</h3>
                <div>{s.entityIds.map((id) => <Chip key={id} e={ent(id)} />)}</div>
                <p className="muted">{s.note}</p>
              </div>
            ))}
          </div>

          <div className="card">
            <h2>Honest shared ground</h2>
            <p className="muted">Things that rank with people in both cities, or that Qloo links from the agent&apos;s own taste. Agents never have to fake an interest.</p>
            <ul>
              {result.pack.sharedGround.map((s, i) => (
                <li key={i}><Chip e={ent(s.entityId)} /> {s.why}</li>
              ))}
            </ul>
          </div>

          <div className="card">
            <h2>Openers</h2>
            <p className="muted">Fix first. Use these only when the caller opens the door.</p>
            <ul>
              {result.pack.openers.map((o, i) => (
                <li key={i}>
                  &ldquo;{o.line}&rdquo; <span className="muted">Use when: {o.useWhen}</span>
                </li>
              ))}
            </ul>
            <h3 style={{ marginTop: 14 }}>Avoid</h3>
            <ul>{result.pack.avoid.map((a, i) => <li key={i}>{a}</li>)}</ul>
          </div>

          <div className="card">
            <h2>Role plays</h2>
            {result.pack.rolePlays.map((rp, i) => (
              <div key={i} style={{ marginBottom: 14 }}>
                <h3>{i + 1}. {rp.title}</h3>
                <p><strong>Caller:</strong> {rp.callerProfile}</p>
                <p><strong>Situation:</strong> {rp.situation}</p>
                <p><strong>Good move:</strong> {rp.goodMove}</p>
                <div>{rp.entityIds.map((id) => <Chip key={id} e={ent(id)} />)}</div>
              </div>
            ))}
          </div>

          <div className="card quiz">
            <div className="row" style={{ justifyContent: "space-between" }}>
              <h2>Quiz</h2>
              <button type="button" className="ghost no-print" onClick={() => setShowAnswers(!showAnswers)}>
                {showAnswers ? "Hide answers" : "Show answers"}
              </button>
            </div>
            <ol>
              {result.pack.quiz.map((qz, i) => (
                <li key={i}>
                  {qz.q}
                  <ol type="A">
                    {qz.options.map((o, j) => (
                      <li key={j} className={showAnswers && j === qz.answerIndex ? "answer" : ""}>{o}</li>
                    ))}
                  </ol>
                  {showAnswers && <p className="muted">{qz.explain}</p>}
                </li>
              ))}
            </ol>
          </div>

          <div className="card no-print">
            <h2>How this pack was made</h2>
            <ul className="trace">
              {result.trace.map((t, i) => (
                <li key={i}><strong>{t.step}.</strong> {t.detail}</li>
              ))}
              <li><strong>Qloo calls.</strong> {result.qlooCalls}</li>
            </ul>
            {result.scan.errors.length > 0 && <p className="muted">Some Qloo lookups came back empty: {result.scan.errors.slice(0, 3).join("; ")}</p>}
          </div>
        </>
      )}
    </main>
  );
}

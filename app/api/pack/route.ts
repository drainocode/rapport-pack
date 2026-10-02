import { NextResponse } from "next/server";
import { QlooClient } from "@/lib/qloo";
import { makeChat } from "@/lib/llm";
import { buildPack } from "@/lib/agent";
import { AGE_BANDS } from "@/lib/scan";

export const runtime = "nodejs";
export const maxDuration = 60;

const clean = (v: unknown, max = 80) => (typeof v === "string" ? v.trim().slice(0, max) : "");

export async function POST(req: Request) {
  const qlooKey = process.env.QLOO_API_KEY;
  const llmKey = process.env.LLM_API_KEY;
  if (!qlooKey || !llmKey) {
    return NextResponse.json({ error: "Server is missing QLOO_API_KEY or LLM_API_KEY. See README." }, { status: 500 });
  }
  let body: any = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Send JSON" }, { status: 400 });
  }
  const input = {
    callerCity: clean(body.callerCity),
    agentCity: clean(body.agentCity),
    ageBand: AGE_BANDS.includes(body.ageBand) ? body.ageBand : undefined,
    lineOfBusiness: clean(body.lineOfBusiness, 120) || "customer support",
  };
  if (!input.callerCity || !input.agentCity) {
    return NextResponse.json({ error: "Both cities are required" }, { status: 400 });
  }
  const q = new QlooClient({ apiKey: qlooKey, baseUrl: process.env.QLOO_BASE_URL });
  const chat = makeChat({
    baseUrl: process.env.LLM_BASE_URL || "https://generativelanguage.googleapis.com/v1beta/openai",
    apiKey: llmKey,
    model: process.env.LLM_MODEL || "gemini-2.5-flash",
  });
  try {
    const result = await buildPack(q, chat, input);
    return NextResponse.json(result);
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Something went wrong" }, { status: 502 });
  }
}

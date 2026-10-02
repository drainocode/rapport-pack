// Minimal OpenAI-compatible chat client with tool calling.
// Works with any endpoint that speaks /chat/completions (Gemini's OpenAI layer, OpenAI, OpenRouter, Groq...).

export type ChatMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: ToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

export type ToolCall = { id: string; type: "function"; function: { name: string; arguments: string } };

export type ToolSpec = {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
};

export type ChatFn = (messages: ChatMessage[], tools: ToolSpec[], wantJson: boolean) => Promise<{
  content: string | null;
  tool_calls: ToolCall[];
}>;

export function makeChat(opts: { baseUrl: string; apiKey: string; model: string; fetchImpl?: typeof fetch }): ChatFn {
  const f = opts.fetchImpl || fetch;
  const url = opts.baseUrl.replace(/\/$/, "") + "/chat/completions";
  return async (messages, tools, wantJson) => {
    const body: Record<string, unknown> = { model: opts.model, messages, temperature: 0.4 };
    if (tools.length) body.tools = tools;
    if (wantJson && !tools.length) body.response_format = { type: "json_object" };
    const res = await f(url, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${opts.apiKey}` },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`LLM call failed (${res.status}): ${text.slice(0, 300)}`);
    const data = JSON.parse(text);
    const msg = data?.choices?.[0]?.message ?? {};
    return { content: msg.content ?? null, tool_calls: Array.isArray(msg.tool_calls) ? msg.tool_calls : [] };
  };
}

export function extractJson(text: string): any {
  const cleaned = text.replace(/^```(?:json)?/m, "").replace(/```\s*$/m, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("Model did not return JSON");
  return JSON.parse(cleaned.slice(start, end + 1));
}

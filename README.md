# Rapport Pack

Cultural briefings, role plays and a quiz for contact centre agents who serve callers in another country. Built for the Qloo Agentic Hackathon.

Type where the callers are (Manchester), where the agents live (Lagos), the typical caller age and the line of business. The app asks Qloo's taste graph what people in both places like, finds the honest overlap, and has an agent turn that into a one-page pack a team lead can print for tomorrow's huddle.

## Why it needs Qloo

Offshore agents are told to "build rapport" with callers whose world they have never seen. Generic AI briefings fall back on stereotypes. This app only talks about artists, shows, films, brands and places that Qloo actually ranks for that market and age band, and it looks for things the agent can mention truthfully because they rank where the agent lives too.

## How it works

1. **Taste scan.** For each city: `/v2/insights` for artists, TV shows, films and brands (with `signal.location.query` and, for callers, `signal.demographics.age`), plus places (with `filter.location.query`).
2. **Shared ground.** Entities that rank in both cities.
3. **Bridges.** For music, TV and film, the agent's top home picks go in as `signal.interests.entities` against the caller city. Qloo returns what that market likes that sits closest to the agent's own taste.
4. **Agent.** A tool-calling model gets the scan and can call `qloo_insights`, `qloo_search` and `qloo_tags` up to 4 times to fill gaps, then writes the pack as JSON.
5. **Grounding check.** Every cited Qloo id is checked against what Qloo actually returned. Anything the model made up is dropped, and the page says how many were removed.

The pack covers: what callers love, honest shared ground, five openers (only for when the caller opens the door), what to avoid, three role plays for the line of business, and a five-question judgement quiz with answers. It downloads as Markdown or prints to one page.

## Run it

```
cp .env.example .env.local   # add your Qloo hackathon key and an LLM key
npm install
npm run dev
```

- `QLOO_API_KEY`: hackathon key. It only works on `https://hackathon.api.qloo.com`.
- `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL`: any OpenAI-compatible endpoint with tool calling. Defaults to Google Gemini's OpenAI layer.

Tests (mocked Qloo and model): `npm test`. Type check: `npm run typecheck`.

## Deploy

Import the repo into Vercel, add the environment variables, deploy.

## License

MIT

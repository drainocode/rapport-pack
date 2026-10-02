# Devpost submission text (paste into the form)

## Project name
Rapport Pack

## Tagline
Qloo-grounded cultural briefings and role plays for contact centre agents serving callers in another country.

## Inspiration
I have trained contact centre agents for more than ten years. Many of them sit in Lagos, Manila or Nairobi and serve callers in the UK or the US. Every induction has a slide that says "build rapport", and almost none of them say how. Agents end up with stereotypes, or with small talk that sounds forced and makes the call longer. Generic AI makes this worse because it is confident about culture it does not know.

## What it does
A team lead enters where the callers are, where the agents live, the typical caller age and the line of business. Rapport Pack returns a one-page briefing:
- what callers in that market and age band actually like (music, TV, film, brands, local spots), from Qloo
- honest shared ground: things that rank in both cities, plus "bridge" picks Qloo finds by seeding the caller market with the agent's own taste, so nobody has to fake an interest
- five openers, each with a "use when" rule, because the fix always comes first
- an avoid list
- three role plays written for that line of business
- a five-question judgement quiz with answers

It prints to one page or downloads as Markdown for the morning huddle.

## How we built it
Next.js on Vercel. The Qloo Insights API does the heavy lifting: a taste scan per city with `signal.location.query` and `signal.demographics.age`, places with `filter.location.query`, and bridge queries that pass the agent's home favourites as `signal.interests.entities` against the caller city. A tool-calling model gets the scan and can call `qloo_insights`, `qloo_search` and `qloo_tags` to dig further, then writes the pack. A grounding check drops any cultural reference whose Qloo id was not actually returned, and the page shows how many were removed and which tools the agent called.

## Why it needs Qloo
Without Qloo this is a stereotype generator. With Qloo every reference is something people in that market and age band rank highly, and the shared-ground section only exists because Qloo can relate tastes across two cities.

## Challenges
Places and media need different location parameters, and some city and age combinations come back thin, so the scan runs each category on its own and reports gaps instead of failing.

## What's next
Pack history per team, a coaching mode that scores an agent's role-play transcript against the pack, and more caller markets per pack.

## Built with
nextjs, typescript, qloo-api, gemini, vercel

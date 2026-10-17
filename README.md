# [Project Name]

> AI trip planner that turns the places you've saved online into a costed, multi-currency itinerary — and adapts when plans change.

Built at the **IKU Womxn in STEM Hackathon** (KCL · Imperial · UCL), 17–18 October 2026.

---

## The problem

Planning a trip means twenty open tabs, a camera roll full of TikTok screenshots, and no real idea what any of it will cost — especially across currencies. Once you're there, plans break (rain, closures, overspending) and you're stuck re-planning in a language you don't speak.

## The solution

1. **Sign up** and tell us where and when you're going — countries, cities and dates for each stop.
2. **Pick interests** from activities that actually make sense for that destination *and season* (no snorkelling suggestions for Norway in winter).
3. **Import inspiration** — paste TikTok links or upload screenshots of places you've seen online. We extract the places automatically.
4. **Get an itinerary** — day-by-day, mapped, and costed in local currency *and* your home currency.
5. **Edit by chatting** — "swap day 2 and 3", "cheaper dinner in Osaka", "add more food spots".
6. **Travel with it** — the app knows where you are in your trip, coaches you on useful phrases, and translates live by voice.

---

## Features

### Core
- **Destination-aware interests** — Gemini generates activity options relevant to the chosen places and season.
- **Link & screenshot import** — TikTok links are resolved via TikTok's oEmbed endpoint (caption + thumbnail); screenshots go to Gemini's multimodal input. Extracted places feed the itinerary.
- **Structured itinerary generation** — Gemini returns itinerary data as JSON against a fixed schema, so every item can be rendered, edited, costed and re-planned.
- **Chat-based editing** — natural-language changes applied to the structured itinerary.

### Date & season awareness
- **Dates per city** are part of trip input, and every itinerary item has a date.
- **Public holidays** for each country on the route are fetched from Nager.Date and passed into the Gemini prompt.
- **Closure checker** — after generation, a deterministic pass in code cross-checks every item's date against the holiday list. Risky items are flagged and sent back to the agent for re-planning.
- **Closures become suggestions** — holidays shut things but also create events (e.g. New Year closures in Japan → hatsumōde, the first shrine visit of the year).
- **Seasonal filtering** — interests and activities are filtered by season. Near-term trips use Open-Meteo forecasts; trips further out use historical climate averages.
- **Honest about opening hours** — uncertain items are marked "check hours before going" rather than presented as fact. Stretch: Gemini's Google Search grounding for live closure checks (test early — may not combine cleanly with structured JSON output).

### Money layer (Wise track)
- **Every itinerary item is costed** in local currency and converted to the user's home currency at live rates.
- **Budget per day and per city**, with a running trip total.
- **"Load your card" prompts** — e.g. "You'll spend ~¥85,000 in Kyoto — convert before Tuesday."
- **Overspend alerts** that suggest cheaper swaps.
- **FX history charts** showing how rate moves change the trip cost.

### Adaptive agent (incident.io track)
- **Edits change priorities, not just items** — when the user changes what matters ("actually I hate crowds", "cut the budget by £200", "we're arriving a day late"), the agent drops conclusions that no longer hold, re-plans everything affected (other days, budget, closure conflicts) and explains what it changed and why.
- **Closure conflicts** — when a must-see from the user's TikToks falls on a holiday closure, the agent weighs the conflict and either moves it to another day or replaces it, explaining the trade-off.

### Voice (ElevenLabs track)
- **Phrase coach** — before the trip, learn useful phrases for each destination, spoken aloud.
- **Live translator** — during the trip, speak and get a spoken translation. Context-aware: it knows which city you're in from the itinerary and a **trip clock** (simulated date/time for demo purposes).

### Extras
- **Map view** of each day's stops (Leaflet + OpenStreetMap).
- **Stretch: group mode** — friends join a trip and split costs, each in their own currency.

---

## Why this matters for Wise

Wise's product pillars are transparency, convenience, price, speed and coverage. Travel is where most people first deal with foreign currency — and where hidden fees and confusing conversions hurt most. This project:

- Shows the **true cost of a trip** before you go (transparency).
- Removes the friction of planning, budgeting and translating in one place (convenience).
- Tells you **when and how much to convert**, in every currency on your route (coverage).
- Could ship as a **"Trips" feature inside the Wise app**, driving card spend and currency conversions.

---

## Tracks

| Track | How we qualify |
|---|---|
| **Wise (Main Track)** — Max Ease | Multi-currency budgeting, live FX, conversion prompts, friction removal across trip planning |
| **incident.io** — Adaptable Agents | Chat edits that change priorities or correct assumptions, plus closure conflicts: abandons outdated plans, weighs conflicting data (holidays vs. user must-sees vs. budget), changes course without paralysis |
| **ElevenLabs** — Voice & Audio AI | Phrase coach and live voice translator |
| **MLH: Best Use of Gemini API** | Itinerary generation, link/screenshot extraction (multimodal), chat editing, re-planning |
| **MLH: Best Use of Tiger Data** | Postgres for trips/itineraries + time-series for spending and FX rates |
| **MLH: Best Use of Vultr** | Deployment |
| **MLH: Best Domain Name from GoDaddy Registry** | Project domain |
| **DEV Writing Challenge** | Post-hackathon write-up |

> Check with organisers whether there's a cap on MLH prizes per team. If so, prioritise Gemini and Tiger Data.

---

## Tech stack

| Layer | Choice |
|---|---|
| Frontend | _[e.g. React + Vite]_ |
| Backend | _[e.g. FastAPI]_ |
| Database | Tiger Data (PostgreSQL + time-series) |
| AI | Google Gemini API (structured JSON output, multimodal) |
| Voice | ElevenLabs speech-to-text + text-to-speech |
| Maps | Leaflet + OpenStreetMap |
| Weather | Open-Meteo (forecast + historical climate) |
| Public holidays | Nager.Date |
| FX rates | _[Wise sandbox API if available, otherwise a public rates API]_ |
| Hosting | Vultr |
| Domain | GoDaddy Registry |

---

## Getting started

```bash
# Clone
git clone [repo-url]
cd [repo-name]

# Environment variables — copy and fill in
cp .env.example .env
```

`.env.example`:
```
GEMINI_API_KEY=
ELEVENLABS_API_KEY=
DATABASE_URL=          # Tiger Data connection string
FX_API_KEY=
```

> Never commit `.env`. API keys stay local.

_[Add install and run commands for frontend and backend once the stack is set.]_

---

## Demo

**Demo trip:** Seoul → Osaka → Kyoto → Tokyo. Two currencies (KRW, JPY) and two languages show off the money layer and the phrase coach.

**2-minute video outline**

| Time | Beat |
|---|---|
| 0:00–0:10 | Problem: "planning a trip means 20 tabs and no idea what it costs" |
| 0:10–0:35 | Paste TikToks → places appear |
| 0:35–1:00 | Itinerary with live yen/won budget |
| 1:00–1:25 | Kyoto on 1 Jan: closure flagged → agent swaps in hatsumōde at Fushimi Inari and explains why (this happened to us planning the real trip) |
| 1:25–1:45 | Phrase coach speaking Japanese |
| 1:45–2:00 | Wise business case |

---

## Known limitations

- **TikTok saved folders/collections** have no public API, so import works from pasted links and screenshots instead.
- **Trip clock** simulates being mid-trip for the demo; a production version would use device location and time.
- Costs are AI estimates, not live prices.
- Holiday data covers public holidays; individual venue closures and opening hours are flagged as "check before going" rather than guaranteed.

---

## Hackathon build plan (internal — trim before final submission if needed)

**Key deadlines**
- Devpost draft: **Sat 17 Oct, 11:00 pm** (aim for 10:30 pm)
- Final submission (GitHub link + 2-min video): **Sun 18 Oct, 12:00 pm** (aim for 11:45 am)
- All team members must be present at judging

**Roles** (merge if the team is smaller)
- **A** — frontend
- **B** — backend + Gemini agent
- **C** — voice + money layer
- **D** — design, pitch, video, Devpost; floats to help

**Saturday**
1. **11:30–12:30** — Lock scope. Repo, API keys (Gemini, ElevenLabs, Tiger Data, Vultr, GoDaddy), check Wise sandbox signup. Agree the **itinerary JSON schema** together — every item needs a date. D starts Devpost skeleton.
2. **12:30–16:00** — Core in parallel. A: trip creation (cities + dates) + interest chips. B: itinerary generation endpoint (holidays passed into prompt) + link/screenshot import. C: DB schema + costing/FX service + holidays fetch.
3. **16:00–17:00** — Integration #1: one ugly end-to-end flow (sign up → trip → interests → links → itinerary).
4. **17:00–21:00** — Budget view and alerts, chat editing, phrase coach (text-to-speech first).
5. **21:00–22:30** — Closure checker (reuses the chat-editing re-plan path). D submits Devpost draft by 22:30.
6. **22:30–02:00** — Deploy to Vultr, connect domain, bug fixes.
7. **02:00–07:00** — Sleep in shifts.

**Sunday**
1. **07:00–09:30** — Translation mode with trip clock, map view, UI polish, seed demo trip.
2. **09:30** — **Feature freeze.**
3. **09:30–11:00** — Record video, finish README credits, final deploy.
4. **11:00–11:45** — Submit on Devpost, tick every eligible side track.

**Rules to remember**
- One main track (Wise) + any eligible side tracks
- No cross-posting to other events
- No previous projects — everything built this weekend
- Credit all frameworks and APIs in this README
- Teams of up to 4

---

## Credits

Built with:
- [Google Gemini API](https://ai.google.dev/)
- [ElevenLabs](https://elevenlabs.io/)
- [Tiger Data](https://www.tigerdata.com/)
- [Vultr](https://www.vultr.com/)
- [GoDaddy Registry](https://www.godaddy.com/)
- [Leaflet](https://leafletjs.com/) + [OpenStreetMap](https://www.openstreetmap.org/)
- [Open-Meteo](https://open-meteo.com/)
- [Nager.Date](https://date.nager.at/)
- [TikTok oEmbed](https://developers.tiktok.com/doc/embed-videos/)
- _[Add every other framework/library used]_

## Team

- _[Name]_ — _[role]_
- _[Name]_ — _[role]_
- _[Name]_ — _[role]_
- _[Name]_ — _[role]_

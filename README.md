# FlightViz — Crew Scheduling Visualizer

An interactive map/globe visualizer for cabin-crew scheduling solver output. Load a
solver result JSON and explore, at any point in the planning horizon, which flights are
in the air, who is crewing them, where crew are on the ground, and which mandatory
breaks are in effect.

Built with SvelteKit + deck.gl + MapLibre, and runs on [Bun](https://bun.sh).

## Quick start

```sh
bun install
bun run dev          # dev server with HMR
# bun run dev --open # …and open a browser tab
```

Then either **Load example data** from the sidebar, or **Upload JSON** to load your own
solver result. To produce a static build:

```sh
bun run build        # output in .svelte-kit
bun run preview      # preview the production build
bun run check        # type-check (svelte-check)
```

## Input format

The app reads the JSON emitted by the solver (`save_combined_result` /
`result_*.json`). The shape (see `src/lib/types.ts`):

```jsonc
{
  "meta":   { "horizon_end": 43200, "num_flights": 3485, "covered_flights": 3408, ... },
  "crew":   [ { "id": 0, "base": "ORD" }, ... ],
  "flights":[ { "id": 1, "flight_num": "1234", "origin": "ORD", "dest": "CVG",
               "dep_min": 595, "arr_min": 665, "duration": 70, "min_crew": 1 }, ... ],
  "routes": [ { "crew_id": 0, "base": "ORD", "crew_count": 1,
               "legs":   [ { "type": "flight"|"deadhead", "from": "ORD", "to": "CVG",
                            "dep": 595, "arr": 665, "flight_id": 1 }, ... ],
               "breaks": [ { "start": 12501, "end": 15381, "type": "home_48h" }, ... ] }, ... ],
  "uncovered_flights": [ { "origin": "ORD", "dest": "LIT", "dep_min": 8650,
                          "missing_slots": 1, ... }, ... ]
}
```

All times are **minutes from the start of the horizon**. The UI renders them as
`Day D HH:MM`. The `breaks` field is optional — see *Home breaks* below.

## Features

### Time scrubbing
- A **time scrubber** drives the whole view; the map shows a snapshot of everything
  airborne at the current minute.
- The time readout above the scrubber is **editable** — type a Day / HH / MM to jump the
  clock directly (clamped to the horizon).
- The **Airborne Now** list shows every flight in the air at the current time, with a
  per-flight progress bar; click one to open its detail.

### Map / globe
- 2D **map** and 3D **globe** view modes (top-right toggle).
- Flight arcs are colored and layered by coverage status so a green arc never hides a red
  one on a shared hub. Arc width scales with flight count on the route.
- Airport markers carry a four-corner crew badge: **based** (blue), **available**
  (green), **visiting** (yellow), and **on break / unavailable** (red).

### Layers filter
Toggle visibility of **Covered**, **Partial**, **Uncovered**, and **Deadhead** arcs.
These toggles also drive the airport schedule list (below).

### Airport filter
- Pick **one airport** to show only flights that touch it (departing *or* arriving), or
  **two airports** to show only flights between them (either direction).
- Select via the sidebar dropdowns (slot **A**, optional slot **B**) or by clicking an
  airport on the map and pressing **Filter map** in its detail panel. Filtered airports
  are highlighted amber.
- An expandable **All scheduled flights** list shows that airport's (or pair's) entire
  in/out schedule across the whole horizon — not just what's airborne now — each row
  showing route, status, crew `actual/min`, flight number and **departure → arrival**
  times. The list honors the global Layers status toggles. Clicking a flight **jumps the
  clock** to its departure time.

### Crew focus
Search by crew ID or base to isolate a single crew member: the map shows only their
legs, and the sidebar lists their full route timeline with the active leg highlighted.

### Detail panels
Click any flight, airport, or route to drill in:
- **Flight** — status, times, duration, min crew, and assigned / deadhead crew.
- **Airport** — based vs. visiting crew on the ground (split by available / on-break),
  with break type and time remaining, plus departing and arriving flight lists.
- **Route** — coverage breakdown across all flights on an origin→destination pair.

### Home breaks
Mandatory 48h home breaks (purple) are shown for any continuous **≥48h stay at base**.
This is derived from each crew's legs and is a superset of the solver's emitted `breaks`
array, so it reproduces every mandatory break and also surfaces incidental long home
rests. If a result file predates the `breaks` field, the windows are derived entirely
from the legs.

## Tech

SvelteKit (Svelte 5 runes), deck.gl (`ArcLayer`, `ScatterplotLayer`, `TextLayer`),
MapLibre GL basemap, Tailwind utility classes, TypeScript. See `CLAUDE.md` for the
Bun-first conventions used in this repo.

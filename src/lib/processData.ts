import type {
	ScheduleData,
	FlightInfo,
	ArcRenderData,
	RouteData,
	AirportInfo,
	FlightStatus,
	CrewAtAirport,
	BreakType,
	RouteLeg
} from './types';
import { getAirportCoords } from './airports';

// ── Duty / availability rules ─────────────────────────────────────────────────
// Max continuous duty window before a rest break is required.
const MAX_DUTY_MIN = 14 * 60; // 14 hours
// Overnight rest to clear duty counter (at a non-home station).
const REST_DUTY_CLEAR_MIN = 8 * 60; // 8 hours continuous rest
const DELTA_TA = 45;           // min ground time between consecutive legs
// Home base rest to reset fully (48-hour break).
const HOME_BREAK_MIN = 48 * 60; // 48 hours
/**
 * Home-break windows derived from a crew's legs: every continuous stay at home base
 * lasting >= HOME_BREAK_MIN (48h) is a home break, shown for the first 48h of that
 * stay. This is the PHYSICAL definition — a crew benched at home for >=48h is resting,
 * regardless of why — and is what the viz displays (purple).
 *
 * It is a strict SUPERSET of the solver's emitted `breaks`: the solver only flags
 * MANDATORY breaks (stays that followed a maxed-out duty-day streak, see
 * derive_home_breaks() in crew_ddd_v2.py), so it omits incidental long home rests —
 * e.g. a hub-based crew that keeps dipping through base never trips the duty cap, yet
 * still sits home for days (crew 116 in result_ZW.json: ~70h at ORD from Day 3, which
 * the solver leaves out of `breaks`). Deriving from base-stays here reproduces every
 * mandatory window AND surfaces those incidental rests.
 *
 * NB the away-spell heuristic this replaced was modeling the wrong quantity (time AWAY
 * from base, not time AT base), so it both missed real home rests and invented phantom
 * ones.
 */
function homeBreakWindows(base: string, legs: RouteLeg[]): { start: number; end: number; type: BreakType }[] {
	if (!base || legs.length === 0) return [];
	const seq = [...legs].sort((a, b) => a.dep - b.dep);
	const out: { start: number; end: number; type: BreakType }[] = [];
	for (let i = 0; i < seq.length; i++) {
		const l = seq[i];
		if (l.to !== base) continue;
		// Time benched at base = gap until the next departure (∞ if this is the last leg).
		const stay = i + 1 < seq.length ? seq[i + 1].dep - l.arr : Infinity;
		if (stay >= HOME_BREAK_MIN) {
			out.push({ start: l.arr, end: l.arr + HOME_BREAK_MIN, type: 'home_48h' });
		}
	}
	return out;
}

/**
 * Given a crew's route and a point in time, determine:
 *  - where they are on the ground (airport IATA), or null if airborne
 *  - hours worked since last rest break
 *  - availability status
 */
export function computeCrewGroundStatus(
	crewId: number,
	base: string,
	legs: RouteLeg[],
	currentTime: number,
	breaks?: { start: number; end: number; type: BreakType }[]
): { location: string | null; crewInfo: Omit<CrewAtAirport, 'isHome' | 'isVisiting'> } {
	if (legs.length === 0) {
		// No route — crew is at base, fully available, 0 hours worked
		return {
			location: base,
			crewInfo: {
				id: crewId,
				base,
				available: true,
				breakType: null,
				breakRemainingMin: null,
				dutyWorkedMin: 0,
				homeWorkedMin: 0,
				arrivedVia: null,
				nextLeg: null
			}
		};
	}

	// Find what they're doing at currentTime
	const activeLeg = legs.find(l => l.dep <= currentTime && l.arr >= currentTime);
	if (activeLeg) {
		// They're airborne right now — not on the ground
		return { location: null, crewInfo: { id: crewId, base, available: false, breakType: null, breakRemainingMin: null, dutyWorkedMin: 0, homeWorkedMin: 0, arrivedVia: null, nextLeg: null } };
	}

	// Find the most recent completed leg (arr <= currentTime)
	const pastLegs = legs.filter(l => l.arr <= currentTime);
	if (pastLegs.length === 0) {
		// Haven't started yet — at base
		return {
			location: base,
			crewInfo: {
				id: crewId,
				base,
				available: true,
				breakType: null,
				breakRemainingMin: null,
				dutyWorkedMin: 0,
				homeWorkedMin: 0,
				arrivedVia: null,
				nextLeg: legs[0] ?? null
			}
		};
	}

	// Sort past legs by arrival
	const sortedPast = [...pastLegs].sort((a, b) => a.arr - b.arr);
	const lastLeg = sortedPast[sortedPast.length - 1];
	const location = lastLeg.to;

	// Find next scheduled leg
	const futurelegs = legs.filter(l => l.dep > currentTime).sort((a, b) => a.dep - b.dep);
	const nextLeg = futurelegs[0] ?? null;

	// ── Duty clock ─────────────────────────────────────────────────────────────
	// dutyWorkedMin — block work since the last >=8h OVERNIGHT rest (the current duty
	// period). Resets on any >=8h gap (and naturally on a >=48h home break too). This is
	// the figure the 14h MAX_DUTY cap is checked against.
	const allLegs = [...legs].sort((a, b) => a.dep - b.dep);
	let dutyWorkedMin = 0;
	for (let i = 0; i < allLegs.length; i++) {
		const leg = allLegs[i];
		if (leg.dep > currentTime) break;
		const worked = Math.min(leg.arr, currentTime) - leg.dep;
		if (i === 0) {
			dutyWorkedMin = worked;
			continue;
		}
		const prevLeg = allLegs[i - 1];
		if (prevLeg.arr > currentTime) break;
		const gap = leg.dep - prevLeg.arr;
		// Any >=8h gap (overnight rest or longer) starts a fresh duty period.
		dutyWorkedMin = gap >= REST_DUTY_CLEAR_MIN ? worked : dutyWorkedMin + worked;
	}
	// Idle since the last landing — used to detect an in-progress / completed break.
	const idleMin = currentTime - lastLeg.arr;

	// ── 48h home break ─────────────────────────────────────────────────────────
	// A crew sitting at home base for >=48h is on a home break (purple). The 14h-duty
	// / 8h-rest logic below does NOT model this — its 8h-rest reset would otherwise
	// mark a benched crew "available" — so check it FIRST, taking precedence.
	//
	// We derive the windows from the crew's legs (every >=48h base stay) rather than
	// reading the solver's `breaks` field, because that field carries only MANDATORY
	// breaks (those after a maxed-out duty streak) and omits incidental long home
	// rests the user still wants shown — e.g. crew 116, hub-based at ORD, sits home
	// ~70h from Day 3 but the solver leaves it out of `breaks`. The base-stay
	// derivation is a strict superset of `breaks`, so it reproduces every mandatory
	// window and adds the incidental ones. We union with the solver's home_48h
	// windows defensively, in case a future export emits one we can't re-derive.
	const derived = homeBreakWindows(base, legs);
	const solverHomeBreaks = breaks?.filter(b => b.type === 'home_48h') ?? [];
	const homeBreaks = [
		...derived,
		...solverHomeBreaks.filter(s => !derived.some(d => d.start === s.start))
	];
	const activeBreak = homeBreaks.find(w => currentTime >= w.start && currentTime < w.end);

	// ── Home / away clock ──────────────────────────────────────────────────────
	// homeWorkedMin — wall-clock time the crew has been "away" on the current trip:
	// from when they FIRST left home base after their last >=48h home break, up to NOW —
	// or frozen at the home-break START while they are on a home break. Mirrors the
	// solver's away budget: brief touches at base do NOT reset it; only a completed
	// >=48h home stay re-anchors the start. (This is wall-clock elapsed, not block work.)
	const HOME_ANCHOR_NONE = -1;
	let awaySince = HOME_ANCHOR_NONE; // dep of the first leave-home after the last break
	let homeSince: number | null = null; // arrival that began the current home stay
	for (const l of allLegs) {
		if (l.dep > currentTime) break;
		if (l.from === base && l.to !== base) {
			// Leaving home: seed on first-ever departure, re-anchor only if the stay we're
			// leaving was itself a completed >=48h home break.
			if (awaySince === HOME_ANCHOR_NONE) awaySince = l.dep;
			else if (homeSince !== null && l.dep - homeSince >= HOME_BREAK_MIN) awaySince = l.dep;
			homeSince = null;
		}
		if (l.to === base && l.arr <= currentTime && homeSince === null) homeSince = l.arr;
	}
	// On a home break iff currently sitting in a >=48h home stay (its window starts at
	// this arrival). In that case the away clock freezes at the break start.
	const onHomeBreak = lastLeg.to === base && homeBreaks.some(w => w.start === lastLeg.arr);
	const homeClockEnd = onHomeBreak ? lastLeg.arr : currentTime;
	const homeWorkedMin = awaySince === HOME_ANCHOR_NONE ? 0 : Math.max(0, homeClockEnd - awaySince);

	if (activeBreak) {
		return {
			location,
			crewInfo: {
				id: crewId, base, available: false, breakType: 'home_48h',
				breakRemainingMin: Math.max(0, activeBreak.end - currentTime),
				dutyWorkedMin, homeWorkedMin, arrivedVia: lastLeg, nextLeg
			}
		};
	}

	// ── 45-min turnaround: physically can't depart before this clears ─────────
	if (currentTime - lastLeg.arr < DELTA_TA) {
		return {
			location,
			crewInfo: {
				id: crewId, base, available: false, breakType: 'turnaround_45m',
				breakRemainingMin: DELTA_TA - (currentTime - lastLeg.arr),
				dutyWorkedMin, homeWorkedMin, arrivedVia: lastLeg, nextLeg
			}
		};
	}

	// ── Determine availability ────────────────────────────────────────────────
	// Check if current idle time constitutes a rest break
	if (lastLeg.to === base && idleMin >= HOME_BREAK_MIN) {
		// Completed a 48h home break — fully available; duty clock reset. The home/away
		// clock stays frozen at this break's start (homeWorkedMin) until they next depart.
		return {
			location,
			crewInfo: { id: crewId, base, available: true, breakType: null, breakRemainingMin: null, dutyWorkedMin: 0, homeWorkedMin, arrivedVia: lastLeg, nextLeg }
		};
	}
	if (idleMin >= REST_DUTY_CLEAR_MIN) {
		// Completed an 8h overnight rest — duty clock resets, but the home clock keeps
		// the work accumulated since the last 48h home break.
		return {
			location,
			crewInfo: { id: crewId, base, available: true, breakType: null, breakRemainingMin: null, dutyWorkedMin: 0, homeWorkedMin, arrivedVia: lastLeg, nextLeg }
		};
	}

	// In-progress 8h mandatory rest: gap before next leg is ≥8h (or no next leg),
	// meaning this is a genuine inter-duty rest, not a short turnaround.
	const isInterDutyRest = nextLeg === null || (nextLeg.dep - lastLeg.arr) >= REST_DUTY_CLEAR_MIN;
	if (isInterDutyRest) {
		return {
			location,
			crewInfo: {
				id: crewId, base, available: false, breakType: 'rest_8h',
				breakRemainingMin: REST_DUTY_CLEAR_MIN - idleMin,
				dutyWorkedMin, homeWorkedMin, arrivedVia: lastLeg, nextLeg
			}
		};
	}

	// Check if they need a break (exceeded max duty or approaching)
	if (dutyWorkedMin >= MAX_DUTY_MIN) {
		// Requires 8h rest at minimum; if at base, counts towards 48h break
		const isAtBase = location === base;
		const breakType: BreakType = isAtBase ? 'home_48h' : 'duty_14h';
		const breakRequired = isAtBase ? HOME_BREAK_MIN : REST_DUTY_CLEAR_MIN;
		const breakRemaining = Math.max(0, breakRequired - idleMin);
		return {
			location,
			crewInfo: { id: crewId, base, available: false, breakType, breakRemainingMin: breakRemaining, dutyWorkedMin, homeWorkedMin, arrivedVia: lastLeg, nextLeg }
		};
	}

	// Within duty limits — available
	return {
		location,
		crewInfo: { id: crewId, base, available: true, breakType: null, breakRemainingMin: null, dutyWorkedMin, homeWorkedMin, arrivedVia: lastLeg, nextLeg }
	};
}

export interface ProcessedData {
	arcs: ArcRenderData[];
	deadheadArcs: ArcRenderData[];
	routes: Map<string, RouteData>;
	airports: Map<string, AirportInfo>;
	unknownAirports: Set<string>;
}

/**
 * Compute a perpendicular offset vector for a pair of airports, always derived
 * from the same canonical direction (alphabetically first → second) regardless
 * of which airport is the flight's origin/destination.
 *
 * This ensures that ORD→COU (side +1) and COU→ORD (side -1) are nudged to
 * *opposite* sides of the great-circle path rather than the same side, which
 * would happen if each arc computed its own perpendicular from its own bearing
 * (since swapping src/dst produces the same perpendicular vector).
 */
function canonicalPerpendicularOffset(
	a: [number, number],
	b: [number, number],
	aIata: string,
	bIata: string,
	side: 1 | -1,
	distDeg = 0.15
): { aSide: [number, number]; bSide: [number, number] } {
	// Always compute dx/dy from the alphabetically-first IATA toward the second
	// so both directions of a route share the same reference vector.
	const [first, second] = aIata < bIata ? [a, b] : [b, a];
	const dx = second[0] - first[0];
	const dy = second[1] - first[1];
	const len = Math.sqrt(dx * dx + dy * dy) || 1;
	const px = (-dy / len) * distDeg * side;
	const py = ( dx / len) * distDeg * side;
	return {
		aSide: [a[0] + px, a[1] + py] as [number, number],
		bSide: [b[0] + px, b[1] + py] as [number, number]
	};
}

/**
 * Legacy offset helper: shifts an arc sideways relative to its own bearing.
 * Used for uncovered/partial arcs on routes that also have covered flights
 * (same direction — no bidirectional collision, so any consistent offset is fine).
 */
function perpendicularOffset(
	src: [number, number],
	dst: [number, number],
	side: 1 | -1 = 1,
	distDeg = 0.15
): [[number, number], [number, number]] {
	const dx = dst[0] - src[0];
	const dy = dst[1] - src[1];
	const len = Math.sqrt(dx * dx + dy * dy) || 1;
	const px = (-dy / len) * distDeg * side;
	const py = ( dx / len) * distDeg * side;
	return [
		[src[0] + px, src[1] + py],
		[dst[0] + px, dst[1] + py]
	];
}

/**
 * Airport filter predicate for a leg/flight (origin → dest):
 *  - no airport selected → everything passes
 *  - only A selected → flights that touch A (depart from or arrive at it)
 *  - A and B selected → only flights between A and B, in either direction
 */
function passesAirportFilter(
	origin: string,
	dest: string,
	a: string | null,
	b: string | null
): boolean {
	if (!a) return true;
	if (!b) return origin === a || dest === a;
	return (origin === a && dest === b) || (origin === b && dest === a);
}

export function processData(
	data: ScheduleData,
	timeStart: number,
	timeEnd: number,
	crewId: number | null = null,
	airportFilter: { a: string | null; b: string | null } | null = null
): ProcessedData {
	const { flights, routes, uncovered_flights } = data;
	const fa = airportFilter?.a ?? null;
	const fb = airportFilter?.b ?? null;

	// Build crew assignments per flight
	// flight_id can be null for commercial deadhead arcs — skip those
	const flightCrew = new Map<number, { flight: number[]; deadhead: number[] }>();
	for (const route of routes) {
		for (const leg of route.legs) {
			if (leg.flight_id == null) continue;
			if (!flightCrew.has(leg.flight_id)) {
				flightCrew.set(leg.flight_id, { flight: [], deadhead: [] });
			}
			const entry = flightCrew.get(leg.flight_id)!;
			if (leg.type === 'flight') entry.flight.push(route.crew_id);
			else entry.deadhead.push(route.crew_id);
		}
	}

	// Uncovered slots index — keyed by (origin:dest:dep_min) for unambiguous matching.
	// Previously used (flight_num:dep_min) which silently missed flights when the
	// flight_num in uncovered_flights didn't exactly match the one in flights[],
	// e.g. due to type coercion or leading-zero differences. Using origin+dest+dep_min
	// is structurally guaranteed to match since save_result() copies those fields
	// from the same Flight object into both arrays.
	const uncoveredMap = new Map<string, number>();
	for (const uf of uncovered_flights) {
		uncoveredMap.set(`${uf.origin}:${uf.dest}:${uf.dep_min}`, uf.missing_slots);
	}

	// Enrich all flights with status
	const flightInfos: FlightInfo[] = flights.map((f) => {
		const crew = flightCrew.get(f.id);
		const actual = crew?.flight.length ?? 0;
		const uncoveredKey = `${f.origin}:${f.dest}:${f.dep_min}`;
		const missing = Math.round(uncoveredMap.get(uncoveredKey) ?? 0);

		let status: FlightStatus;
		if (uncoveredMap.has(uncoveredKey)) {
			status = missing >= f.min_crew ? 'uncovered' : 'partial';
		} else if (actual === 0 && f.min_crew > 0) {
			status = 'uncovered';
		} else if (actual < f.min_crew) {
			status = 'partial';
		} else {
			status = 'covered';
		}

		return {
			...f,
			status,
			assigned_crew: crew?.flight ?? [],
			deadhead_crew: crew?.deadhead ?? [],
			actual_crew: actual,
			missing_slots: missing,
			crewDataAvailable: crew !== undefined
		};
	});

	// If crewId filter is active, build the set of flight IDs that crew member operates
	const crewFlightIds: Set<number> | null = crewId !== null
		? (() => {
			const ids = new Set<number>();
			const crewRoute = routes.find(r => r.crew_id === crewId);
			if (crewRoute) {
				for (const leg of crewRoute.legs) {
					if (leg.flight_id !== null) ids.add(leg.flight_id);
				}
			}
			return ids;
		})()
		: null;

	// The map always shows a time snapshot: only flights airborne at currentTime
	// (dep <= time <= arr). The airport filter further narrows that snapshot to flights
	// touching the selected airport(s). The full whole-schedule in/out list lives in the
	// sidebar's expandable list instead, so the map never floods with every arc.
	const windowFlights = flightInfos.filter((f) => {
		if (f.dep_min > timeStart || f.arr_min < timeEnd) return false;
		if (crewFlightIds !== null && !crewFlightIds.has(f.id)) return false;
		if (!passesAirportFilter(f.origin, f.dest, fa, fb)) return false;
		return true;
	});

	const unknownAirports = new Set<string>();

	// Track which routeKeys have at least one covered flight so we know whether
	// to offset the uncovered arc sideways (avoids pixel overlap on busy routes).
	const routeHasCovered = new Set<string>();
	for (const flight of windowFlights) {
		if (flight.status === 'covered') {
			routeHasCovered.add(`${flight.origin}→${flight.dest}`);
		}
	}

	// Group by (origin, dest) for RouteData and (origin, dest, status) for ArcRenderData
	const routeMap = new Map<string, RouteData>();
	const arcMap = new Map<string, ArcRenderData>();

	for (const flight of windowFlights) {
		const src = getAirportCoords(flight.origin);
		const dst = getAirportCoords(flight.dest);

		if (!src) unknownAirports.add(flight.origin);
		if (!dst) unknownAirports.add(flight.dest);
		if (!src || !dst) continue;

		const routeKey = `${flight.origin}→${flight.dest}`;
		const arcKey = `${routeKey}:${flight.status}`;

		// RouteData (all flights on this origin→dest)
		if (!routeMap.has(routeKey)) {
			routeMap.set(routeKey, {
				key: routeKey,
				origin: flight.origin,
				dest: flight.dest,
				flights: [],
				totalCrew: 0,
				deadheadCount: 0
			});
		}
		const route = routeMap.get(routeKey)!;
		route.flights.push(flight);
		route.totalCrew += flight.actual_crew;

		// ArcRenderData (split by status for multi-line coloring)
		if (!arcMap.has(arcKey)) {
			const reverseKey = `${flight.dest}→${flight.origin}:${flight.status}`;
			const hasCoveredOnRoute = routeHasCovered.has(routeKey);
			const hasReverseArc = arcMap.has(reverseKey);
			const needsOffset =
				(flight.status === 'uncovered' || flight.status === 'partial') &&
				(hasCoveredOnRoute || hasReverseArc);

			let arcSrc: [number, number];
			let arcDst: [number, number];

			if (needsOffset && hasReverseArc) {
				// A reverse-direction arc already exists at the same endpoints.
				// deck.gl draws ORD→COU and COU→ORD as the same symmetric curve,
				// so we must push them to *opposite* sides of the path.
				// Use a canonical offset vector (derived from alphabetically-first
				// IATA → second) so both arcs are nudged in truly opposite directions
				// rather than the same direction (which is what happens when each arc
				// calls perpendicularOffset with its own swapped src/dst).
				const rev = arcMap.get(reverseKey)!;
				const revSrcCoords = getAirportCoords(flight.dest)!;
				const revDstCoords = getAirportCoords(flight.origin)!;
				const revOffset = canonicalPerpendicularOffset(
					revSrcCoords, revDstCoords,
					flight.dest, flight.origin,
					-1
				);
				rev.sourcePosition = revOffset.aSide;
				rev.targetPosition = revOffset.bSide;

				const fwdOffset = canonicalPerpendicularOffset(
					src, dst,
					flight.origin, flight.dest,
					1
				);
				arcSrc = fwdOffset.aSide;
				arcDst = fwdOffset.bSide;
			} else if (needsOffset) {
				// Covered+uncovered on same one-way route — legacy offset is fine.
				[arcSrc, arcDst] = perpendicularOffset(src, dst, 1);
			} else {
				arcSrc = src;
				arcDst = dst;
			}

			arcMap.set(arcKey, {
				key: arcKey,
				routeKey,
				origin: flight.origin,
				dest: flight.dest,
				status: flight.status,
				sourcePosition: arcSrc,
				targetPosition: arcDst,
				count: 0
			});
		}
		arcMap.get(arcKey)!.count++;
	}

	// Deadhead arcs — one arc per (from, to) pair in window
	const dhMap = new Map<string, ArcRenderData>();

	for (const route of routes) {
		for (const leg of route.legs) {
			if (leg.type !== 'deadhead') continue;
			if (leg.dep > timeStart || leg.arr < timeEnd) continue;
			if (crewId !== null && route.crew_id !== crewId) continue; // crew filter
			if (!passesAirportFilter(leg.from, leg.to, fa, fb)) continue; // airport filter

			const src = getAirportCoords(leg.from);
			const dst = getAirportCoords(leg.to);
			if (!src) unknownAirports.add(leg.from);
			if (!dst) unknownAirports.add(leg.to);
			if (!src || !dst) continue;

			const key = `dh:${leg.from}→${leg.to}`;
			const routeKey = `${leg.from}→${leg.to}`;
			if (!dhMap.has(key)) {
				dhMap.set(key, {
					key,
					routeKey,
					origin: leg.from,
					dest: leg.to,
					status: 'deadhead',
					sourcePosition: src,
					targetPosition: dst,
					count: 0
				});
			}
			dhMap.get(key)!.count++;

			// Count deadheads on route
			if (routeMap.has(routeKey)) {
				routeMap.get(routeKey)!.deadheadCount++;
			}
		}
	}

	// ── Airport data ─────────────────────────────────────────────
	const airportMap = new Map<string, AirportInfo>();

	function ensureAirport(iata: string) {
		if (airportMap.has(iata)) return;
		const coords = getAirportCoords(iata);
		if (!coords) return;
		airportMap.set(iata, {
			iata,
			coords,
			basedCrew: [],
			departingCrewCount: 0,
			arrivingCrewCount: 0,
			flightsFrom: [],
			flightsTo: [],
			crewOnGround: []
		});
	}

	// Keep the filtered airport(s) on the map even when nothing is airborne to/from
	// them at this instant, so the user can always see what they've selected.
	if (fa) ensureAirport(fa);
	if (fb) ensureAirport(fb);

	// Seed from crew bases
	for (const c of data.crew) {
		ensureAirport(c.base);
		airportMap.get(c.base)?.basedCrew.push(c.id);
	}

	// Compute which crew are on the ground at each airport at currentTime
	// (use timeStart as the current snapshot time)
	for (const route of routes) {
		const crewRecord = data.crew.find(c => c.id === route.crew_id);
		const base = crewRecord?.base ?? route.base ?? '?';
		const { location, crewInfo } = computeCrewGroundStatus(route.crew_id, base, route.legs, timeStart, route.breaks);
		if (location !== null) {
			ensureAirport(location);
			const apt = airportMap.get(location);
			if (apt) {
				apt.crewOnGround.push({
					...crewInfo,
					isHome: location === base,
					isVisiting: location !== base
				});
			}
		}
	}

	// Also add crew with no routes who are implicitly at their base
	const routedCrewIds = new Set(routes.map(r => r.crew_id));
	for (const c of data.crew) {
		if (!routedCrewIds.has(c.id)) {
			ensureAirport(c.base);
			const apt = airportMap.get(c.base);
			if (apt) {
				apt.crewOnGround.push({
					id: c.id,
					base: c.base,
					isHome: true,
					isVisiting: false,
					available: true,
					breakType: null,
					breakRemainingMin: null,
					dutyWorkedMin: 0,
					homeWorkedMin: 0,
					arrivedVia: null,
					nextLeg: null
				});
			}
		}
	}

	// Seed from window flights
	for (const flight of windowFlights) {
		ensureAirport(flight.origin);
		ensureAirport(flight.dest);
		airportMap.get(flight.origin)?.flightsFrom.push(flight);
		airportMap.get(flight.dest)?.flightsTo.push(flight);
	}

	// Count crew movements in window
	const departingSet = new Map<string, Set<number>>(); // airport → crew IDs departing
	const arrivingSet = new Map<string, Set<number>>(); // airport → crew IDs arriving

	for (const route of routes) {
		for (const leg of route.legs) {
			if (leg.dep > timeStart || leg.arr < timeEnd) continue;
			if (crewId !== null && route.crew_id !== crewId) continue; // only airborne deadheads
			if (crewId !== null && route.crew_id !== crewId) continue; // crew filter
			if (!departingSet.has(leg.from)) departingSet.set(leg.from, new Set());
			if (!arrivingSet.has(leg.to)) arrivingSet.set(leg.to, new Set());
			departingSet.get(leg.from)!.add(route.crew_id);
			arrivingSet.get(leg.to)!.add(route.crew_id);
			ensureAirport(leg.from);
			ensureAirport(leg.to);
		}
	}

	for (const [iata, info] of airportMap) {
		info.departingCrewCount = departingSet.get(iata)?.size ?? 0;
		info.arrivingCrewCount = arrivingSet.get(iata)?.size ?? 0;
	}

	return {
		arcs: Array.from(arcMap.values()),
		deadheadArcs: Array.from(dhMap.values()),
		routes: routeMap,
		airports: airportMap,
		unknownAirports
	};
}

export function formatMinutes(min: number): string {
	const day = Math.floor(min / 1440) + 1;
	const hh = String(Math.floor((min % 1440) / 60)).padStart(2, '0');
	const mm = String(min % 60).padStart(2, '0');
	return `Day ${day}  ${hh}:${mm}`;
}

export function formatDuration(min: number): string {
	const h = Math.floor(min / 60);
	const m = min % 60;
	return h > 0 ? `${h}h ${m}m` : `${m}m`;
}
import type {
	ScheduleData,
	FlightInfo,
	ArcRenderData,
	RouteData,
	AirportInfo,
	FlightStatus
} from './types';
import { getAirportCoords } from './airports';

export interface ProcessedData {
	arcs: ArcRenderData[];
	deadheadArcs: ArcRenderData[];
	routes: Map<string, RouteData>;
	airports: Map<string, AirportInfo>;
	unknownAirports: Set<string>;
}

export function processData(data: ScheduleData, timeStart: number, timeEnd: number): ProcessedData {
	const { flights, routes, uncovered_flights } = data;

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
	// Uncovered slots index — key by (flight_num, dep_min) so repeated flight numbers across days don't collide
	const uncoveredMap = new Map<string, number>();
	for (const uf of uncovered_flights) {
		uncoveredMap.set(`${uf.flight_num}:${uf.dep_min}`, uf.missing_slots);
	}

	// Enrich all flights with status
	const flightInfos: FlightInfo[] = flights.map((f) => {
		const crew = flightCrew.get(f.id);
		const actual = crew?.flight.length ?? 0;
		const uncoveredKey = `${f.flight_num}:${f.dep_min}`;
		const missing = Math.round(uncoveredMap.get(uncoveredKey) ?? 0);

		let status: FlightStatus;
		if (uncoveredMap.has(uncoveredKey)) {
			// Solver explicitly flagged this flight
			status = missing >= f.min_crew ? 'uncovered' : 'partial';
		} else {
			// Not in uncovered_flights → solver considers it covered.
			// The flow decomposition can silently drop crew paths, so actual < min_crew
			// here does NOT reliably indicate partial coverage — trust the solver.
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

	// Filter to time window
	const windowFlights = flightInfos.filter((f) => f.dep_min >= timeStart && f.dep_min <= timeEnd);

	const unknownAirports = new Set<string>();

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
			arcMap.set(arcKey, {
				key: arcKey,
				routeKey,
				origin: flight.origin,
				dest: flight.dest,
				status: flight.status,
				sourcePosition: src,
				targetPosition: dst,
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
			if (leg.dep < timeStart || leg.dep > timeEnd) continue;

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
			flightsTo: []
		});
	}

	// Seed from crew bases
	for (const c of data.crew) {
		ensureAirport(c.base);
		airportMap.get(c.base)?.basedCrew.push(c.id);
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
			if (leg.dep < timeStart || leg.dep > timeEnd) continue;
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

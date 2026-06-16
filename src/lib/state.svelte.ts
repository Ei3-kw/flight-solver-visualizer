import type { ScheduleData, FlightInfo, RouteData, AirportInfo, FlightStatus } from './types';

class AppState {
	data = $state<ScheduleData | null>(null);
	timeRange = $state<[number, number]>([0, 0]);
	currentTime = $state<number>(0);
	selectedRoute = $state<RouteData | null>(null);
	selectedRouteStatus = $state<FlightStatus | null>(null);
	selectedFlight = $state<FlightInfo | null>(null);
	/** Store only the IATA so that when currentTime changes, the panel
	 *  re-derives a fresh AirportInfo from the live processData output. */
	selectedAirportIata = $state<string | null>(null);
	/** Kept for backward-compat reads (e.g. layers.ts highlight) — always
	 *  set alongside selectedAirportIata. */
	selectedAirport = $state<AirportInfo | null>(null);
	showDeadheads = $state(true);
	showCovered = $state(true);
	showPartial = $state(true);
	showUncovered = $state(true);
	viewMode = $state<'map' | 'globe'>('map');
	focusedCrewId = $state<number | null>(null);
	/** Airport filter: with only A set, show flights touching A; with A and B set,
	 *  show only flights between A and B (either direction). null = no filter. */
	filterAirportA = $state<string | null>(null);
	filterAirportB = $state<string | null>(null);

	get horizon(): number {
		return this.data?.meta.horizon_end ?? 0;
	}

	// Explicit panel state — avoids Svelte @const reactivity issues
	get panelView(): 'flight' | 'airport' | 'route' | 'controls' {
		if (this.selectedFlight) return 'flight';
		if (this.selectedAirportIata) return 'airport';
		if (this.selectedRoute) return 'route';
		return 'controls';
	}

	loadData(d: ScheduleData) {
		this.data = d;
		this.timeRange = [0, d.meta.horizon_end];
		this.currentTime = Math.floor(d.meta.horizon_end / 2);
		this.selectedRoute = null;
		this.selectedFlight = null;
		this.selectedAirport = null;
		this.selectedAirportIata = null;
		this.focusedCrewId = null;
		this.filterAirportA = null;
		this.filterAirportB = null;
	}

	selectRoute(route: RouteData | null, statusFilter: FlightStatus | null = null) {
		this.selectedRoute = route;
		this.selectedRouteStatus = statusFilter;
		this.selectedFlight = null;
		this.selectedAirport = null;
		this.selectedAirportIata = null;
	}

	selectFlight(flight: FlightInfo | null) {
		this.selectedFlight = flight;
		this.selectedAirport = null;
		this.selectedAirportIata = null;
	}

	selectAirport(airport: AirportInfo | null) {
		this.selectedAirport = airport;
		this.selectedAirportIata = airport?.iata ?? null;
		this.selectedFlight = null;
		// Keep selectedRoute so back() returns to the route list if applicable
	}

	focusCrew(id: number | null) {
		this.focusedCrewId = id;
	}

	/** Add an airport to the map filter. Fills slot A first, then B; selecting an
	 *  airport already in a slot clears it. Re-selecting A when B is set promotes B. */
	toggleFilterAirport(iata: string) {
		if (this.filterAirportA === iata) {
			this.filterAirportA = this.filterAirportB;
			this.filterAirportB = null;
		} else if (this.filterAirportB === iata) {
			this.filterAirportB = null;
		} else if (this.filterAirportA === null) {
			this.filterAirportA = iata;
		} else if (this.filterAirportB === null) {
			this.filterAirportB = iata;
		} else {
			// Both slots taken — replace the second airport.
			this.filterAirportB = iata;
		}
	}

	setFilterAirport(slot: 'A' | 'B', iata: string | null) {
		if (slot === 'A') this.filterAirportA = iata;
		else this.filterAirportB = iata;
	}

	clearAirportFilter() {
		this.filterAirportA = null;
		this.filterAirportB = null;
	}

	back() {
		if (this.selectedFlight) {
			this.selectedFlight = null;
		} else if (this.selectedAirportIata) {
			this.selectedAirport = null;
			this.selectedAirportIata = null;
		} else {
			this.selectedRoute = null;
		}
	}
}

export const appState = new AppState();

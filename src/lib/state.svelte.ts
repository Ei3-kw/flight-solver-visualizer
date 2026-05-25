import type { ScheduleData, FlightInfo, RouteData, AirportInfo, FlightStatus } from './types';

class AppState {
	data = $state<ScheduleData | null>(null);
	timeRange = $state<[number, number]>([0, 0]);
	selectedRoute = $state<RouteData | null>(null);
	selectedRouteStatus = $state<FlightStatus | null>(null);
	selectedFlight = $state<FlightInfo | null>(null);
	selectedAirport = $state<AirportInfo | null>(null);
	showDeadheads = $state(true);
	showCovered = $state(true);
	showPartial = $state(true);
	showUncovered = $state(true);
	viewMode = $state<'map' | 'globe'>('map');

	get horizon(): number {
		return this.data?.meta.horizon_end ?? 0;
	}

	// Explicit panel state — avoids Svelte @const reactivity issues
	get panelView(): 'flight' | 'airport' | 'route' | 'controls' {
		if (this.selectedFlight) return 'flight';
		if (this.selectedAirport) return 'airport';
		if (this.selectedRoute) return 'route';
		return 'controls';
	}

	loadData(d: ScheduleData) {
		this.data = d;
		this.timeRange = [0, d.meta.horizon_end];
		this.selectedRoute = null;
		this.selectedFlight = null;
		this.selectedAirport = null;
	}

	selectRoute(route: RouteData | null, statusFilter: FlightStatus | null = null) {
		this.selectedRoute = route;
		this.selectedRouteStatus = statusFilter;
		this.selectedFlight = null;
		this.selectedAirport = null;
	}

	selectFlight(flight: FlightInfo | null) {
		this.selectedFlight = flight;
		this.selectedAirport = null;
	}

	selectAirport(airport: AirportInfo | null) {
		this.selectedAirport = airport;
		this.selectedFlight = null;
		// Keep selectedRoute so back() returns to the route list if applicable
	}

	back() {
		if (this.selectedFlight) {
			this.selectedFlight = null;
		} else if (this.selectedAirport) {
			this.selectedAirport = null;
		} else {
			this.selectedRoute = null;
		}
	}
}

export const appState = new AppState();

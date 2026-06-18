export interface Flight {
	id: number;
	flight_num: string;
	origin: string;
	dest: string;
	dep_min: number;
	arr_min: number;
	duration: number;
	min_crew: number;
}

export interface RouteLeg {
	type: 'flight' | 'deadhead';
	from: string;
	to: string;
	dep: number;
	arr: number;
	flight_id: number | null;
}

export interface BreakWindow {
	start: number;
	end: number;
	type: BreakType;
}

export interface CrewRoute {
	crew_id: number;
	base: string;
	crew_count: number;
	legs: RouteLeg[];
	/** Authoritative unavailability windows emitted by the solver (e.g. mandatory
	 *  48h home breaks). When present, the viz reads these instead of re-deriving. */
	breaks?: BreakWindow[];
}

export interface UncoveredFlight {
	flight_num: string;
	origin: string;
	dest: string;
	dep_min: number;
	arr_min: number;
	missing_slots: number;
}

export interface ScheduleMeta {
	days: number;
	horizon_end: number;
	solve_status: string;
	total_cost: number;
	flight_cost: number;
	deadhead_cost: number;
	wait_cost: number;
	uncovered_slots: number;
	num_flights: number;
	covered_flights: number;
	/** Two-layer (senior + normal) result. When true, each flight needs exactly one
	 *  senior plus (min_crew − 1) normals, and `crew[].is_senior` distinguishes them. */
	two_layer?: boolean;
	n_senior?: number;
	n_normal?: number;
	cancelled?: number;
	fully_crewed?: number;
	understaffed?: number;
	runtime_secs?: { layer1: number; layer2: number; combine?: number; total: number } | null;
}

export interface ScheduleData {
	meta: ScheduleMeta;
	crew: Array<{ id: number; base: string; is_senior?: boolean }>;
	flights: Flight[];
	routes: CrewRoute[];
	uncovered_flights: UncoveredFlight[];
}

export type FlightStatus = 'covered' | 'partial' | 'uncovered';

export interface FlightInfo extends Flight {
	status: FlightStatus;
	assigned_crew: number[];
	deadhead_crew: number[];
	actual_crew: number;
	missing_slots: number;
	crewDataAvailable: boolean; // false when flight not present in any route leg (standing assignment)
	// ── Two-layer fill (senior + normal). For single-layer data these mirror the
	//    overall counts: senior_crew is empty and junior_crew == assigned_crew.
	twoLayer: boolean;
	senior_crew: number[];   // assigned crew that are senior
	junior_crew: number[];   // assigned crew that are normal
	senior_need: number;     // 1 when two-layer, else 0
	junior_need: number;     // min_crew − 1 when two-layer, else min_crew
}

// Per-(origin,dest,status) arc — what deck.gl renders
export interface ArcRenderData {
	key: string; // "JFK→LAX:covered"
	routeKey: string; // "JFK→LAX"
	origin: string;
	dest: string;
	status: FlightStatus | 'deadhead';
	sourcePosition: [number, number];
	targetPosition: [number, number];
	count: number;
}

// Per-(origin,dest) route — what the sidebar shows on click
export interface RouteData {
	key: string; // "JFK→LAX"
	origin: string;
	dest: string;
	flights: FlightInfo[];
	totalCrew: number;
	deadheadCount: number;
}

/** How a crew member's unavailability should be cleared */
export type BreakType = 'duty_14h' | 'home_48h' | 'rest_8h' | 'turnaround_45m';

/** A crew member currently on the ground at an airport */
export interface CrewAtAirport {
	id: number;
	base: string;
	/** Is this their home base? */
	isHome: boolean;
	/** Are they visiting (not based here)? */
	isVisiting: boolean;
	/** Currently available for duty */
	available: boolean;
	/** If unavailable, what kind of break clears them */
	breakType: BreakType | null;
	/** Minutes remaining until break is complete (null if available) */
	breakRemainingMin: number | null;
	/** Block work (min) since the last >=8h overnight rest — the current duty period.
	 *  Resets on any >=8h rest (and on a 48h home break). */
	dutyWorkedMin: number;
	/** Block work (min) since the last completed >=48h HOME break. Does NOT reset on an
	 *  8h overnight rest, so it accumulates across duty periods until a home break. */
	homeWorkedMin: number;
	/** Which leg they're currently "between" — arrived via this leg */
	arrivedVia: RouteLeg | null;
	/** Their next scheduled leg (if any) */
	nextLeg: RouteLeg | null;
}

export interface AirportInfo {
	iata: string;
	coords: [number, number];
	basedCrew: number[]; // crew IDs with base == iata
	departingCrewCount: number; // unique crew departing in window
	arrivingCrewCount: number; // unique crew arriving in window
	flightsFrom: FlightInfo[];
	flightsTo: FlightInfo[];
	/** Crew currently on the ground at this airport at currentTime */
	crewOnGround: CrewAtAirport[];
}
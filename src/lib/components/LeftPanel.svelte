<script lang="ts">
	import { appState } from '$lib/state.svelte';
	import { formatMinutes, formatDuration, processData } from '$lib/processData';

	// Derive a live AirportInfo for the selected airport — re-runs whenever
	// currentTime changes so crew status stays up to date as the scrubber moves.
	const liveAirport = $derived(
		appState.selectedAirportIata && appState.data
			? (processData(appState.data, appState.currentTime, appState.currentTime, null)
					.airports.get(appState.selectedAirportIata) ?? null)
			: null
	);

	const STATUS_BG: Record<string, string> = {
		covered: 'bg-green-500/15 border-green-500/30 text-green-400',
		partial: 'bg-orange-500/15 border-orange-500/30 text-orange-400',
		uncovered: 'bg-red-500/15 border-red-500/30 text-red-400'
	};

	const STATUS_DOT: Record<string, string> = {
		covered: 'bg-green-400',
		partial: 'bg-orange-400',
		uncovered: 'bg-red-400'
	};

	const STATUS_TEXT: Record<string, string> = {
		covered: 'text-green-400',
		partial: 'text-orange-400',
		uncovered: 'text-red-400'
	};

	function handleFileChange(e: Event) {
		const file = (e.target as HTMLInputElement).files?.[0];
		if (!file) return;
		const reader = new FileReader();
		reader.onload = (ev) => {
			try {
				appState.loadData(JSON.parse(ev.target!.result as string));
			} catch {
				alert('Invalid JSON file');
			}
		};
		reader.readAsText(file);
	}

	async function loadExample() {
		const res = await fetch('/examples/flights_mini_result.json');
		appState.loadData(await res.json());
	}

	function crewBase(id: number) {
		return appState.data?.crew.find((c) => c.id === id)?.base ?? '?';
	}

	function crewLegs(id: number) {
		return appState.data?.routes.find((r) => r.crew_id === id)?.legs ?? [];
	}

	function nextLeg(crewId: number, flightId: number) {
		const legs = crewLegs(crewId);
		const i = legs.findIndex((l) => l.flight_id === flightId);
		return i >= 0 && i < legs.length - 1 ? legs[i + 1] : null;
	}

	function prevLeg(crewId: number, flightId: number) {
		const legs = crewLegs(crewId);
		const i = legs.findIndex((l) => l.flight_id === flightId);
		return i > 0 ? legs[i - 1] : null;
	}

	let pickerOpen = $state<'start' | 'end' | null>(null);
	let crewSearch = $state('');
	let crewDropdownOpen = $state(false);

	// Airport filter dropdowns (slot A and slot B)
	let airportSearch = $state<{ A: string; B: string }>({ A: '', B: '' });
	let airportDropdownOpen = $state<'A' | 'B' | null>(null);
	let airportListExpanded = $state(false);

	// flight_id → assigned crew IDs, built once per dataset (cheap O(1) status lookups).
	const flightCrewIndex = $derived.by(() => {
		const m = new Map<number, number[]>();
		if (!appState.data) return m;
		for (const r of appState.data.routes)
			for (const leg of r.legs)
				if (leg.flight_id != null && leg.type === 'flight') {
					if (!m.has(leg.flight_id)) m.set(leg.flight_id, []);
					m.get(leg.flight_id)!.push(r.crew_id);
				}
		return m;
	});

	const uncovIndex = $derived.by(() => {
		const m = new Map<string, number>();
		if (!appState.data) return m;
		for (const u of appState.data.uncovered_flights)
			m.set(`${u.origin}:${u.dest}:${u.dep_min}`, u.missing_slots);
		return m;
	});

	function statusOf(f: { id: number; origin: string; dest: string; dep_min: number; min_crew: number }) {
		const crew = flightCrewIndex.get(f.id) ?? [];
		const missing = uncovIndex.get(`${f.origin}:${f.dest}:${f.dep_min}`) ?? 0;
		const status =
			missing === 0 && crew.length >= f.min_crew ? 'covered'
			: crew.length === 0 && missing > 0 ? 'uncovered'
			: 'partial';
		return { status: status as 'covered' | 'partial' | 'uncovered', actual_crew: crew.length, missing_slots: missing, assigned_crew: crew };
	}

	// Whole-schedule flights into/out of the filtered airport(s), honouring the same
	// status toggles as the global Layers filter (covered / partial / uncovered).
	const airportScheduleFlights = $derived.by(() => {
		const a = appState.filterAirportA, b = appState.filterAirportB;
		if (!appState.data || !a) return [];
		const match = (f: { origin: string; dest: string }) =>
			b ? (f.origin === a && f.dest === b) || (f.origin === b && f.dest === a)
			  : f.origin === a || f.dest === a;
		const show = { covered: appState.showCovered, partial: appState.showPartial, uncovered: appState.showUncovered };
		return appState.data.flights
			.filter(match)
			.map((f) => ({ ...f, ...statusOf(f) }))
			.filter((f) => show[f.status])
			.sort((x, y) => x.dep_min - y.dep_min);
	});

	const totalDays = $derived(Math.ceil(appState.horizon / 1440) + 1);

	// All distinct airports in the dataset (from flight origins + dests), sorted.
	const allAirports = $derived(
		appState.data
			? [...new Set(appState.data.flights.flatMap((f) => [f.origin, f.dest]))].sort()
			: []
	);

	function filteredAirports(slot: 'A' | 'B') {
		const q = airportSearch[slot].toLowerCase();
		const other = slot === 'A' ? appState.filterAirportB : appState.filterAirportA;
		return allAirports
			.filter((a) => a !== other && (q === '' || a.toLowerCase().includes(q)))
			.slice(0, 30);
	}

	const filteredCrew = $derived(
		appState.data
			? appState.data.crew.filter(c =>
				crewSearch === '' || String(c.id).includes(crewSearch) || c.base.toLowerCase().includes(crewSearch.toLowerCase())
			).slice(0, 20)
			: []
	);

	// Legs of focused crew at currentTime (for route timeline display)
	const focusedCrewLegs = $derived(
		appState.focusedCrewId !== null && appState.data
			? (appState.data.routes.find(r => r.crew_id === appState.focusedCrewId)?.legs ?? [])
			: []
	);

	function toDHM(min: number) {
		return { day: Math.floor(min / 1440) + 1, h: Math.floor((min % 1440) / 60), m: min % 60 };
	}

	function fromDHM(day: number, h: number, m: number) {
		return (day - 1) * 1440 + h * 60 + m;
	}

	// Parse a numeric text field, clamping to [lo, hi]; blank/NaN falls back to lo.
	function clampInt(s: string, lo: number, hi: number) {
		const n = parseInt(s, 10);
		return Number.isNaN(n) ? lo : Math.max(lo, Math.min(hi, n));
	}

	// Set the current sim time from editable day/hour/minute fields, clamped to horizon.
	function setCurrentTime(day: number, h: number, m: number) {
		appState.currentTime = Math.max(0, Math.min(appState.horizon, fromDHM(day, h, m)));
	}

	const startDHM = $derived(toDHM(appState.timeRange[0]));
	const endDHM   = $derived(toDHM(appState.timeRange[1]));

	function pickStartDay(d: number) {
		const v = fromDHM(d, startDHM.h, startDHM.m);
		if (v < appState.timeRange[1]) appState.timeRange = [v, appState.timeRange[1]];
	}
	function pickStartTime(h: number, m: number) {
		const v = fromDHM(startDHM.day, h, m);
		if (v < appState.timeRange[1]) appState.timeRange = [v, appState.timeRange[1]];
	}
	function pickEndDay(d: number) {
		const v = fromDHM(d, endDHM.h, endDHM.m);
		if (v > appState.timeRange[0]) appState.timeRange = [appState.timeRange[0], v];
	}
	function pickEndTime(h: number, m: number) {
		const v = fromDHM(endDHM.day, h, m);
		if (v > appState.timeRange[0]) appState.timeRange = [appState.timeRange[0], v];
	}

	// Flights airborne at currentTime
	const airborneFlights = $derived(
		appState.data
			? appState.data.flights
				.filter(f => f.dep_min <= appState.currentTime && f.arr_min >= appState.currentTime)
				.map(f => {
					// Find status from processed data if available
					const routes = appState.data!.routes;
					const uncovered = appState.data!.uncovered_flights;

					const flightCrew: number[] = [];
					for (const route of routes) {
						for (const leg of route.legs) {
							if (leg.flight_id === f.id && leg.type === 'flight') {
								flightCrew.push(route.crew_id);
							}
						}
					}

					const uncovKey = `${f.origin}:${f.dest}:${f.dep_min}`;
					const uncovEntry = uncovered.find(u => u.origin === f.origin && u.dest === f.dest && u.dep_min === f.dep_min);
					const missingSlots = uncovEntry?.missing_slots ?? 0;
					const actualCrew = flightCrew.length;
					const status = missingSlots === 0 && actualCrew >= f.min_crew
						? 'covered'
						: missingSlots > 0 && actualCrew === 0
						? 'uncovered'
						: 'partial';

					return { ...f, status, assigned_crew: flightCrew, actual_crew: actualCrew, missing_slots: missingSlots };
				})
				.sort((a, b) => a.dep_min - b.dep_min)
			: []
	);

	const currentTimeDHM = $derived(toDHM(appState.currentTime));
</script>

<aside class="flex h-full w-80 shrink-0 flex-col border-r border-white/8 bg-[#12141f] text-sm text-white/90">
	<!-- Header -->
	<div class="flex items-center gap-2 border-b border-white/8 px-4 py-3">
		<svg class="h-4 w-4 text-blue-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
			<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 13a19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 3.6 2.22L6.64 2a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L7.64 9.91a16 16 0 0 0 6.29 6.29l1.14-1.14a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>
		</svg>
		<span class="font-semibold tracking-tight">FlightViz</span>
	</div>

	<!-- Back button -->
	{#if appState.panelView !== 'controls'}
		<button
			onclick={() => appState.back()}
			class="flex items-center gap-1.5 border-b border-white/8 px-4 py-2 text-xs text-white/40 transition hover:text-white/80"
		>
			<svg class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
				<path d="M19 12H5M5 12l7-7M5 12l7 7"/>
			</svg>
			{appState.panelView === 'flight' ? 'Back to route' :
			 appState.panelView === 'airport' ? 'Back to overview' :
			 'Back to overview'}
		</button>
	{/if}

	<div class="flex min-h-0 flex-1 flex-col overflow-y-auto">

		<!-- ══════════ FLIGHT DETAIL ══════════ -->
		{#if appState.panelView === 'flight' && appState.selectedFlight}
			{#key appState.selectedFlight.id}
				<div class="flex flex-col gap-3 px-4 py-4">
					<div>
						<div class="flex items-baseline justify-between">
							<span class="text-base font-bold text-white">Flight #{appState.selectedFlight.flight_num}</span>
							<span class="rounded border px-2 py-0.5 text-xs {STATUS_BG[appState.selectedFlight.status]}">
								{appState.selectedFlight.status === 'covered' ? 'Covered' :
								 appState.selectedFlight.status === 'partial' ? 'Partial' : 'Uncovered'}
							</span>
						</div>
						<div class="mt-0.5 text-2xl font-semibold tracking-wide">
							{appState.selectedFlight.origin} → {appState.selectedFlight.dest}
						</div>
					</div>

					<div class="grid grid-cols-2 gap-1.5 text-xs">
						{#each [
							['Departure', formatMinutes(appState.selectedFlight.dep_min)],
							['Arrival',   formatMinutes(appState.selectedFlight.arr_min)],
							['Duration',  formatDuration(appState.selectedFlight.duration)],
							['Min. crew', String(appState.selectedFlight.min_crew)]
						] as [label, val]}
							<div class="rounded-lg bg-white/5 px-3 py-2">
								<div class="text-white/35">{label}</div>
								<div class="mt-0.5 font-medium text-white">{val}</div>
							</div>
						{/each}
					</div>

					{#if appState.selectedFlight.missing_slots > 0}
						<div class="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
							⚠ {appState.selectedFlight.missing_slots} crew slot{appState.selectedFlight.missing_slots !== 1 ? 's' : ''} unfilled
						</div>
					{/if}

					<!-- Assigned crew -->
					<div>
						<div class="mb-2 text-xs font-semibold uppercase tracking-wider text-white/35">
							Assigned crew ({appState.selectedFlight.actual_crew}/{appState.selectedFlight.min_crew})
						</div>
						{#if appState.selectedFlight.assigned_crew.length === 0}
							<div class="rounded-lg bg-white/5 px-3 py-2 text-xs text-white/30">Unassigned</div>
						{:else}
							<div class="flex flex-col gap-1.5">
								{#each appState.selectedFlight.assigned_crew as cid}
									<div class="rounded-lg bg-blue-500/10 px-3 py-2.5 text-xs">
										<div class="flex items-center justify-between">
											<span class="font-semibold text-blue-300">Crew #{cid}</span>
											<span class="rounded bg-blue-500/20 px-1.5 py-0.5 text-blue-400">
												{crewBase(cid)}
											</span>
										</div>
										<div class="mt-1.5 grid grid-cols-2 gap-1 text-white/40 text-[10px]">
											<div>
												{#if prevLeg(cid, appState.selectedFlight.id)}
													<div class="text-white/25">From</div>
													<div class="text-white/60">{prevLeg(cid, appState.selectedFlight.id)!.from}→{prevLeg(cid, appState.selectedFlight.id)!.to}</div>
												{:else}
													<div class="text-white/20">Start of duty</div>
												{/if}
											</div>
											<div>
												{#if nextLeg(cid, appState.selectedFlight.id)}
													<div class="text-white/25">Next</div>
													<div class="text-white/60">
														{nextLeg(cid, appState.selectedFlight.id)!.from}→{nextLeg(cid, appState.selectedFlight.id)!.to}
														{#if nextLeg(cid, appState.selectedFlight.id)!.type === 'deadhead'}
															<span class="text-purple-400"> DH</span>
														{/if}
													</div>
												{:else}
													<div class="text-white/20">End of duty</div>
												{/if}
											</div>
										</div>
									</div>
								{/each}
							</div>
						{/if}
					</div>

					<!-- Deadheading crew -->
					{#if appState.selectedFlight.deadhead_crew.length > 0}
						<div>
							<div class="mb-2 text-xs font-semibold uppercase tracking-wider text-white/35">
								Deadheading ({appState.selectedFlight.deadhead_crew.length})
							</div>
							<div class="flex flex-col gap-1.5">
								{#each appState.selectedFlight.deadhead_crew as cid}
									<div class="rounded-lg bg-purple-500/10 px-3 py-2.5 text-xs">
										<div class="flex items-center justify-between">
											<span class="font-semibold text-purple-300">Crew #{cid}</span>
											<span class="rounded bg-purple-500/20 px-1.5 py-0.5 text-purple-400">{crewBase(cid)}</span>
										</div>
										{#if nextLeg(cid, appState.selectedFlight.id)}
											<div class="mt-1 text-[10px] text-white/40">
												Next: <span class="text-white/60">{nextLeg(cid, appState.selectedFlight.id)!.from}→{nextLeg(cid, appState.selectedFlight.id)!.to}</span>
											</div>
										{/if}
									</div>
								{/each}
							</div>
						</div>
					{/if}
				</div>
			{/key}

		<!-- ══════════ AIRPORT DETAIL ══════════ -->
		{:else if appState.panelView === 'airport' && liveAirport}
			{#key liveAirport.iata + ':' + appState.currentTime}
				{@const apt = liveAirport}
				{@const onGround = apt.crewOnGround}
				{@const basedOnGround   = onGround.filter(c => !c.isVisiting)}
				{@const visitingOnGround = onGround.filter(c => c.isVisiting)}
				{@const basedAvail      = basedOnGround.filter(c => c.available)}
				{@const basedUnavail    = basedOnGround.filter(c => !c.available)}
				{@const visitAvail      = visitingOnGround.filter(c => c.available)}
				{@const visitUnavail    = visitingOnGround.filter(c => !c.available)}

				<div class="flex flex-col gap-0 divide-y divide-white/6">

					<!-- Header -->
					<div class="px-4 py-4">
						<div class="flex items-start justify-between">
							<div class="text-3xl font-bold tracking-widest text-white">{apt.iata}</div>
							<button
								onclick={() => appState.toggleFilterAirport(apt.iata)}
								class="mt-1 flex items-center gap-1 rounded-md px-2 py-1 text-[10px] font-medium transition {appState.filterAirportA === apt.iata || appState.filterAirportB === apt.iata ? 'bg-amber-500/25 text-amber-200 hover:bg-amber-500/35' : 'bg-white/5 text-white/50 hover:bg-white/10 hover:text-white/80'}"
								title="Show only flights touching this airport (or between two filtered airports)"
							>
								<svg class="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 3H2l8 9.46V19l4 2v-8.54L22 3z"/></svg>
								{appState.filterAirportA === apt.iata || appState.filterAirportB === apt.iata ? 'Filtering' : 'Filter map'}
							</button>
						</div>
						<div class="mt-1.5 flex flex-wrap gap-2 text-xs">
							<span class="flex items-center gap-1 text-white/50">
								<span class="h-1.5 w-1.5 rounded-full bg-blue-400"></span>
								{apt.basedCrew.length} based total
							</span>
							<span class="flex items-center gap-1 text-white/50">
								<span class="h-1.5 w-1.5 rounded-full bg-white/30"></span>
								{onGround.length} on ground
							</span>
							<span class="flex items-center gap-1 text-green-400/80">
								<span>↑</span>{apt.departingCrewCount} departing
							</span>
							<span class="flex items-center gap-1 text-amber-400/80">
								<span>↓</span>{apt.arrivingCrewCount} arriving
							</span>
						</div>
					</div>

					<!-- ── BASED CREW ── -->
					{#if basedOnGround.length > 0}
						<div class="px-4 py-3">
							<div class="mb-2.5 text-[10px] font-semibold uppercase tracking-wider text-blue-400/70">
								Based here on ground ({basedOnGround.length})
							</div>
							<div class="flex flex-col gap-1.5">

								<!-- Based + Available -->
								{#each basedAvail as crew}
									<button
										onclick={() => { appState.focusCrew(crew.id); }}
										class="group flex w-full flex-col gap-1 rounded-lg bg-green-500/8 border border-green-500/20 px-2.5 py-2 text-left text-xs transition hover:bg-green-500/15 hover:border-green-500/35"
									>
										<div class="flex items-center justify-between">
											<div class="flex items-center gap-1.5">
												<span class="h-2 w-2 rounded-full bg-green-400"></span>
												<span class="font-semibold text-white">Crew #{crew.id}</span>
												<span class="rounded bg-blue-500/25 px-1.5 py-0.5 text-[9px] text-blue-300">HOME</span>
											</div>
											<span class="rounded bg-green-500/20 px-1.5 py-0.5 text-[10px] font-medium text-green-400">Available</span>
										</div>
										<div class="flex items-center justify-between text-[10px] text-white/40">
											<span>{crew.hoursWorkedMin > 0 ? `${Math.floor(crew.hoursWorkedMin / 60)}h ${crew.hoursWorkedMin % 60}m worked` : 'No duty this period'}</span>
											{#if crew.nextLeg}
												<span class="text-sky-400/70">Next: {crew.nextLeg.from}→{crew.nextLeg.to}</span>
											{/if}
										</div>
									</button>
								{/each}

								<!-- Based + Unavailable -->
								{#each basedUnavail as crew}
									<button
										onclick={() => { appState.focusCrew(crew.id); }}
										class="group flex w-full flex-col gap-1 rounded-lg border px-2.5 py-2 text-left text-xs transition
											{crew.breakType === 'home_48h'
												? 'bg-purple-500/8 border-purple-500/25 hover:bg-purple-500/15'
												: crew.breakType === 'rest_8h'
													? 'bg-sky-500/8 border-sky-500/25 hover:bg-sky-500/15'
													: crew.breakType === 'turnaround_45m'
														? 'bg-yellow-500/8 border-yellow-500/25 hover:bg-yellow-500/15'
														: 'bg-orange-500/8 border-orange-500/25 hover:bg-orange-500/15'}"
									>
										<div class="flex items-center justify-between">
											<div class="flex items-center gap-1.5">
												<span class="h-2 w-2 rounded-full {crew.breakType === 'home_48h' ? 'bg-purple-400' : crew.breakType === 'rest_8h' ? 'bg-sky-400' : crew.breakType === 'turnaround_45m' ? 'bg-yellow-400' : 'bg-orange-400'}"></span>
												<span class="font-semibold text-white">Crew #{crew.id}</span>
												<span class="rounded bg-blue-500/25 px-1.5 py-0.5 text-[9px] text-blue-300">HOME</span>
											</div>
											<span class="rounded px-1.5 py-0.5 text-[10px] font-medium
												{crew.breakType === 'home_48h' ? 'bg-purple-500/20 text-purple-300' : crew.breakType === 'rest_8h' ? 'bg-sky-500/20 text-sky-300' : crew.breakType === 'turnaround_45m' ? 'bg-yellow-500/20 text-yellow-300' : 'bg-orange-500/20 text-orange-300'}">
												{crew.breakType === 'home_48h' ? '48h home break' : crew.breakType === 'rest_8h' ? '8h rest' : crew.breakType === 'turnaround_45m' ? '45m turnaround' : '14h duty break'}
											</span>
										</div>
										<div class="flex items-center justify-between text-[10px] text-white/40">
											<span>{Math.floor(crew.hoursWorkedMin / 60)}h {crew.hoursWorkedMin % 60}m worked</span>
											{#if crew.breakRemainingMin !== null}
												<span class="{crew.breakType === 'home_48h' ? 'text-purple-400/80' : crew.breakType === 'rest_8h' ? 'text-sky-400/80' : crew.breakType === 'turnaround_45m' ? 'text-yellow-400/80' : 'text-orange-400/80'}">
													{Math.floor(crew.breakRemainingMin / 60)}h {crew.breakRemainingMin % 60}m to clear
												</span>
											{/if}
										</div>
									</button>
								{/each}
							</div>
						</div>
					{:else}
						<div class="px-4 py-3">
							<div class="text-[10px] font-semibold uppercase tracking-wider text-blue-400/50 mb-1">Based here on ground</div>
							<div class="text-xs text-white/25 italic">None currently on ground</div>
						</div>
					{/if}

					<!-- ── VISITING CREW ── -->
					{#if visitingOnGround.length > 0}
						<div class="px-4 py-3">
							<div class="mb-2.5 text-[10px] font-semibold uppercase tracking-wider text-amber-400/70">
								Visiting on ground ({visitingOnGround.length})
							</div>
							<div class="flex flex-col gap-1.5">

								<!-- Visiting + Available -->
								{#each visitAvail as crew}
									<button
										onclick={() => { appState.focusCrew(crew.id); }}
										class="group flex w-full flex-col gap-1 rounded-lg bg-green-500/8 border border-green-500/20 px-2.5 py-2 text-left text-xs transition hover:bg-green-500/15 hover:border-green-500/35"
									>
										<div class="flex items-center justify-between">
											<div class="flex items-center gap-1.5">
												<span class="h-2 w-2 rounded-full bg-green-400"></span>
												<span class="font-semibold text-white">Crew #{crew.id}</span>
												<span class="rounded bg-amber-500/20 px-1.5 py-0.5 text-[9px] text-amber-300">FROM {crew.base}</span>
											</div>
											<span class="rounded bg-green-500/20 px-1.5 py-0.5 text-[10px] font-medium text-green-400">Available</span>
										</div>
										<div class="flex items-center justify-between text-[10px] text-white/40">
											<span>{crew.hoursWorkedMin > 0 ? `${Math.floor(crew.hoursWorkedMin / 60)}h ${crew.hoursWorkedMin % 60}m worked` : 'No duty this period'}</span>
											{#if crew.nextLeg}
												<span class="text-sky-400/70">Next: {crew.nextLeg.from}→{crew.nextLeg.to}</span>
											{/if}
										</div>
									</button>
								{/each}

								<!-- Visiting + Unavailable -->
								{#each visitUnavail as crew}
									<button
										onclick={() => { appState.focusCrew(crew.id); }}
										class="group flex w-full flex-col gap-1 rounded-lg border px-2.5 py-2 text-left text-xs transition
											{crew.breakType === 'home_48h'
												? 'bg-purple-500/8 border-purple-500/25 hover:bg-purple-500/15'
												: crew.breakType === 'rest_8h'
													? 'bg-sky-500/8 border-sky-500/25 hover:bg-sky-500/15'
													: crew.breakType === 'turnaround_45m'
														? 'bg-yellow-500/8 border-yellow-500/25 hover:bg-yellow-500/15'
														: 'bg-orange-500/8 border-orange-500/25 hover:bg-orange-500/15'}"
									>
										<div class="flex items-center justify-between">
											<div class="flex items-center gap-1.5">
												<span class="h-2 w-2 rounded-full {crew.breakType === 'home_48h' ? 'bg-purple-400' : crew.breakType === 'rest_8h' ? 'bg-sky-400' : crew.breakType === 'turnaround_45m' ? 'bg-yellow-400' : 'bg-orange-400'}"></span>
												<span class="font-semibold text-white">Crew #{crew.id}</span>
												<span class="rounded bg-amber-500/20 px-1.5 py-0.5 text-[9px] text-amber-300">FROM {crew.base}</span>
											</div>
											<span class="rounded px-1.5 py-0.5 text-[10px] font-medium
												{crew.breakType === 'home_48h' ? 'bg-purple-500/20 text-purple-300' : crew.breakType === 'rest_8h' ? 'bg-sky-500/20 text-sky-300' : crew.breakType === 'turnaround_45m' ? 'bg-yellow-500/20 text-yellow-300' : 'bg-orange-500/20 text-orange-300'}">
												{crew.breakType === 'home_48h' ? '48h home break' : crew.breakType === 'rest_8h' ? '8h rest' : crew.breakType === 'turnaround_45m' ? '45m turnaround' : '14h duty break'}
											</span>
										</div>
										<div class="flex items-center justify-between text-[10px] text-white/40">
											<span>{Math.floor(crew.hoursWorkedMin / 60)}h {crew.hoursWorkedMin % 60}m worked</span>
											{#if crew.breakRemainingMin !== null}
												<span class="{crew.breakType === 'home_48h' ? 'text-purple-400/80' : crew.breakType === 'rest_8h' ? 'text-sky-400/80' : crew.breakType === 'turnaround_45m' ? 'text-yellow-400/80' : 'text-orange-400/80'}">
													{Math.floor(crew.breakRemainingMin / 60)}h {crew.breakRemainingMin % 60}m to clear
												</span>
											{/if}
										</div>
									</button>
								{/each}
							</div>
						</div>
					{/if}

					<!-- ── DEPARTING FLIGHTS ── -->
					{#if apt.flightsFrom.length > 0}
						<div class="px-4 py-3">
							<div class="mb-2 text-[10px] font-semibold uppercase tracking-wider text-white/35">
								Departing flights ({apt.flightsFrom.length})
							</div>
							<div class="flex flex-col gap-1">
								{#each [...apt.flightsFrom].sort((a, b) => a.dep_min - b.dep_min) as f}
									<button
										onclick={() => appState.selectFlight(f)}
										class="group flex items-center gap-2 rounded-lg px-2.5 py-2 text-xs transition hover:bg-white/5"
									>
										<span class="h-1.5 w-1.5 shrink-0 rounded-full {STATUS_DOT[f.status]}"></span>
										<span class="flex-1 text-left">
											<span class="font-medium">#{f.flight_num}</span>
											<span class="ml-1.5 text-white/40">→ {f.dest}</span>
										</span>
										<span class="{STATUS_TEXT[f.status]} shrink-0">{f.actual_crew}/{f.min_crew}</span>
										<span class="text-white/30 group-hover:text-white/60">›</span>
									</button>
								{/each}
							</div>
						</div>
					{/if}

					<!-- ── ARRIVING FLIGHTS ── -->
					{#if apt.flightsTo.length > 0}
						<div class="px-4 py-3">
							<div class="mb-2 text-[10px] font-semibold uppercase tracking-wider text-white/35">
								Arriving flights ({apt.flightsTo.length})
							</div>
							<div class="flex flex-col gap-1">
								{#each [...apt.flightsTo].sort((a, b) => a.arr_min - b.arr_min) as f}
									<button
										onclick={() => appState.selectFlight(f)}
										class="group flex items-center gap-2 rounded-lg px-2.5 py-2 text-xs transition hover:bg-white/5"
									>
										<span class="h-1.5 w-1.5 shrink-0 rounded-full {STATUS_DOT[f.status]}"></span>
										<span class="flex-1 text-left">
											<span class="font-medium">#{f.flight_num}</span>
											<span class="ml-1.5 text-white/40">{f.origin} →</span>
										</span>
										<span class="{STATUS_TEXT[f.status]} shrink-0">{f.actual_crew}/{f.min_crew}</span>
										<span class="text-white/30 group-hover:text-white/60">›</span>
									</button>
								{/each}
							</div>
						</div>
					{/if}

				</div>
			{/key}

		<!-- ══════════ ROUTE FLIGHT LIST ══════════ -->
		{:else if appState.panelView === 'route' && appState.selectedRoute}
			{#key appState.selectedRoute.key}
				{@const allFlights = appState.selectedRoute.flights}
				{@const visibleFlights = [...allFlights].filter(f => {
					if (appState.selectedRouteStatus && f.status !== appState.selectedRouteStatus) return false;
					if (f.status === 'covered'   && !appState.showCovered)   return false;
					if (f.status === 'partial'   && !appState.showPartial)   return false;
					if (f.status === 'uncovered' && !appState.showUncovered) return false;
					return true;
				}).sort((a, b) => a.dep_min - b.dep_min)}

				<div class="border-b border-white/8 px-4 py-3">
					<div class="text-base font-bold text-white">{appState.selectedRoute.origin} → {appState.selectedRoute.dest}</div>
					<div class="mt-0.5 flex gap-3 text-xs text-white/40">
						<span>{visibleFlights.length}{visibleFlights.length !== allFlights.length ? `/${allFlights.length}` : ''} flight{allFlights.length !== 1 ? 's' : ''}</span>
						{#if appState.selectedRoute.deadheadCount > 0}
							<span class="text-purple-400/70">{appState.selectedRoute.deadheadCount} DH</span>
						{/if}
						{#if appState.selectedRouteStatus}
							<span class="capitalize" style="color:{appState.selectedRouteStatus === 'covered' ? '#22c55e' : appState.selectedRouteStatus === 'partial' ? '#f97316' : '#ef4444'}">
								{appState.selectedRouteStatus} only
							</span>
							<button onclick={() => appState.selectRoute(appState.selectedRoute, null)} class="text-white/25 hover:text-white/60">show all</button>
						{/if}
					</div>
				</div>

				<!-- Coverage bar (always full route) -->
				{@const total = allFlights.length}
				{@const nCov = allFlights.filter(f => f.status === 'covered').length}
				{@const nPar = allFlights.filter(f => f.status === 'partial').length}
				{@const nUnc = allFlights.filter(f => f.status === 'uncovered').length}
				<div class="flex h-1 shrink-0 overflow-hidden">
					{#if nCov > 0}<div class="bg-green-500"  style="width:{(nCov / total) * 100}%"></div>{/if}
					{#if nPar > 0}<div class="bg-orange-500" style="width:{(nPar / total) * 100}%"></div>{/if}
					{#if nUnc > 0}<div class="bg-red-500"    style="width:{(nUnc / total) * 100}%"></div>{/if}
				</div>

				<div class="flex flex-col divide-y divide-white/5">
					{#if visibleFlights.length === 0}
						<div class="px-4 py-6 text-center text-xs text-white/25">No flights match the active filters</div>
					{:else}
						{#each visibleFlights as flight}
							<button
								onclick={() => appState.selectFlight(flight)}
								class="group flex items-center gap-3 px-4 py-3 text-left transition hover:bg-white/5"
							>
								<span class="h-2 w-2 shrink-0 rounded-full {STATUS_DOT[flight.status]}"></span>
								<div class="min-w-0 flex-1">
									<div class="flex items-baseline justify-between">
										<span class="font-medium">#{flight.flight_num}</span>
										<span class="{STATUS_TEXT[flight.status]} text-xs">{flight.actual_crew}/{flight.min_crew}</span>
									</div>
									<div class="mt-0.5 text-xs text-white/35">{formatMinutes(flight.dep_min)}</div>
								</div>
								<svg class="h-4 w-4 shrink-0 text-white/15 transition group-hover:text-white/50" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
									<path d="M9 18l6-6-6-6"/>
								</svg>
							</button>
						{/each}
					{/if}
				</div>
			{/key}

		<!-- ══════════ CONTROLS / OVERVIEW ══════════ -->
		{:else}
			<!-- Data -->
			<div class="border-b border-white/8 px-4 py-4">
				<div class="mb-2 text-xs font-semibold uppercase tracking-wider text-white/35">Data</div>
				{#if !appState.data}
					<div class="flex flex-col gap-2">
						<label class="flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-white/20 px-3 py-3 text-xs text-white/50 transition hover:border-white/40 hover:text-white/80">
							<svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
								<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12"/>
							</svg>
							Upload JSON
							<input type="file" accept=".json" class="hidden" onchange={handleFileChange} />
						</label>
						<button onclick={loadExample} class="rounded-lg bg-blue-600/20 px-3 py-2 text-xs text-blue-400 transition hover:bg-blue-600/30">
							Load example data
						</button>
					</div>
				{:else}
					<div class="flex items-center justify-between">
						<span class="text-xs text-white/50">{appState.data.flights.length} flights · {appState.data.crew.length} crew</span>
						<label class="cursor-pointer text-xs text-blue-400 hover:text-blue-300">
							Replace
							<input type="file" accept=".json" class="hidden" onchange={handleFileChange} />
						</label>
					</div>
				{/if}
			</div>

			{#if appState.data}

				<!-- ══════ TIMESTAMP / AIRBORNE ══════ -->
				<div class="border-b border-white/8 px-4 py-4">
					<div class="mb-3 flex items-center justify-between">
						<div class="text-xs font-semibold uppercase tracking-wider text-white/35">Airborne Now</div>
						<!-- Editable current time: type into Day / HH / MM to jump the sim clock. -->
						<div class="flex items-center gap-0.5 rounded-md bg-sky-500/10 px-2 py-0.5 font-mono text-xs font-semibold text-sky-300 focus-within:ring-1 focus-within:ring-sky-400/50">
							<svg class="mr-1 h-3 w-3 text-sky-400" viewBox="0 0 24 24" fill="currentColor">
								<path d="M21 16v-2l-8-5V3.5c0-.83-.67-1.5-1.5-1.5S10 2.67 10 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z"/>
							</svg>
							<span>D</span>
							<input
								type="text" inputmode="numeric" aria-label="Day"
								value={currentTimeDHM.day}
								onchange={(e) => setCurrentTime(clampInt((e.target as HTMLInputElement).value, 1, totalDays), currentTimeDHM.h, currentTimeDHM.m)}
								class="w-5 rounded bg-transparent text-center text-sky-200 outline-none focus:bg-sky-500/25"
							/>
							<span class="ml-1 mr-0.5 text-sky-400/40">·</span>
							<input
								type="text" inputmode="numeric" aria-label="Hour"
								value={String(currentTimeDHM.h).padStart(2, '0')}
								onchange={(e) => setCurrentTime(currentTimeDHM.day, clampInt((e.target as HTMLInputElement).value, 0, 23), currentTimeDHM.m)}
								class="w-5 rounded bg-transparent text-center text-sky-200 outline-none focus:bg-sky-500/25"
							/>
							<span>:</span>
							<input
								type="text" inputmode="numeric" aria-label="Minute"
								value={String(currentTimeDHM.m).padStart(2, '0')}
								onchange={(e) => setCurrentTime(currentTimeDHM.day, currentTimeDHM.h, clampInt((e.target as HTMLInputElement).value, 0, 59))}
								class="w-5 rounded bg-transparent text-center text-sky-200 outline-none focus:bg-sky-500/25"
							/>
						</div>
					</div>

					<!-- Timestamp scrubber -->
					<div class="relative">
						<input
							type="range"
							min={0}
							max={appState.horizon}
							step={1}
							value={appState.currentTime}
							oninput={(e) => { appState.currentTime = +(e.target as HTMLInputElement).value; }}
							class="w-full accent-sky-400"
							style="height: 4px;"
						/>
						<div class="mt-1 flex justify-between text-[9px] text-white/20">
							<span>Day 1</span>
							<span>Day {totalDays}</span>
						</div>
					</div>

					<!-- Airborne flights list with scrollbar -->
					<div class="mt-3">
						{#if airborneFlights.length === 0}
							<div class="rounded-lg bg-white/3 px-3 py-4 text-center text-xs text-white/25">
								No flights airborne at this time
							</div>
						{:else}
							<div class="mb-1.5 text-[10px] text-white/30">{airborneFlights.length} flight{airborneFlights.length !== 1 ? 's' : ''} in the air</div>
							<div class="flex max-h-52 flex-col gap-1 overflow-y-auto pr-0.5"
								style="scrollbar-width: thin; scrollbar-color: rgba(255,255,255,0.12) transparent;"
							>
								{#each airborneFlights as flight}
									<button
										onclick={() => appState.selectFlight(flight as any)}
										class="group flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-xs transition hover:bg-white/5"
									>
										<!-- Plane icon -->
										<svg class="h-3.5 w-3.5 shrink-0 text-sky-400/70" viewBox="0 0 24 24" fill="currentColor">
											<path d="M21 16v-2l-8-5V3.5c0-.83-.67-1.5-1.5-1.5S10 2.67 10 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z"/>
										</svg>
										<div class="min-w-0 flex-1">
											<div class="flex items-center justify-between gap-1">
												<span class="font-semibold text-white/80">
													{flight.origin}<span class="mx-1 text-white/30">→</span>{flight.dest}
												</span>
												<span class="shrink-0 text-[10px] {STATUS_TEXT[flight.status]}">
													{flight.actual_crew}/{flight.min_crew}
												</span>
											</div>
											<!-- Timestamps row -->
											<div class="mt-0.5 flex items-center justify-between gap-1 text-[10px] text-white/30">
												<div class="flex items-center gap-1.5">
													<span class="h-1.5 w-1.5 rounded-full {STATUS_DOT[flight.status]}"></span>
													<span>#{flight.flight_num}</span>
												</div>
												<div class="flex items-center gap-1 font-mono">
													<span class="text-white/40">{formatMinutes(flight.dep_min).split('  ')[1]}</span>
													<span class="text-white/15">→</span>
													<span class="text-white/40">{formatMinutes(flight.arr_min).split('  ')[1]}</span>
												</div>
											</div>
											<!-- Flight progress bar -->
											<div class="mt-1.5 h-0.5 w-full overflow-hidden rounded-full bg-white/8">
												<div
													class="h-full rounded-full bg-sky-400/60 transition-all"
													style="width:{Math.min(1, Math.max(0, (appState.currentTime - flight.dep_min) / (flight.arr_min - flight.dep_min))) * 100}%"
												></div>
											</div>
										</div>
										<svg class="h-3.5 w-3.5 shrink-0 text-white/15 transition group-hover:text-white/50" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
											<path d="M9 18l6-6-6-6"/>
										</svg>
									</button>
								{/each}
							</div>
						{/if}
					</div>
				</div>

				<!-- Filters -->
				<div class="border-b border-white/8 px-4 py-4">
					<div class="mb-2 text-xs font-semibold uppercase tracking-wider text-white/35">Layers</div>
					<div class="flex flex-col gap-2">
						{#each [
							{ key: 'showCovered'   as const, label: 'Covered',   color: '#22c55e' },
							{ key: 'showPartial'   as const, label: 'Partial',    color: '#f97316' },
							{ key: 'showUncovered' as const, label: 'Uncovered',  color: '#ef4444' },
							{ key: 'showDeadheads' as const, label: 'Deadheads',  color: '#a855f7' }
						] as item}
							<label class="flex cursor-pointer items-center gap-2.5">
								<input type="checkbox" checked={appState[item.key]} onchange={() => { appState[item.key] = !appState[item.key]; }} class="hidden" />
								<span class="flex h-4 w-4 shrink-0 items-center justify-center rounded border transition"
									style="border-color:{item.color}; background:{appState[item.key] ? item.color + '2a' : 'transparent'}">
									{#if appState[item.key]}
										<svg class="h-3 w-3" style="color:{item.color}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M20 6L9 17l-5-5"/></svg>
									{/if}
								</span>
								<span class="flex items-center gap-1.5 text-xs text-white/60">
									<span class="h-1.5 w-4 rounded-sm" style="background:{item.color}"></span>
									{item.label}
								</span>
							</label>
						{/each}
					</div>
				</div>

				<!-- Airport Filter -->
				<div class="border-b border-white/8 px-4 py-4">
					<div class="mb-2 flex items-center justify-between">
						<div class="text-xs font-semibold uppercase tracking-wider text-white/35">Airport Filter</div>
						{#if appState.filterAirportA || appState.filterAirportB}
							<button
								onclick={() => { appState.clearAirportFilter(); airportSearch = { A: '', B: '' }; airportDropdownOpen = null; }}
								class="flex items-center gap-1 rounded-md bg-amber-500/20 px-2 py-0.5 text-[10px] text-amber-300 hover:bg-amber-500/30 transition"
							>
								<svg class="h-2.5 w-2.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M18 6L6 18M6 6l12 12"/></svg>
								Clear
							</button>
						{/if}
					</div>

					<p class="mb-2 text-[10px] leading-snug text-white/30">
						Pick an airport to show only its flights, or two to show flights between them.
					</p>

					{#each ['A', 'B'] as const as slot}
						{@const selected = slot === 'A' ? appState.filterAirportA : appState.filterAirportB}
						{@const disabled = slot === 'B' && !appState.filterAirportA}
						<div class="relative {slot === 'B' ? 'mt-2' : ''}">
							{#if selected}
								<!-- Selected chip -->
								<div class="flex items-center justify-between rounded-lg border border-amber-500/40 bg-amber-500/10 px-2.5 py-2">
									<div class="flex items-center gap-2">
										<span class="flex h-4 w-4 items-center justify-center rounded text-[9px] font-bold text-amber-300/60">{slot}</span>
										<span class="font-semibold tracking-wide text-amber-200">{selected}</span>
									</div>
									<button
										onclick={() => { appState.setFilterAirport(slot, null); if (slot === 'A' && appState.filterAirportB) { appState.setFilterAirport('A', appState.filterAirportB); appState.setFilterAirport('B', null); } }}
										class="text-amber-300/50 hover:text-amber-200"
										aria-label="Remove airport {slot}"
									>
										<svg class="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M18 6L6 18M6 6l12 12"/></svg>
									</button>
								</div>
							{:else}
								<!-- Search input -->
								<div class="flex items-center gap-2 rounded-lg bg-white/5 px-2.5 py-2 {disabled ? 'opacity-40' : ''} {airportDropdownOpen === slot ? 'ring-1 ring-amber-500/50' : ''}">
									<span class="flex h-4 w-4 items-center justify-center rounded text-[9px] font-bold text-white/25">{slot}</span>
									<input
										type="text"
										bind:value={airportSearch[slot]}
										{disabled}
										onfocus={() => (airportDropdownOpen = slot)}
										placeholder={slot === 'A' ? 'Search airport…' : 'Second airport (optional)…'}
										class="flex-1 bg-transparent text-xs text-white/70 placeholder-white/20 outline-none disabled:cursor-not-allowed"
									/>
								</div>
							{/if}

							{#if airportDropdownOpen === slot && !selected && !disabled}
								<div class="fixed inset-0 z-40" onclick={() => (airportDropdownOpen = null)}></div>
								<div class="absolute left-0 right-0 top-full z-50 mt-1 max-h-48 overflow-y-auto rounded-xl border border-white/10 bg-[#1a1d2e] py-1 shadow-2xl"
									style="scrollbar-width: thin; scrollbar-color: rgba(255,255,255,0.12) transparent;"
								>
									{#if filteredAirports(slot).length === 0}
										<div class="px-3 py-2 text-xs text-white/25">No airports found</div>
									{:else}
										{#each filteredAirports(slot) as iata}
											<button
												onclick={() => { appState.setFilterAirport(slot, iata); airportSearch[slot] = ''; airportDropdownOpen = null; }}
												class="flex w-full items-center gap-2 px-3 py-2 text-xs text-white/70 transition hover:bg-white/8"
											>
												<svg class="h-3 w-3 text-white/30" viewBox="0 0 24 24" fill="currentColor"><path d="M21 16v-2l-8-5V3.5c0-.83-.67-1.5-1.5-1.5S10 2.67 10 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z"/></svg>
												<span class="font-medium tracking-wide">{iata}</span>
											</button>
										{/each}
									{/if}
								</div>
							{/if}
						</div>
					{/each}

					<!-- Whole-schedule in/out flight list (expandable) -->
					{#if appState.filterAirportA}
						<div class="mt-3 border-t border-white/8 pt-3">
							<button
								onclick={() => (airportListExpanded = !airportListExpanded)}
								class="flex w-full items-center justify-between text-left text-xs text-white/60 transition hover:text-white/90"
							>
								<span class="flex items-center gap-1.5">
									<svg class="h-3.5 w-3.5 shrink-0 text-white/30 transition-transform {airportListExpanded ? 'rotate-90' : ''}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M9 18l6-6-6-6"/></svg>
									All scheduled flights
									{#if appState.filterAirportB}
										<span class="text-white/40">{appState.filterAirportA}↔{appState.filterAirportB}</span>
									{:else}
										<span class="text-white/40">in/out of {appState.filterAirportA}</span>
									{/if}
								</span>
								<span class="rounded bg-white/8 px-1.5 py-0.5 text-[10px] text-white/50">{airportScheduleFlights.length}</span>
							</button>

							{#if airportListExpanded}
								{#if airportScheduleFlights.length === 0}
									<div class="mt-2 rounded-lg bg-white/3 px-3 py-3 text-center text-[11px] text-white/25">
										No flights match the current status filter
									</div>
								{:else}
									<div class="mt-2 flex max-h-72 flex-col gap-1 overflow-y-auto pr-0.5"
										style="scrollbar-width: thin; scrollbar-color: rgba(255,255,255,0.12) transparent;"
									>
										{#each airportScheduleFlights as flight}
											<button
												onclick={() => { appState.currentTime = flight.dep_min; }}
												class="group flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs transition hover:bg-white/5"
											>
												<span class="h-1.5 w-1.5 shrink-0 rounded-full {STATUS_DOT[flight.status]}"></span>
												<div class="min-w-0 flex-1">
													<div class="flex items-center justify-between gap-1">
														<span class="font-semibold text-white/80">
															{flight.origin}<span class="mx-1 text-white/30">→</span>{flight.dest}
														</span>
														<span class="shrink-0 text-[10px] {STATUS_TEXT[flight.status]}">
															{flight.actual_crew}/{flight.min_crew}
														</span>
													</div>
													<div class="mt-0.5 flex items-center justify-between gap-1 text-[10px] text-white/30">
														<span>#{flight.flight_num}</span>
														<span class="flex items-center gap-1 font-mono">
															<span class="text-white/45">{formatMinutes(flight.dep_min)}</span>
															<span class="text-white/15">→</span>
															<span class="text-white/45">{formatMinutes(flight.arr_min)}</span>
														</span>
													</div>
												</div>
											</button>
										{/each}
									</div>
								{/if}
							{/if}
						</div>
					{/if}
				</div>

				<!-- Crew Filter -->
				<div class="border-b border-white/8 px-4 py-4">
					<div class="mb-2 flex items-center justify-between">
						<div class="text-xs font-semibold uppercase tracking-wider text-white/35">Crew Focus</div>
						{#if appState.focusedCrewId !== null}
							<button
								onclick={() => { appState.focusCrew(null); crewSearch = ''; crewDropdownOpen = false; }}
								class="flex items-center gap-1 rounded-md bg-blue-500/20 px-2 py-0.5 text-[10px] text-blue-300 hover:bg-blue-500/30 transition"
							>
								<svg class="h-2.5 w-2.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M18 6L6 18M6 6l12 12"/></svg>
								Crew #{appState.focusedCrewId}
							</button>
						{/if}
					</div>

					<!-- Search input -->
					<div class="relative">
						<div class="flex items-center gap-2 rounded-lg bg-white/5 px-2.5 py-2 {crewDropdownOpen ? 'ring-1 ring-blue-500/50' : ''}">
							<svg class="h-3 w-3 shrink-0 text-white/25" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
								<circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/>
							</svg>
							<input
								type="text"
								bind:value={crewSearch}
								onfocus={() => (crewDropdownOpen = true)}
								placeholder="Search crew ID or base…"
								class="flex-1 bg-transparent text-xs text-white/70 placeholder-white/20 outline-none"
							/>
							{#if crewSearch}
								<button onclick={() => { crewSearch = ''; }} class="text-white/25 hover:text-white/60">
									<svg class="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M18 6L6 18M6 6l12 12"/></svg>
								</button>
							{/if}
						</div>

						<!-- Dropdown -->
						{#if crewDropdownOpen && appState.data}
							<div class="fixed inset-0 z-40" onclick={() => (crewDropdownOpen = false)}></div>
							<div class="absolute left-0 right-0 top-full z-50 mt-1 max-h-48 overflow-y-auto rounded-xl border border-white/10 bg-[#1a1d2e] py-1 shadow-2xl"
								style="scrollbar-width: thin; scrollbar-color: rgba(255,255,255,0.12) transparent;"
							>
								{#if filteredCrew.length === 0}
									<div class="px-3 py-2 text-xs text-white/25">No crew found</div>
								{:else}
									{#each filteredCrew as c}
										<button
											onclick={() => { appState.focusCrew(c.id); crewSearch = ''; crewDropdownOpen = false; }}
											class="flex w-full items-center justify-between px-3 py-2 text-xs transition hover:bg-white/8 {appState.focusedCrewId === c.id ? 'bg-blue-500/15 text-blue-300' : 'text-white/70'}"
										>
											<div class="flex items-center gap-2">
												<svg class="h-3 w-3 text-white/30" viewBox="0 0 24 24" fill="currentColor">
													<path d="M12 12c2.7 0 4.8-2.1 4.8-4.8S14.7 2.4 12 2.4 7.2 4.5 7.2 7.2 9.3 12 12 12zm0 2.4c-3.2 0-9.6 1.6-9.6 4.8v2.4h19.2v-2.4c0-3.2-6.4-4.8-9.6-4.8z"/>
												</svg>
												<span class="font-medium">Crew #{c.id}</span>
											</div>
											<span class="rounded bg-white/8 px-1.5 py-0.5 text-[10px] text-white/40">{c.base}</span>
										</button>
									{/each}
								{/if}
							</div>
						{/if}
					</div>

					<!-- Focused crew route summary -->
					{#if appState.focusedCrewId !== null && focusedCrewLegs.length > 0}
						<div class="mt-3">
							<div class="mb-1.5 text-[10px] text-white/25">{focusedCrewLegs.length} leg{focusedCrewLegs.length !== 1 ? 's' : ''} total</div>
							<div class="flex flex-col gap-0.5">
								{#each focusedCrewLegs as leg}
									{@const isActive = leg.dep <= appState.currentTime && leg.arr >= appState.currentTime}
									<div class="flex items-center gap-2 rounded-md px-2 py-1.5 text-[10px] transition {isActive ? 'bg-sky-500/15 text-sky-300' : 'text-white/30'}">
										<span class="h-1.5 w-1.5 shrink-0 rounded-full {isActive ? 'bg-sky-400' : leg.type === 'deadhead' ? 'bg-purple-400/40' : 'bg-white/15'}"></span>
										<span class="font-medium shrink-0">{leg.from}→{leg.to}</span>
										{#if leg.type === 'deadhead'}<span class="text-purple-400/70 shrink-0">DH</span>{/if}
										<div class="ml-auto flex flex-col items-end gap-0.5 font-mono leading-tight">
											<span>{formatMinutes(leg.dep)}</span>
											<span class="opacity-50">{formatMinutes(leg.arr)}</span>
										</div>
									</div>
								{/each}
							</div>
						</div>
					{/if}
				</div>

				<!-- Stats -->
				<div class="px-4 py-4">
					<div class="mb-2 text-xs font-semibold uppercase tracking-wider text-white/35">Summary</div>
					<div class="grid grid-cols-2 gap-1.5">
						{#each [['Flights', appState.data.meta.num_flights], ['Covered', appState.data.meta.covered_flights], ['Crew', appState.data.crew.length], ['Uncov. slots', appState.data.meta.uncovered_slots]] as [label, val]}
							<div class="rounded-lg bg-white/5 px-3 py-2">
								<div class="text-xs text-white/30">{label}</div>
								<div class="mt-0.5 text-base font-semibold">{val}</div>
							</div>
						{/each}
					</div>
				</div>
			{/if}
		{/if}
	</div>

	<!-- Legend -->
	<div class="shrink-0 border-t border-white/8 px-4 py-2.5">
		<div class="flex flex-wrap gap-x-3 gap-y-1 text-xs text-white/35">
			{#each [['#22c55e','Covered'],['#f97316','Partial'],['#ef4444','Uncovered'],['#a855f7','Deadhead']] as [c, l]}
				<span class="flex items-center gap-1.5">
					<span class="h-1.5 w-4 rounded" style="background:{c}"></span>{l}
				</span>
			{/each}
		</div>
	</div>
</aside>

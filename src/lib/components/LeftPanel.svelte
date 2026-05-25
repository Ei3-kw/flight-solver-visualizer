<script lang="ts">
	import { appState } from '$lib/state.svelte';
	import { formatMinutes, formatDuration } from '$lib/processData';

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

	const totalDays = $derived(Math.ceil(appState.horizon / 1440) + 1);

	function toDHM(min: number) {
		return { day: Math.floor(min / 1440) + 1, h: Math.floor((min % 1440) / 60), m: min % 60 };
	}

	function fromDHM(day: number, h: number, m: number) {
		return (day - 1) * 1440 + h * 60 + m;
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
		{:else if appState.panelView === 'airport' && appState.selectedAirport}
			{#key appState.selectedAirport.iata}
				<div class="flex flex-col gap-3 px-4 py-4">
					<div>
						<div class="text-3xl font-bold tracking-widest text-white">{appState.selectedAirport.iata}</div>
						<div class="mt-1 flex gap-3 text-xs">
							<span class="text-blue-400">⬤ {appState.selectedAirport.basedCrew.length} based</span>
							<span class="text-green-400">↑ {appState.selectedAirport.departingCrewCount} departing</span>
							<span class="text-amber-400">↓ {appState.selectedAirport.arrivingCrewCount} arriving</span>
						</div>
					</div>

					<!-- Based crew -->
					{#if appState.selectedAirport.basedCrew.length > 0}
						<div>
							<div class="mb-2 text-xs font-semibold uppercase tracking-wider text-white/35">
								Based here ({appState.selectedAirport.basedCrew.length})
							</div>
							<div class="flex flex-wrap gap-1.5">
								{#each appState.selectedAirport.basedCrew as cid}
									<span class="rounded bg-blue-500/20 px-2 py-0.5 text-xs text-blue-300">#{cid}</span>
								{/each}
							</div>
						</div>
					{/if}

					<!-- Departing flights -->
					{#if appState.selectedAirport.flightsFrom.length > 0}
						<div>
							<div class="mb-2 text-xs font-semibold uppercase tracking-wider text-white/35">
								Departing ({appState.selectedAirport.flightsFrom.length})
							</div>
							<div class="flex flex-col gap-1">
								{#each [...appState.selectedAirport.flightsFrom].sort((a, b) => a.dep_min - b.dep_min) as f}
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

					<!-- Arriving flights -->
					{#if appState.selectedAirport.flightsTo.length > 0}
						<div>
							<div class="mb-2 text-xs font-semibold uppercase tracking-wider text-white/35">
								Arriving ({appState.selectedAirport.flightsTo.length})
							</div>
							<div class="flex flex-col gap-1">
								{#each [...appState.selectedAirport.flightsTo].sort((a, b) => a.arr_min - b.arr_min) as f}
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
				<!-- Time range -->
				<div class="border-b border-white/8 px-4 py-4">
					<div class="mb-3 text-xs font-semibold uppercase tracking-wider text-white/35">Time Window</div>

					{#if pickerOpen}
						<div class="fixed inset-0 z-40" onclick={() => (pickerOpen = null)}></div>
					{/if}

					<div class="grid grid-cols-2 gap-2">
						<!-- Start -->
						<div class="relative">
							<div class="mb-1 text-[10px] uppercase tracking-wider text-white/25">From</div>
							<button
								onclick={() => (pickerOpen = pickerOpen === 'start' ? null : 'start')}
								class="w-full rounded-lg bg-white/5 px-2.5 py-2 text-left text-xs text-white/70 transition hover:bg-white/8 {pickerOpen === 'start' ? 'ring-1 ring-blue-500/50' : ''}"
							>
								Day {startDHM.day}<br/><span class="text-white/40">{String(startDHM.h).padStart(2,'0')}:{String(startDHM.m).padStart(2,'0')}</span>
							</button>
							{#if pickerOpen === 'start'}
								<div class="absolute left-0 top-full z-50 mt-1 w-56 rounded-xl border border-white/10 bg-[#1a1d2e] p-3 shadow-2xl">
									<div class="mb-2 grid grid-cols-7 gap-0.5">
										{#each Array.from({ length: totalDays }, (_, i) => i + 1) as d}
											<button
												onclick={() => pickStartDay(d)}
												class="rounded py-1 text-center text-[10px] transition {startDHM.day === d ? 'bg-blue-500/40 text-blue-300 font-semibold' : 'text-white/40 hover:bg-white/8 hover:text-white/70'}"
											>{d}</button>
										{/each}
									</div>
									<div class="mt-3">
										<div class="mb-1 text-center text-xs font-medium text-white/70">
											{String(startDHM.h).padStart(2,'0')}:{String(startDHM.m).padStart(2,'0')}
										</div>
										<input type="range" min="0" max="1439" step="5"
											value={startDHM.h * 60 + startDHM.m}
											oninput={(e) => { const v = +(e.target as HTMLInputElement).value; pickStartTime(Math.floor(v/60), v%60); }}
											class="w-full accent-blue-500" />
										<div class="mt-0.5 flex justify-between text-[9px] text-white/20">
											<span>00:00</span><span>12:00</span><span>23:55</span>
										</div>
									</div>
								</div>
							{/if}
						</div>

						<!-- End -->
						<div class="relative">
							<div class="mb-1 text-[10px] uppercase tracking-wider text-white/25">To</div>
							<button
								onclick={() => (pickerOpen = pickerOpen === 'end' ? null : 'end')}
								class="w-full rounded-lg bg-white/5 px-2.5 py-2 text-left text-xs text-white/70 transition hover:bg-white/8 {pickerOpen === 'end' ? 'ring-1 ring-blue-500/50' : ''}"
							>
								Day {endDHM.day}<br/><span class="text-white/40">{String(endDHM.h).padStart(2,'0')}:{String(endDHM.m).padStart(2,'0')}</span>
							</button>
							{#if pickerOpen === 'end'}
								<div class="absolute right-0 top-full z-50 mt-1 w-56 rounded-xl border border-white/10 bg-[#1a1d2e] p-3 shadow-2xl">
									<div class="mb-2 grid grid-cols-7 gap-0.5">
										{#each Array.from({ length: totalDays }, (_, i) => i + 1) as d}
											<button
												onclick={() => pickEndDay(d)}
												class="rounded py-1 text-center text-[10px] transition {endDHM.day === d ? 'bg-blue-500/40 text-blue-300 font-semibold' : 'text-white/40 hover:bg-white/8 hover:text-white/70'}"
											>{d}</button>
										{/each}
									</div>
									<div class="mt-3">
										<div class="mb-1 text-center text-xs font-medium text-white/70">
											{String(endDHM.h).padStart(2,'0')}:{String(endDHM.m).padStart(2,'0')}
										</div>
										<input type="range" min="0" max="1439" step="5"
											value={endDHM.h * 60 + endDHM.m}
											oninput={(e) => { const v = +(e.target as HTMLInputElement).value; pickEndTime(Math.floor(v/60), v%60); }}
											class="w-full accent-blue-500" />
										<div class="mt-0.5 flex justify-between text-[9px] text-white/20">
											<span>00:00</span><span>12:00</span><span>23:55</span>
										</div>
									</div>
								</div>
							{/if}
						</div>
					</div>

					<!-- Range bar (visual overview) -->
					<div class="relative mt-3 h-1.5 overflow-hidden rounded-full bg-white/8">
						<div
							class="absolute h-full rounded-full bg-blue-500/50"
							style="left:{(appState.timeRange[0] / appState.horizon) * 100}%; right:{100 - (appState.timeRange[1] / appState.horizon) * 100}%"
						></div>
					</div>

					<button onclick={() => (appState.timeRange = [0, appState.horizon])} class="mt-2 text-xs text-white/25 hover:text-white/55">Reset</button>
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

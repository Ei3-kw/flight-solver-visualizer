<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import maplibregl from 'maplibre-gl';
	import { MapboxOverlay } from '@deck.gl/mapbox';
	import { processData } from '$lib/processData';
	import { appState } from '$lib/state.svelte';
	import { buildArcLayers, buildAirportLayers } from '$lib/layers';
	import type { ArcRenderData, RouteData, AirportInfo } from '$lib/types';

	let mapContainer: HTMLDivElement;
	let map: maplibregl.Map;
	let overlay: InstanceType<typeof MapboxOverlay>;
	let mapReady = $state(false);

	let routesRef: Map<string, RouteData> = new Map();
	let airportsRef: Map<string, AirportInfo> = new Map();
	let tooltip = $state<{ x: number; y: number; arc: ArcRenderData } | null>(null);

	const processed = $derived(
		appState.data
			? processData(appState.data, appState.timeRange[0], appState.timeRange[1])
			: null
	);

	function buildLayers() {
		if (!processed) return [];

		const arcLayers = buildArcLayers(
			processed.arcs,
			processed.deadheadArcs,
			(info) => {
				tooltip = info.object ? { x: info.x, y: info.y, arc: info.object } : null;
			},
			(arc) => appState.selectRoute(routesRef.get(arc.routeKey) ?? null)
		);

		const airportLayers = buildAirportLayers(processed.airports, (airport) =>
			appState.selectAirport(airport)
		);

		return [...arcLayers, ...airportLayers];
	}

	$effect(() => {
		if (!mapReady || !overlay) return;
		const p = processed;
		// track filter deps
		void appState.selectedRoute;
		void appState.selectedAirport;
		void appState.showDeadheads;
		void appState.showCovered;
		void appState.showPartial;
		void appState.showUncovered;

		routesRef = p?.routes ?? new Map();
		airportsRef = p?.airports ?? new Map();
		overlay.setProps({ layers: buildLayers() });
	});

	onMount(() => {
		map = new maplibregl.Map({
			container: mapContainer,
			style: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
			center: [-30, 30],
			zoom: 2
		});

		overlay = new MapboxOverlay({ interleaved: false, layers: [] });
		map.addControl(overlay);
		map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');

		map.on('load', () => {
			mapReady = true;
		});
	});

	onDestroy(() => {
		map?.remove();
	});
</script>

<div class="relative h-full w-full">
	<div bind:this={mapContainer} class="absolute inset-0 h-full w-full"></div>

	{#if tooltip}
		<div
			class="pointer-events-none absolute z-10 rounded-lg border border-white/10 bg-[#1a1d27]/95 px-3 py-2 text-xs shadow-xl"
			style="left:{tooltip.x + 14}px; top:{tooltip.y - 10}px"
		>
			<div class="mb-0.5 font-semibold text-white">{tooltip.arc.origin} → {tooltip.arc.dest}</div>
			<div class="text-white/60">
				{tooltip.arc.count} flight{tooltip.arc.count !== 1 ? 's' : ''} ·
				<span
					class="capitalize"
					style="color:{tooltip.arc.status === 'covered' ? '#22c55e' : tooltip.arc.status === 'partial' ? '#f97316' : '#ef4444'}"
				>
					{tooltip.arc.status}
				</span>
			</div>
		</div>
	{/if}
</div>

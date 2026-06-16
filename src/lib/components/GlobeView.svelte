<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { Deck, _GlobeView as GlobeView } from '@deck.gl/core';
	import { BitmapLayer } from '@deck.gl/layers';
	import { TileLayer } from '@deck.gl/geo-layers';
	import { processData } from '$lib/processData';
	import { appState } from '$lib/state.svelte';
	import { buildArcLayers, buildAirportLayers } from '$lib/layers';
	import type { ArcRenderData, RouteData, AirportInfo } from '$lib/types';

	let canvas: HTMLCanvasElement;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	let deck: any;

	let routesRef: Map<string, RouteData> = new Map();
	let airportsRef: Map<string, AirportInfo> = new Map();
	let tooltip = $state<{ x: number; y: number; arc: ArcRenderData } | null>(null);

	const processed = $derived(
		appState.data
			? processData(appState.data, appState.currentTime, appState.currentTime, appState.focusedCrewId)
			: null
	);

	function buildLayers() {
		const basemap = new TileLayer({
			id: 'globe-tiles',
			data: 'https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png',
			minZoom: 0,
			maxZoom: 5,
			tileSize: 256,
			renderSubLayers: (props) => {
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				const { west, south, east, north } = (props.tile as any).bbox;
				return new BitmapLayer({
					...props,
					data: undefined,
					image: props.data,
					bounds: [west, south, east, north] as [number, number, number, number]
				});
			}
		});

		if (!processed) return [basemap];

		const arcLayers = buildArcLayers(
			processed.arcs,
			processed.deadheadArcs,
			(info) => {
				tooltip = info.object ? { x: info.x, y: info.y, arc: info.object } : null;
			},
			(arc) => appState.selectRoute(routesRef.get(arc.routeKey) ?? null, arc.status !== 'deadhead' ? arc.status : null)
		);

		const airportLayers = buildAirportLayers(processed.airports, (airport) =>
			appState.selectAirport(airport)
		);

		return [basemap, ...arcLayers, ...airportLayers];
	}

	$effect(() => {
		if (!deck) return;
		const p = processed;
		void appState.selectedRoute;
		void appState.selectedAirport;
		void appState.showDeadheads;
		void appState.showCovered;
		void appState.showPartial;
		void appState.showUncovered;

		routesRef = p?.routes ?? new Map();
		airportsRef = p?.airports ?? new Map();
		deck.setProps({ layers: buildLayers() });
	});

	onMount(() => {
		deck = new Deck({
			canvas,
			views: [new GlobeView({ id: 'globe' })],
			initialViewState: {
				globe: { longitude: -20, latitude: 20, zoom: 1.2 }
			},
			controller: true,
			layers: buildLayers(),
			getCursor: ({ isDragging }: { isDragging: boolean }) =>
				isDragging ? 'grabbing' : 'default'
		});
	});

	onDestroy(() => {
		deck?.finalize();
	});
</script>

<div class="relative h-full w-full bg-[#0a0c1e]">
	<canvas bind:this={canvas} class="absolute inset-0 h-full w-full"></canvas>

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

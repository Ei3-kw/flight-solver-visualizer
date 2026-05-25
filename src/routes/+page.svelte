<script lang="ts">
	import MapView from '$lib/components/MapView.svelte';
	import GlobeView from '$lib/components/GlobeView.svelte';
	import LeftPanel from '$lib/components/LeftPanel.svelte';
	import { appState } from '$lib/state.svelte';
</script>

<svelte:head>
	<title>FlightViz — Crew Scheduling</title>
</svelte:head>

<div class="flex h-screen w-screen overflow-hidden bg-[#0e1018] text-white">
	<LeftPanel />

	<main class="relative flex-1 overflow-hidden">
		<!-- View mode toggle -->
		<div class="absolute right-4 top-4 z-20 flex overflow-hidden rounded-lg border border-white/10 bg-[#1a1d27]/90 shadow-lg backdrop-blur-sm">
			<button
				onclick={() => (appState.viewMode = 'map')}
				class="flex items-center gap-1.5 px-3 py-1.5 text-xs transition {appState.viewMode === 'map' ? 'bg-blue-600 text-white' : 'text-white/50 hover:text-white/80'}"
			>
				<svg class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
					<rect x="3" y="3" width="18" height="18" rx="2"/>
					<path d="M3 9h18M3 15h18M9 3v18M15 3v18"/>
				</svg>
				Map
			</button>
			<button
				onclick={() => (appState.viewMode = 'globe')}
				class="flex items-center gap-1.5 px-3 py-1.5 text-xs transition {appState.viewMode === 'globe' ? 'bg-blue-600 text-white' : 'text-white/50 hover:text-white/80'}"
			>
				<svg class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
					<circle cx="12" cy="12" r="10"/>
					<path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
				</svg>
				Globe
			</button>
		</div>

		{#if !appState.data}
			<div class="absolute inset-0 z-10 flex flex-col items-center justify-center gap-4 bg-[#0e1018]/80 backdrop-blur-sm">
				<div class="text-center">
					<div class="mb-2 text-4xl">✈</div>
					<div class="text-lg font-semibold text-white/80">No data loaded</div>
					<div class="mt-1 text-sm text-white/40">Upload a schedule JSON or load the example from the sidebar</div>
				</div>
			</div>
		{/if}

		{#if appState.viewMode === 'globe'}
			<GlobeView />
		{:else}
			<MapView />
		{/if}
	</main>
</div>

import { ArcLayer, ScatterplotLayer, TextLayer } from '@deck.gl/layers';
import type { ArcRenderData, AirportInfo } from './types';
import { appState } from './state.svelte';

type RGBA = [number, number, number, number];

export const STATUS_COLORS: Record<string, RGBA> = {
	covered: [34, 197, 94, 210],
	partial: [249, 115, 22, 210],
	uncovered: [239, 68, 68, 230],
	deadhead: [168, 85, 247, 170]
};

const STATUS_HEIGHT: Record<string, number> = {
	covered: 0.45,
	partial: 0.58,
	uncovered: 0.7,
	deadhead: 0.3
};

export function buildArcLayers(
	arcs: ArcRenderData[],
	deadheadArcs: ArcRenderData[],
	onHover: (info: { object?: ArcRenderData; x: number; y: number }) => void,
	onClick: (arc: ArcRenderData) => void
) {
	const selectedKey = appState.selectedRoute?.key;

	const visibleArcs = arcs.filter((a) => {
		if (a.status === 'covered' && !appState.showCovered) return false;
		if (a.status === 'partial' && !appState.showPartial) return false;
		if (a.status === 'uncovered' && !appState.showUncovered) return false;
		return true;
	});

	const arcLayer = new ArcLayer<ArcRenderData>({
		id: 'flight-arcs',
		data: visibleArcs,
		getSourcePosition: (d) => d.sourcePosition,
		getTargetPosition: (d) => d.targetPosition,
		getSourceColor: (d) =>
			selectedKey && d.routeKey === selectedKey
				? ([255, 255, 255, 240] as RGBA)
				: (STATUS_COLORS[d.status] ?? STATUS_COLORS.covered),
		getTargetColor: (d) =>
			selectedKey && d.routeKey === selectedKey
				? ([255, 255, 255, 240] as RGBA)
				: (STATUS_COLORS[d.status] ?? STATUS_COLORS.covered),
		getWidth: (d) => Math.min(8, Math.max(1, Math.log2(d.count + 1) * 2)),
		widthUnits: 'pixels',
		getHeight: (d) => STATUS_HEIGHT[d.status] ?? 0.5,
		pickable: true,
		autoHighlight: true,
		highlightColor: [255, 255, 255, 60],
		onHover,
		onClick: (info) => {
			if (info.object) onClick(info.object as ArcRenderData);
		},
		updateTriggers: {
			getSourceColor: [selectedKey],
			getTargetColor: [selectedKey]
		}
	});

	const dhLayer = appState.showDeadheads
		? new ArcLayer<ArcRenderData>({
				id: 'deadhead-arcs',
				data: deadheadArcs,
				getSourcePosition: (d) => d.sourcePosition,
				getTargetPosition: (d) => d.targetPosition,
				getSourceColor: STATUS_COLORS.deadhead,
				getTargetColor: STATUS_COLORS.deadhead,
				getWidth: (d) => Math.min(4, Math.max(1, Math.log2(d.count + 1) * 1.2)),
				widthUnits: 'pixels',
				getHeight: STATUS_HEIGHT.deadhead,
				pickable: false
			})
		: null;

	return [dhLayer, arcLayer].filter(Boolean);
}

export function buildAirportLayers(
	airports: Map<string, AirportInfo>,
	onAirportClick: (airport: AirportInfo) => void
) {
	const nodes = Array.from(airports.values());
	const selectedIata = appState.selectedAirport?.iata;

	// Dot layer
	const dotLayer = new ScatterplotLayer<AirportInfo>({
		id: 'airports',
		data: nodes,
		getPosition: (d) => d.coords,
		getFillColor: (d) => {
			if (d.iata === selectedIata) return [255, 255, 255, 240] as RGBA;
			return d.basedCrew.length > 0 ? ([59, 130, 246, 220] as RGBA) : ([140, 140, 160, 180] as RGBA);
		},
		getRadius: (d) => Math.min(10, Math.max(4, Math.log2(d.basedCrew.length + 2) * 3.5)),
		radiusUnits: 'pixels',
		pickable: true,
		autoHighlight: true,
		highlightColor: [255, 255, 255, 80],
		onClick: (info) => {
			if (info.object) onAirportClick(info.object as AirportInfo);
		},
		updateTriggers: { getFillColor: [selectedIata] }
	});

	// Label: airport IATA code
	const labelLayer = new TextLayer<AirportInfo>({
		id: 'airport-labels',
		data: nodes,
		getPosition: (d) => d.coords,
		getText: (d) => d.iata,
		getSize: 11,
		getColor: [220, 230, 255, 180],
		getPixelOffset: [0, -18],
		fontFamily: 'monospace',
		fontWeight: 'bold',
		pickable: false
	});

	// Based crew count — top-right of dot (blue)
	const basedCountLayer = new TextLayer<AirportInfo>({
		id: 'airport-based',
		data: nodes.filter((d) => d.basedCrew.length > 0),
		getPosition: (d) => d.coords,
		getText: (d) => String(d.basedCrew.length),
		getSize: 12,
		getColor: [96, 165, 250, 220], // blue-400
		getPixelOffset: [16, -8],
		fontFamily: 'monospace',
		fontWeight: 'bold',
		pickable: false
	});

	// Departing crew — right of dot (green)
	const departingLayer = new TextLayer<AirportInfo>({
		id: 'airport-departing',
		data: nodes.filter((d) => d.departingCrewCount > 0),
		getPosition: (d) => d.coords,
		getText: (d) => `↑${d.departingCrewCount}`,
		getSize: 10,
		getColor: [74, 222, 128, 200], // green-400
		getPixelOffset: [18, 4],
		fontFamily: 'monospace',
		pickable: false
	});

	// Arriving crew — left of dot (amber)
	const arrivingLayer = new TextLayer<AirportInfo>({
		id: 'airport-arriving',
		data: nodes.filter((d) => d.arrivingCrewCount > 0),
		getPosition: (d) => d.coords,
		getText: (d) => `↓${d.arrivingCrewCount}`,
		getSize: 10,
		getColor: [251, 191, 36, 200], // amber-400
		getPixelOffset: [-18, 4],
		fontFamily: 'monospace',
		pickable: false
	});

	return [dotLayer, labelLayer, basedCountLayer, departingLayer, arrivingLayer];
}

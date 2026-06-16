import { ArcLayer, ScatterplotLayer, TextLayer } from '@deck.gl/layers';
import type { ArcRenderData, AirportInfo } from './types';
import { appState } from './state.svelte';

type RGBA = [number, number, number, number];

export const STATUS_COLORS: Record<string, RGBA> = {
	covered:   [34,  197,  94, 200],
	partial:   [249, 115,  22, 210],
	uncovered: [239,  68,  68, 255],
	deadhead:  [168,  85, 247, 170]
};

const STATUS_HEIGHT: Record<string, number> = {
	covered:   0.4,
	partial:   0.55,
	uncovered: 0.72,   // arc noticeably higher than covered on same route
	deadhead:  0.28
};

// Render order: covered bottom → partial → uncovered top.
// Separate ArcLayer per status so deck.gl never lets a green arc overwrite
// a red one at the same pixel when they share an origin hub like ORD.
const STATUS_ORDER = ['covered', 'partial', 'uncovered'] as const;

export function buildArcLayers(
	arcs: ArcRenderData[],
	deadheadArcs: ArcRenderData[],
	onHover: (info: { object?: ArcRenderData; x: number; y: number }) => void,
	onClick: (arc: ArcRenderData) => void
) {
	const selectedKey = appState.selectedRoute?.key;

	const visibilityFilter: Record<string, boolean> = {
		covered:   appState.showCovered,
		partial:   appState.showPartial,
		uncovered: appState.showUncovered
	};

	// Split arcs into per-status buckets
	const buckets: Record<string, ArcRenderData[]> = {
		covered: [], partial: [], uncovered: []
	};
	for (const arc of arcs) {
		if (visibilityFilter[arc.status] !== false) {
			buckets[arc.status]?.push(arc);
		}
	}

	const commonProps = (status: string) => ({
		getSourcePosition: (d: ArcRenderData) => d.sourcePosition,
		getTargetPosition: (d: ArcRenderData) => d.targetPosition,
		getSourceColor: (d: ArcRenderData) =>
			selectedKey && d.routeKey === selectedKey
				? ([255, 255, 255, 240] as RGBA)
				: (STATUS_COLORS[d.status] ?? STATUS_COLORS.covered),
		getTargetColor: (d: ArcRenderData) =>
			selectedKey && d.routeKey === selectedKey
				? ([255, 255, 255, 240] as RGBA)
				: (STATUS_COLORS[d.status] ?? STATUS_COLORS.covered),
		widthUnits: 'pixels' as const,
		getHeight: STATUS_HEIGHT[status] ?? 0.5,
		pickable: true,
		autoHighlight: true,
		highlightColor: [255, 255, 255, 60] as RGBA,
		onHover,
		onClick: (info: { object?: ArcRenderData }) => {
			if (info.object) onClick(info.object);
		},
		updateTriggers: {
			getSourceColor: [selectedKey],
			getTargetColor: [selectedKey]
		}
	});

	// Covered + partial: width scales with flight count (thicker = busier route)
	const coveredLayer = new ArcLayer<ArcRenderData>({
		id: 'flight-arcs-covered',
		data: buckets.covered,
		getWidth: (d) => Math.min(6, Math.max(1, Math.log2(d.count + 1) * 2)),
		...commonProps('covered')
	});

	const partialLayer = new ArcLayer<ArcRenderData>({
		id: 'flight-arcs-partial',
		data: buckets.partial,
		getWidth: (d) => Math.min(6, Math.max(2, Math.log2(d.count + 1) * 2)),
		...commonProps('partial')
	});

	// Uncovered: fixed 3px minimum so a single uncovered flight on a busy
	// route (e.g. ORD→IND with 10 covered + 1 uncovered) is never invisible.
	// Height 0.72 lifts it above the covered arc on the same origin→dest pair.
	const uncoveredLayer = new ArcLayer<ArcRenderData>({
		id: 'flight-arcs-uncovered',
		data: buckets.uncovered,
		getWidth: (_d) => 3,
		...commonProps('uncovered')
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

	// deadheads → covered → partial → uncovered (last = rendered on top)
	return [dhLayer, coveredLayer, partialLayer, uncoveredLayer].filter(Boolean);
}

export function buildAirportLayers(
	airports: Map<string, AirportInfo>,
	onAirportClick: (airport: AirportInfo) => void
) {
	const nodes = Array.from(airports.values());
	const selectedIata = appState.selectedAirport?.iata;
	const filterA = appState.filterAirportA;
	const filterB = appState.filterAirportB;

	const dotLayer = new ScatterplotLayer<AirportInfo>({
		id: 'airports',
		data: nodes,
		getPosition: (d) => d.coords,
		getFillColor: (d) => {
			// Filtered airports get a bright amber ring-fill so the active filter is obvious.
			if (d.iata === filterA || d.iata === filterB) return [251, 191, 36, 255] as RGBA;
			if (d.iata === selectedIata) return [255, 255, 255, 240] as RGBA;
			return d.basedCrew.length > 0 ? ([59, 130, 246, 220] as RGBA) : ([140, 140, 160, 180] as RGBA);
		},
		getRadius: (d) =>
			d.iata === filterA || d.iata === filterB
				? 9
				: Math.min(10, Math.max(4, Math.log2(d.basedCrew.length + 2) * 3.5)),
		radiusUnits: 'pixels',
		pickable: true,
		autoHighlight: true,
		highlightColor: [255, 255, 255, 80],
		onClick: (info) => {
			if (info.object) onAirportClick(info.object as AirportInfo);
		},
		updateTriggers: {
			getFillColor: [selectedIata, filterA, filterB],
			getRadius: [filterA, filterB]
		}
	});

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

	// ── Four-corner crew badge ─────────────────────────────────────────────────
	// Each airport marker shows up to four counts at its corners, all describing
	// crew currently ON THE GROUND at this airport:
	//   top-left     based     (blue)   – home base is this airport
	//   top-right    available (green)  – ready for duty
	//   bottom-left  visiting  (yellow) – on the ground here but based elsewhere
	//   bottom-right break     (red)    – unavailable (48h home / 14h duty break)
	// Left column splits by origin (home vs visiting); right column by status
	// (available vs break). Each column sums to the on-ground total.
	const CORNERS: Array<{
		key: string;
		color: RGBA;
		offset: [number, number];
		count: (d: AirportInfo) => number;
	}> = [
		{ key: 'based',     color: [96, 165, 250, 235], offset: [-15, -11],
		  count: (d) => d.crewOnGround.filter((c) => c.isHome).length },
		{ key: 'available', color: [74, 222, 128, 235], offset: [15, -11],
		  count: (d) => d.crewOnGround.filter((c) => c.available).length },
		{ key: 'visiting',  color: [251, 191, 36, 235], offset: [-15, 11],
		  count: (d) => d.crewOnGround.filter((c) => c.isVisiting).length },
		{ key: 'break',     color: [239, 68, 68, 245],  offset: [15, 11],
		  count: (d) => d.crewOnGround.filter((c) => !c.available).length }
	];

	const cornerLayers = CORNERS.map((cfg) =>
		new TextLayer<AirportInfo>({
			id: `airport-corner-${cfg.key}`,
			data: nodes.filter((d) => cfg.count(d) > 0),
			getPosition: (d) => d.coords,
			getText: (d) => String(cfg.count(d)),
			getSize: 11,
			getColor: cfg.color,
			getPixelOffset: cfg.offset,
			getTextAnchor: cfg.offset[0] < 0 ? 'end' : 'start',
			getAlignmentBaseline: cfg.offset[1] < 0 ? 'bottom' : 'top',
			fontFamily: 'monospace',
			fontWeight: 'bold',
			pickable: false
		})
	);

	return [dotLayer, labelLayer, ...cornerLayers];
}
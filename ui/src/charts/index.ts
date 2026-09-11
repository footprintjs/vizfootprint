export { VizScatter } from './VizScatter.js';
export type { VizScatterProps, ScatterDatum, RegressionGeom } from './VizScatter.js';
export { VizBar } from './VizBar.js';
export type { VizBarProps, BarDatum } from './VizBar.js';
export { VizLine, lineCompat } from './VizLine.js';
// a point on a run of dates or on a band of categories — the two arms of `LinePoint` (band versus run is the x column's)
export type { VizLineProps, LinePoint, DatedLinePoint, BandLinePoint } from './VizLine.js';
export { VizMap } from './VizMap.js';
export type { VizMapProps, RegionDatum, GeoFeature, GeoFeatureCollection, GeoGeometry, GeoRing } from './VizMap.js';
export { VizTable } from './VizTable.js';
export type { VizTableProps, TableRow, SortDirection, TableSortState } from './VizTable.js';
export { VizHistogram } from './VizHistogram.js';
export type { VizHistogramProps, HistogramBinDatum } from './VizHistogram.js';
export { VizHeatmap } from './VizHeatmap.js';
export type { VizHeatmapProps, HeatmapCellDatum } from './VizHeatmap.js';
export { VizBoxPlot } from './VizBoxPlot.js';
export type { VizBoxPlotProps, BoxPlotDatum } from './VizBoxPlot.js';
// THE FRAME (R6): several layers of marks over one margin box, one pair of
// scales and one guide. Exported with its geometry doors, because a host that
// composes its own stack aligns to the same boxes the frame does.
export { VizFrame, FRAME_PADS, CAPTION_ROOM, isFrameChartKind, framePad, framePlotBox, frameLayerBox } from './VizFrame.js';
export type { VizFrameProps, VizFrameLayer, FrameChartKind, FrameAxis, FrameLayerDraw, FramePad, FramePlotBox } from './VizFrame.js';
export { VizNetwork } from './VizNetwork.js';
export type { VizNetworkProps, NetworkNode, NetworkEdge, NetworkWalk } from './VizNetwork.js';
export { EncodingPicker } from './EncodingPicker.js';
export type { EncodingPickerProps } from './EncodingPicker.js';
// THE ONE binding law — "which field does this channel encode": the session's
// binding when it named one, the chart's own field prop otherwise. Exported so
// a host resolves it the same way the charts and the contract renderers do,
// instead of writing a fourth copy of `encoding[channel] ?? fallback`.
export { boundField } from './binding.js';
// ChartFrame / AxisLabel / scales / defaultCompat moved to the public
// primitives tier (../primitives) — re-exported from the package root there.

export { VizScatter } from './VizScatter.js';
export type { VizScatterProps, ScatterDatum, RegressionGeom } from './VizScatter.js';
export { VizBar } from './VizBar.js';
export type { VizBarProps, BarDatum } from './VizBar.js';
export { VizLine, lineCompat } from './VizLine.js';
export type { VizLineProps, LinePoint } from './VizLine.js';
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
export { EncodingPicker } from './EncodingPicker.js';
export type { EncodingPickerProps } from './EncodingPicker.js';
// THE ONE binding law — "which field does this channel encode": the session's
// binding when it named one, the chart's own field prop otherwise. Exported so
// a host resolves it the same way the charts and the contract renderers do,
// instead of writing a fourth copy of `encoding[channel] ?? fallback`.
export { boundField } from './binding.js';
// ChartFrame / AxisLabel / scales / defaultCompat moved to the public
// primitives tier (../primitives) — re-exported from the package root there.

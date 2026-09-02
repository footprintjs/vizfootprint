/**
 * vizfootprint-ui/editor — the in-place editor: a side drawer (never a modal)
 * and one chart's editable fields, each landing as a commit through the host.
 * Its own entry point, so an app that never edits a dashboard never bundles it.
 */
export { EditorDrawer } from './EditorDrawer.js';
export type { EditorDrawerProps } from './EditorDrawer.js';
export { ChartEditor, EDITOR_SLOTS, editedRecord } from './ChartEditor.js';
export type { ChartEditorProps } from './ChartEditor.js';

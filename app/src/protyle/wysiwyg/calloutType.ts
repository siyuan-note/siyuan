export interface ICalloutPreset {
    id: string;
    icon: string;
    type: string;
    title: string;
    color: string;
}

export const CALLOUT_PRESETS: ICalloutPreset[] = [{
    id: "calloutNote",
    icon: "✏️",
    type: "NOTE",
    title: "Note",
    color: "var(--b3-callout-note)",
}, {
    id: "calloutTip",
    icon: "💡",
    type: "TIP",
    title: "Tip",
    color: "var(--b3-callout-tip)",
}, {
    id: "calloutImportant",
    icon: "❗",
    type: "IMPORTANT",
    title: "Important",
    color: "var(--b3-callout-important)",
}, {
    id: "calloutWarning",
    icon: "⚠️",
    type: "WARNING",
    title: "Warning",
    color: "var(--b3-callout-warning)",
}, {
    id: "calloutCaution",
    icon: "🚨",
    type: "CAUTION",
    title: "Caution",
    color: "var(--b3-callout-caution)",
}];

export const MERMAID_LAYOUT_ATTR = "custom-mermaid-layout";

export type TMermaidLayout = "dagre" | "cose-bilkent" | "tidy-tree";

const MERMAID_LAYOUTS = new Set<TMermaidLayout>([
    "dagre",
    "cose-bilkent",
    "tidy-tree",
]);

export const getMermaidLayout = (value?: string | null): TMermaidLayout | undefined => {
    const layout = value?.trim().toLowerCase() as TMermaidLayout;
    return MERMAID_LAYOUTS.has(layout) ? layout : undefined;
};

export const applyMermaidLayout = (content: string, layout?: TMermaidLayout) => {
    if (!layout) {
        return content;
    }
    const separator = content.endsWith("\n") ? "" : "\n";
    return `${content}${separator}%%{init: ${JSON.stringify({layout})}}%%`;
};

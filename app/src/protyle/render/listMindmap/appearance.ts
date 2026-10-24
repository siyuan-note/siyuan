import type {ListMindmapMetadata, ListMindmapModel, ListMindmapNodeStyle} from "./model";

export interface ListMindmapAppearance {
    version: 1;
    palette: string[];
    rootColor?: string;
    nodeStyle?: "layered";
    backgroundColor?: string;
}

export const LIST_MINDMAP_PALETTES: {id: string, label: string, rootColor: string, colors: string[], previousColors?: string[][]}[] = [
    {id: "colorful", label: "listMindmapPaletteColorful", rootColor: "#1e293b", colors: ["#2563eb", "#dc2626", "#15803d", "#9333ea", "#c2410c", "#0e7490"]},
    {id: "soft", label: "listMindmapPaletteSoft", rootColor: "#64748b", colors: ["#bfdbfe", "#fecaca", "#bbf7d0", "#e9d5ff", "#fed7aa", "#a5f3fc"]},
    {id: "forest", label: "listMindmapPaletteForest", rootColor: "#14532d", colors: ["#166534", "#047857", "#4d7c0f", "#0f766e", "#3f6212", "#15803d"]},
    {id: "ocean", label: "listMindmapPaletteOcean", rootColor: "#082f49", colors: ["#0c4a6e", "#0369a1", "#0277b4", "#087e9b", "#087f75", "#0f766e"],
        previousColors: [["#0c4a6e", "#0369a1", "#0284c7", "#0891b2", "#0d9488", "#0f766e"]]},
    {id: "sunset", label: "listMindmapPaletteSunset", rootColor: "#7c2d12", colors: ["#9a3412", "#c2410c", "#c94c0d", "#be123c", "#9f1239", "#7e22ce"],
        previousColors: [["#9a3412", "#c2410c", "#ea580c", "#be123c", "#9f1239", "#7e22ce"]]},
    {id: "lavender", label: "listMindmapPaletteLavender", rootColor: "#3b0764", colors: ["#4c1d95", "#6d28d9", "#7c3aed", "#9842db", "#c084fc", "#e9d5ff"],
        previousColors: [["#4c1d95", "#6d28d9", "#7c3aed", "#a855f7", "#c084fc", "#e9d5ff"]]},
    {id: "monochrome", label: "listMindmapPaletteMonochrome", rootColor: "#111827", colors: ["#1f2937", "#374151", "#4b5563", "#6b7280", "#9ca3af", "#d1d5db"]},
];

export const isMindmapColor = (value: unknown): value is string =>
    typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value);

export const isListMindmapAppearance = (value: unknown): value is ListMindmapAppearance => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return false;
    }
    const data = value as Record<string, unknown>;
    return data.version === 1 && Array.isArray(data.palette) && data.palette.length <= 24 &&
        data.palette.every(isMindmapColor) &&
        (data.rootColor === undefined || isMindmapColor(data.rootColor)) &&
        (data.nodeStyle === undefined || data.nodeStyle === "layered") &&
        (data.backgroundColor === undefined || data.backgroundColor === "" || isMindmapColor(data.backgroundColor));
};

// 只为新增的一级分支分配色位；已有色位随节点保存，重排、复制和切换色卡不会重置。
export const assignListMindmapBranchColors = (model: ListMindmapModel) => {
    if (!model.metadata.appearance?.palette.length) {
        return false;
    }
    const used = new Set(model.root.children.map(node => model.metadata.nodes[node.id]?.branchColor)
        .filter(value => value !== undefined));
    let changed = false;
    let slot = 0;
    for (const node of model.root.children) {
        if (model.metadata.nodes[node.id]?.branchColor !== undefined) {
            continue;
        }
        while (used.has(slot)) {
            slot++;
        }
        model.metadata.nodes[node.id] = {...model.metadata.nodes[node.id], branchColor: slot};
        used.add(slot++);
        changed = true;
    }
    return changed;
};

const getMindmapLuminance = (color: string) => {
    const values = [1, 3, 5].map(index => {
        const value = parseInt(color.slice(index, index + 2), 16) / 255;
        return value <= .04045 ? value / 12.92 : Math.pow((value + .055) / 1.055, 2.4);
    });
    return values[0] * .2126 + values[1] * .7152 + values[2] * .0722;
};

// 文字颜色按实际填充色的相对亮度选择，浅色与深色画布使用同一份文档配色。
export const getMindmapTextColor = (color: string) =>
    getMindmapLuminance(color) > .179 ? "#000000" : "#ffffff";

const getMindmapHexColor = (color: string) => {
    if (/^#[0-9a-f]{6}$/i.test(color)) {
        return color;
    }
    const rgb = color.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*1)?\)$/);
    return rgb ? "#" + rgb.slice(1).map(value => Number(value).toString(16).padStart(2, "0")).join("") : undefined;
};

const mixMindmapColor = (color: string, background: string, ratio: number) => "#" + [1, 3, 5].map(index =>
    Math.round(parseInt(color.slice(index, index + 2), 16) * ratio +
        parseInt(background.slice(index, index + 2), 16) * (1 - ratio)).toString(16).padStart(2, "0")).join("");

const getMindmapContrastColor = (color: string, background: string, minimum: number) => {
    background = getMindmapHexColor(background);
    if (!background) {
        return color;
    }
    const luminance = getMindmapLuminance(background);
    const contrast = (value: string) => {
        const line = getMindmapLuminance(value);
        return (Math.max(line, luminance) + .05) / (Math.min(line, luminance) + .05);
    };
    if (contrast(color) >= minimum) {
        return color;
    }
    const target = luminance > .179 ? 0 : 255;
    const channels = [1, 3, 5].map(index => parseInt(color.slice(index, index + 2), 16));
    for (let step = 1; step <= 100; step++) {
        const adjusted = "#" + channels.map(value => Math.round(value + (target - value) * step / 100)
            .toString(16).padStart(2, "0")).join("");
        if (contrast(adjusted) >= minimum) {
            return adjusted;
        }
    }
    return color;
};

// 只调整主题连线的显示色，避免浅色线融入浅色画布、深色线融入深色画布。
export const getMindmapLineColor = (color: string, background: string) => getMindmapContrastColor(color, background, 3);

export const resolveListMindmapColors = (model: ListMindmapModel, canvasColor?: string) => {
    const result = new Map<string, ListMindmapNodeStyle>();
    const palette = model.metadata.appearance?.palette;
    if (!palette?.length) {
        return result;
    }
    // 缺少独立根节点色的导图沿用色卡首色，读取时不改写已有外观。
    const appearance = model.metadata.appearance;
    const background = getMindmapHexColor(appearance.backgroundColor || canvasColor || "#ffffff") || "#ffffff";
    const foreground = getMindmapContrastColor(getMindmapLuminance(background) > .179 ? "#334155" : "#e2e8f0", background, 4.5);
    const pending = [{node: model.root, color: appearance.rootColor || palette[0], level: 0}];
    while (pending.length) {
        const {node, color, level} = pending.pop();
        if (appearance.nodeStyle === "layered") {
            result.set(node.id, {backgroundColor: "transparent",
                textColor: foreground, fontSize: level === 0 ? 20 : level === 1 ? 16 : 14, bold: level < 2,
                lineColor: node === model.root ? color : mixMindmapColor(color, background, .65),
                lineWidth: level === 0 ? 2.25 : level === 1 ? 1.75 : 1.25});
        } else {
            result.set(node.id, {backgroundColor: color, textColor: getMindmapTextColor(color), lineColor: color});
        }
        node.children.forEach((child, index) => pending.push({node: child, color: node === model.root ?
            palette[(model.metadata.nodes[child.id]?.branchColor ?? index) % palette.length] : color, level: level + 1}));
    }
    return result;
};

export const clearListMindmapManualColors = (metadata: ListMindmapMetadata) => {
    Object.values(metadata.nodes).forEach(style => {
        delete style.textColor;
        delete style.backgroundColor;
        delete style.lineColor;
    });
    metadata.relations.forEach(relation => delete relation.color);
    metadata.summaries?.forEach(summary => delete summary.color);
};

export const getListMindmapAppearanceMenu = (metadata: ListMindmapMetadata,
                                            change: (update: (data: ListMindmapMetadata) => void) => void,
                                            labels: Record<string, string>, connector: IMenu): IMenu => {
    const palette = metadata.appearance?.palette || [];
    const background = metadata.appearance?.backgroundColor || "";
    return {
        id: "appearance", icon: "iconTheme", label: labels.appearance,
        submenu: [
            {id: "theme", iconHTML: "", label: labels.theme, submenu: [
                {id: "default", iconHTML: "", label: labels.default, checked: !palette.length,
                    click: () => change(data => {
                        data.appearance = {...data.appearance, version: 1, palette: []};
                        delete data.appearance.rootColor;
                        delete data.appearance.nodeStyle;
                    })},
                ...LIST_MINDMAP_PALETTES.map(preset => ({
                    id: preset.id, iconHTML: `<span class="b3-menu__icon b3-menu__icon--color" style="background-color:${preset.colors[0]}"></span>`,
                    label: labels[preset.label],
                    checked: (metadata.appearance?.rootColor === undefined || metadata.appearance.rootColor === preset.rootColor) &&
                        [preset.colors, ...preset.previousColors || []]
                        .some(colors => JSON.stringify(palette) === JSON.stringify(colors)),
                    click: () => change(data => {
                        data.appearance = {...data.appearance, version: 1, palette: [...preset.colors],
                            rootColor: preset.rootColor, nodeStyle: "layered"};
                    }),
                })),
            ]},
            {id: "canvasBackground", iconHTML: "", label: labels.listMindmapCanvasBackground, submenu: [
                {id: "default", color: "", label: labels.default},
                {id: "light", color: "#ffffff", label: labels.themeLight},
                {id: "dark", color: "#1e1e1e", label: labels.themeDark},
                ...LIST_MINDMAP_PALETTES[1].colors.map(color => ({id: color, color, label: color})),
            ].map(item => ({id: item.id,
                iconHTML: item.color ? `<span class="b3-menu__icon b3-menu__icon--color" style="background-color:${item.color}"></span>` : "",
                label: item.label, checked: background === item.color,
                click: () => change(data => {
                    data.appearance = {...data.appearance, version: 1, palette: data.appearance?.palette || [],
                        backgroundColor: item.color};
                })}))},
            connector,
            {id: "clearManualColors", iconHTML: "", label: labels.listMindmapClearManualColors,
                click: () => change(clearListMindmapManualColors)},
        ],
    };
};

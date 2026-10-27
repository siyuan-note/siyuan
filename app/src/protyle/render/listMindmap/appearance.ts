import type {ListMindmapMetadata, ListMindmapModel, ListMindmapNodeStyle} from "./model";

export interface ListMindmapAppearance {
    version: 1;
    palette: string[];
    rootColor?: string;
    nodeStyle?: "layered" | "branch";
    backgroundColor?: string;
}

export const LIST_MINDMAP_PALETTES: {id: string, label: string, rootColor: string, colors: string[]}[] = [
    {id: "waves", label: "listMindmapPaletteWaves", rootColor: "#849695",
        colors: ["#20b18b", "#2b84d2", "#2791b1", "#e76726", "#fda009", "#d35983", "#415e82", "#e3555e", "#a282a9"]},
    {id: "dream", label: "listMindmapPaletteDream", rootColor: "#43b2b4",
        colors: ["#d793c9", "#5faeee", "#da7863", "#6cb27a", "#fec245", "#3e9dc5", "#e470a4", "#95bb3c", "#ceb082"]},
    {id: "angel", label: "listMindmapPaletteAngel", rootColor: "#4c6aff",
        colors: ["#4b87ff", "#bf66a0", "#e84e42", "#585ea8", "#f49f16", "#3e9dc5", "#15a343", "#ed6e7e", "#42bdae"]},
    {id: "reflection", label: "listMindmapPaletteReflection", rootColor: "#d36867",
        colors: ["#739caf", "#30415d", "#b9a286", "#e44559", "#9b5d6e", "#4a4d6b", "#828081", "#cfab72", "#74333f"]},
    {id: "prosperity", label: "listMindmapPaletteProsperity", rootColor: "#ef4a6e",
        colors: ["#49b3f1", "#2ebab7", "#4997c5", "#e68239", "#94c850", "#7e77d5", "#e99a82", "#b992bc", "#6ec370"]},
    {id: "polish", label: "listMindmapPalettePolish", rootColor: "#2684e7",
        colors: ["#fc5d62", "#4fa7ed", "#fec444", "#eb8dd4", "#5cbede", "#70c85d", "#f66f45", "#9871e1", "#4ccdcb"]},
    {id: "peace", label: "listMindmapPalettePeace", rootColor: "#65b3f0",
        colors: ["#eac6a4", "#58d1bb", "#9edfc3", "#a7b6e7", "#f3a9a9", "#53b172", "#76b523", "#a5c93b", "#b5ad99"]},
    {id: "reality", label: "listMindmapPaletteReality", rootColor: "#b7a19d",
        colors: ["#f26a6e", "#4fa7ed", "#fec444", "#d38ec4", "#906cd5", "#87b21d", "#8eadbb", "#43b2b4", "#da5f46"]},
    {id: "dulcet", label: "listMindmapPaletteDulcet", rootColor: "#5dd986",
        colors: ["#30c7e0", "#f171bc", "#906cd3", "#1ecdbb", "#e19a75", "#8ac52f", "#eca034", "#f3657e", "#4fa5ec"]},
    {id: "opulent", label: "listMindmapPaletteOpulent", rootColor: "#c21e58",
        colors: ["#0e74c6", "#2e2a95", "#16a32f", "#fb5609", "#b60071", "#82cf07", "#5a0f75", "#c3002d", "#fd9329"]},
    {id: "hope", label: "listMindmapPaletteHope", rootColor: "#2c84d2",
        colors: ["#405e80", "#f05272", "#2992b2", "#bf66a0", "#efb740", "#997cc3", "#436eb6", "#15a18b", "#68a30d"]},
    {id: "blossom", label: "listMindmapPaletteBlossom", rootColor: "#ee5b74",
        colors: ["#f26288", "#ea6496", "#dc67ad", "#d469bc", "#cd6aca", "#c36cdc", "#c571eb", "#bf71f5", "#b971fe"]},
    {id: "grace", label: "listMindmapPaletteGrace", rootColor: "#c0a9a4",
        colors: ["#fdcd78", "#b4ad98", "#e6a5cf", "#68c2a4", "#84cad4", "#c89bd4", "#76a2e6", "#f7a564", "#4da7d3"]},
    {id: "passion", label: "listMindmapPalettePassion", rootColor: "#1b0f98",
        colors: ["#f90007", "#670069", "#000073", "#b94e22", "#107006", "#147e78", "#fb5609", "#d24074", "#658921"]},
    {id: "tranquil", label: "listMindmapPaletteTranquil", rootColor: "#6f7b8e",
        colors: ["#d9a0bf", "#9abc3e", "#eac452", "#b3a18c", "#e98d73", "#56bb8f", "#2ca6dd", "#89a252", "#e48d94"]},
    {id: "flow", label: "listMindmapPaletteFlow", rootColor: "#2787d6",
        colors: ["#2991dd", "#2ca6dd", "#2eb2de", "#2fc2e0", "#30c7e0", "#32d5e1", "#33daca", "#34e1bc", "#49edc2"]},
    {id: "ombre", label: "listMindmapPaletteOmbre", rootColor: "#0a538c",
        colors: ["#0b5a9b", "#0c61a7", "#0d68b4", "#0e72c4", "#0f7acc", "#1083d5", "#1187dc", "#1295e9", "#139bf5"]},
    {id: "quebrada", label: "listMindmapPaletteQuebrada", rootColor: "#0a4a4a",
        colors: ["#107179", "#5aa89e", "#74b5b1", "#397069", "#468681", "#779f93", "#67887b", "#92a39b", "#c5dcd4"]},
    {id: "mundane", label: "listMindmapPaletteMundane", rootColor: "#66814f",
        colors: ["#7ad3a9", "#77a3ba", "#627478", "#8ec011", "#a14834", "#b41222", "#5649a0", "#23ca95", "#ed906f"]},
    {id: "vintage", label: "listMindmapPaletteVintage", rootColor: "#2691b0",
        colors: ["#2a4775", "#20b18b", "#6baae0", "#2fb7b6", "#997cc3", "#90b7af", "#f59294", "#aa8268", "#306973"]},
    {id: "melody", label: "listMindmapPaletteMelody", rootColor: "#fc8e69",
        colors: ["#65b3f0", "#998690", "#bd84b1", "#54836b", "#c5a283", "#f9f1e5", "#9edfc3", "#287878", "#102939"]},
    {id: "affinity", label: "listMindmapPaletteAffinity", rootColor: "#194e75",
        colors: ["#ef4b6f", "#289896", "#fdb409", "#e97a77", "#2791b1", "#5171b9", "#d07938", "#dd458c", "#8c72b1"]},
    {id: "fragrance", label: "listMindmapPaletteFragrance", rootColor: "#d84e99",
        colors: ["#906cd5", "#f26a6e", "#d38ec4", "#fddbeb", "#fcc0dd", "#fed79d", "#f2b0ae", "#df3c52", "#6d2b71"]},
    {id: "tide", label: "listMindmapPaletteTide", rootColor: "#ce5780",
        colors: ["#1495f6", "#20b18b", "#fecb9a", "#94c750", "#da5f46", "#998690", "#49a5c5", "#fec444", "#74333f"]},
    {id: "elemental", label: "listMindmapPaletteElemental", rootColor: "#b4dc18",
        colors: ["#87e43e", "#43b3e0", "#dc5d40", "#3f67e0", "#de3670", "#9d2de0", "#693cec", "#f99a47", "#e469c5"]},
    {id: "aspect", label: "listMindmapPaletteAspect", rootColor: "#86c2d6",
        colors: ["#bb44c5", "#304c9e", "#f33f47", "#2aadc4", "#5d7f31", "#116749", "#3074ff", "#557d93", "#3baf6a"]},
    {id: "distinct", label: "listMindmapPaletteDistinct", rootColor: "#20b18b",
        colors: ["#88b31d", "#ea6f08", "#3295ec", "#fec245", "#df2a4f", "#159e96", "#997cc3", "#cab09c", "#17444e"]},
    {id: "violet", label: "listMindmapPaletteViolet", rootColor: "#122439",
        colors: ["#353b63", "#514682", "#6a4480", "#a17882", "#e39893", "#b0aab3", "#8c93ae", "#8aa3c2", "#d2eaf5"]},
    {id: "flushed", label: "listMindmapPaletteFlushed", rootColor: "#5d535c",
        colors: ["#a08c8d", "#4a2136", "#e12c35", "#645151", "#ea797d", "#783c51", "#79798c", "#474656", "#ec9e0f"]},
    {id: "lucid", label: "listMindmapPaletteLucid", rootColor: "#0f213f",
        colors: ["#37c1d8", "#e16f81", "#204f8e", "#6776c5", "#1ba6bc", "#35477d", "#427ebc", "#e93752", "#797574"]},
    {id: "balmy", label: "listMindmapPaletteBalmy", rootColor: "#ec4946",
        colors: ["#333e46", "#fc612f", "#657a79", "#8e6465", "#fb9d40", "#52798f", "#3c2829", "#d2384e", "#727376"]},
    {id: "fashion", label: "listMindmapPaletteFashion", rootColor: "#021939",
        colors: ["#d5575b", "#124d60", "#39aa9d", "#29a9a0", "#2aa098", "#ed8641", "#156579", "#76a799", "#399a83"]},
    {id: "halcyon", label: "listMindmapPaletteHalcyon", rootColor: "#0d193f",
        colors: ["#469cd8", "#344690", "#ca87af", "#6b84a5", "#6886bd", "#5e869b", "#3354aa", "#8a6b8a", "#beab88"]},
    {id: "jolly", label: "listMindmapPaletteJolly", rootColor: "#448eec",
        colors: ["#132666", "#35a9c8", "#e47989", "#31bcb3", "#d7487b", "#175ba9", "#fbac28", "#4368cb", "#2798d8"]},
    {id: "candy", label: "listMindmapPaletteCandy", rootColor: "#1c304a",
        colors: ["#343479", "#fc6465", "#3baf6a", "#b57bda", "#2aa098", "#df3c52", "#e9b13a", "#3c91de", "#ec774b"]},
    {id: "vitality", label: "listMindmapPaletteVitality", rootColor: "#f5302d",
        colors: ["#336ff0", "#f9b30b", "#2d9f41", "#3321ff", "#e4000a", "#5b39e0", "#dd0084", "#1b99ff", "#fc6208"]},
    {id: "subtropic", label: "listMindmapPaletteSubtropic", rootColor: "#1f8742",
        colors: ["#eebf3c", "#ed863a", "#e33f46", "#2568e8", "#8733d8", "#25a24e", "#2689d2", "#bb49e8", "#20d0ce"]},
    {id: "veil", label: "listMindmapPaletteVeil", rootColor: "#c23ba6",
        colors: ["#38b2da", "#ed4d4b", "#39c070", "#f5b549", "#ea2d59", "#2a3d94", "#f57239", "#6c54f2", "#2fa97c"]},
    {id: "polychrome", label: "listMindmapPalettePolychrome", rootColor: "#2e5abc",
        colors: ["#fc6056", "#3976f2", "#55d6c8", "#f1bc48", "#ef3840", "#8ec033", "#7a43e3", "#4cc8ec", "#e93d89"]},
    {id: "cyber", label: "listMindmapPaletteCyber", rootColor: "#4282f5",
        colors: ["#7842e0", "#abe154", "#379a4b", "#5dd9ba", "#333de0", "#7849f8", "#41de9a", "#3aac84", "#5ab743"]},
    {id: "persimmon", label: "listMindmapPalettePersimmon", rootColor: "#f64839",
        colors: ["#eb8340", "#ebc240", "#1d653b", "#61bb3a", "#78d043", "#cae445", "#329aa4", "#5dbfab", "#5de0c1"]},
    {id: "vineyard", label: "listMindmapPaletteVineyard", rootColor: "#6727f8",
        colors: ["#9adc33", "#2fa97c", "#ebb930", "#fc4e7f", "#589cff", "#eb5f51", "#4cd0bf", "#7a47f2", "#45deec"]},
    {id: "lilac", label: "listMindmapPaletteLilac", rootColor: "#1d2455",
        colors: ["#4864f6", "#38a584", "#36c6c6", "#fc464d", "#ebc537", "#f07039", "#38cd30", "#ec4eb4", "#f07040"]},
    {id: "animated", label: "listMindmapPaletteAnimated", rootColor: "#fdb311",
        colors: ["#66ab8f", "#7080ff", "#b067ff", "#70c81d", "#fd7f67", "#fc477f", "#fc600f", "#fc6dff", "#82ab87"]},
    {id: "rainbow", label: "listMindmapPaletteRainbow", rootColor: "#433efc",
        colors: ["#b344e2", "#3a8bf5", "#3ead6a", "#f28715", "#ec5146", "#ec4089", "#e9353d", "#5500eb", "#1ab481"]},
    {id: "newstyle", label: "listMindmapPaletteNewStyle", rootColor: "#fc2591",
        colors: ["#f32424", "#f3a61e", "#25a63b", "#1744ff", "#aa19fd", "#fc571e", "#6ba733", "#15abff", "#6000e2"]},
    {id: "mixed", label: "listMindmapPaletteMixed", rootColor: "#15a343",
        colors: ["#5100dc", "#33daca", "#0a5aff", "#fdb311", "#fc1c17", "#fc364f", "#f44f1f", "#2d39f5", "#67deff"]},
];

export const LIST_MINDMAP_CANVAS_COLORS = ["#bfdbfe", "#fecaca", "#bbf7d0", "#e9d5ff", "#fed7aa", "#a5f3fc"];

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
        (data.nodeStyle === undefined || data.nodeStyle === "layered" || data.nodeStyle === "branch") &&
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
        if (appearance.nodeStyle === "branch") {
            result.set(node.id, {backgroundColor: level < 2 ? color : "transparent",
                textColor: getMindmapTextColor(level < 2 ? color : background), lineColor: color,
                fontSize: level === 0 ? 20 : level === 1 ? 16 : 14, bold: level < 2, lineWidth: 1.5});
        } else if (appearance.nodeStyle === "layered") {
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
                                            labels: Record<string, string>, connector: IMenu,
                                            preview?: (update?: (data: ListMindmapMetadata) => void) => void): IMenu => {
    const palette = metadata.appearance?.palette || [];
    const background = metadata.appearance?.backgroundColor || "";
    const themeItem = (item: IMenu, update: (data: ListMindmapMetadata) => void): IMenu => ({...item,
        click: () => change(update),
        bind: preview ? element => {
            element.addEventListener("pointerenter", (event: PointerEvent) => {
                if (event.pointerType === "mouse") {
                    preview(update);
                }
            });
            element.addEventListener("pointerleave", () => preview());
        } : undefined,
    });
    return {
        id: "appearance", icon: "iconTheme", label: labels.appearance,
        submenu: [
            {id: "theme", iconHTML: "", label: labels.theme,
                bind: element => {
                    element.classList.add("mindmap-view__theme-menu");
                    element.style.setProperty("--b3-menu-items-max-height", "min(480px, 60vh)");
                },
                submenu: [
                    themeItem({id: "default", iconHTML: '<span class="b3-menu__icon mindmap-view__theme-preview" aria-hidden="true"></span>',
                        label: labels.default, checked: !palette.length}, data => {
                            data.appearance = {...data.appearance, version: 1, palette: []};
                            delete data.appearance.rootColor;
                            delete data.appearance.nodeStyle;
                        }),
                    ...LIST_MINDMAP_PALETTES.map(preset => {
                        const colors = [preset.rootColor, ...preset.colors.filter((_color, index) => index % 2 === 0)];
                        const gradient = colors.map((color, index) =>
                            `${color} ${index * 100 / colors.length}% ${(index + 1) * 100 / colors.length}%`).join(",");
                        return themeItem({
                            id: preset.id,
                            iconHTML: `<span class="b3-menu__icon b3-menu__icon--color mindmap-view__theme-preview" aria-hidden="true" style="background:linear-gradient(90deg,${gradient})"></span>`,
                            label: labels[preset.label],
                            checked: metadata.appearance?.nodeStyle === "branch" &&
                                metadata.appearance.rootColor === preset.rootColor &&
                                JSON.stringify(palette) === JSON.stringify(preset.colors)}, data => {
                                data.appearance = {...data.appearance, version: 1, palette: [...preset.colors],
                                    rootColor: preset.rootColor, nodeStyle: "branch"};
                            });
                    }),
                ]},
            {id: "canvasBackground", iconHTML: "", label: labels.listMindmapCanvasBackground, submenu: [
                {id: "default", color: "", label: labels.default},
                {id: "light", color: "#ffffff", label: labels.themeLight},
                {id: "dark", color: "#1e1e1e", label: labels.themeDark},
                ...LIST_MINDMAP_CANVAS_COLORS.map(color => ({id: color, color, label: color})),
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

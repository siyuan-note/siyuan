import {bindThemeColorEditor, getThemeColorEditorHTML} from "../../dialog/themeColorEditor";
import {escapeAttr, escapeHtml} from "../../util/escape";
import {
    getBuiltinColorPropertyValue,
    getBuiltinColorVariableName,
    getBuiltinInlineColor,
    getBuiltinInlineStyle,
    getBuiltinInlineStylePropertyValue,
    getCurrentInlineStyleMode,
    IInlineStyleColors,
    IInlineStyles,
    TBuiltinColorType,
    TBuiltinInlineStyleID,
    TInlineStyleProperty,
} from "./inlineStyle";

export interface IBuiltinColorDialogEntry {
    key: number | TBuiltinInlineStyleID;
    label: string;
    show: boolean;
    override: Record<TInlineStyleProperty, boolean>;
    value: { light: IInlineStyleColors, dark: IInlineStyleColors };
    fallback: { light: IInlineStyleColors, dark: IInlineStyleColors };
}

const cloneThemeValue = (value: { light: IInlineStyleColors, dark: IInlineStyleColors }) =>
    JSON.parse(JSON.stringify(value)) as { light: IInlineStyleColors, dark: IInlineStyleColors };

const getTypeLabel = (type: TBuiltinColorType) => {
    if (type === "color") {
        return window.siyuan.languages.colorFont;
    }
    if (type === "backgroundColor") {
        return window.siyuan.languages.colorPrimary;
    }
    return window.siyuan.languages.color;
};

export const getProperties = (type: TBuiltinColorType): TInlineStyleProperty[] => {
    if (type === "color") {
        return ["color"];
    }
    if (type === "backgroundColor") {
        return ["backgroundColor"];
    }
    return ["color", "backgroundColor"];
};

const getEntryLabel = (type: TBuiltinColorType, key: number | TBuiltinInlineStyleID) => {
    if (type === "style1") {
        return window.siyuan.languages[`${key}Style`];
    }
    return `${getTypeLabel(type)} ${key}`;
};

const colorCanvas = document.createElement("canvas");
colorCanvas.width = 1;
colorCanvas.height = 1;
const colorContext = colorCanvas.getContext("2d", {willReadFrequently: true});

const colorToHex = (value: string, fallback: string) => {
    const normalized = value.trim();
    if (/^#[0-9a-f]{6}$/i.test(normalized)) {
        return normalized.toLowerCase();
    }
    const match = normalized.match(/^rgba?\(\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)/i);
    if (match) {
        return `#${match.slice(1, 4).map(item => Math.max(0, Math.min(255, Math.round(Number(item))))
            .toString(16).padStart(2, "0")).join("")}`;
    }
    if (!colorContext || !CSS.supports("color", normalized)) {
        return fallback;
    }
    colorContext.clearRect(0, 0, 1, 1);
    colorContext.fillStyle = normalized;
    colorContext.fillRect(0, 0, 1, 1);
    const color = colorContext.getImageData(0, 0, 1, 1).data;
    return `#${Array.from(color.slice(0, 3)).map(item => item.toString(16).padStart(2, "0")).join("")}`;
};

const withThemeDefaults = <T>(fn: () => T) => {
    const siyuanStyle = document.getElementById("siyuanStyle") as HTMLStyleElement;
    const disabled = siyuanStyle?.disabled;
    if (siyuanStyle) {
        siyuanStyle.disabled = true;
    }
    try {
        return fn();
    } finally {
        if (siyuanStyle) {
            siyuanStyle.disabled = disabled;
        }
    }
};

const themeVariableValue = (name: string) =>
    withThemeDefaults(() => getComputedStyle(document.documentElement).getPropertyValue(name).trim());

const resolveThemeColor = (value: string, fallback: string) => withThemeDefaults(() => {
    const element = document.createElement("span");
    element.style.color = value;
    element.style.position = "fixed";
    element.style.visibility = "hidden";
    document.body.append(element);
    const color = colorToHex(getComputedStyle(element).color, fallback);
    element.remove();
    return color;
});

const getFallbackValue = (type: TBuiltinColorType, key: number | TBuiltinInlineStyleID) => {
    const getValue = (property: TInlineStyleProperty) => type === "style1" ?
        getBuiltinInlineStylePropertyValue(key as TBuiltinInlineStyleID, property) :
        getBuiltinColorPropertyValue(key as number, property);
    const resolve = (property: TInlineStyleProperty, lightFallback: string, darkFallback: string) => {
        if (typeof key === "number" && !themeVariableValue(getBuiltinColorVariableName(key, property))) {
            return {light: lightFallback, dark: darkFallback};
        }
        const cssValue = getValue(property);
        return {
            light: resolveThemeColor(cssValue, lightFallback),
            dark: resolveThemeColor(cssValue, darkFallback),
        };
    };
    const color = resolve("color", "#000000", "#ffffff");
    const backgroundColor = resolve("backgroundColor", "#ffffff", "#000000");
    return {
        light: {
            color: color.light,
            backgroundColor: backgroundColor.light,
        },
        dark: {
            color: color.dark,
            backgroundColor: backgroundColor.dark,
        },
    };
};

export const getEditorType = (type: TBuiltinColorType) => type === "av" ? "style1" : type;

const hasStoredOverride = (value: { light?: IInlineStyleColors, dark?: IInlineStyleColors } | undefined,
                           property: TInlineStyleProperty) =>
    !!value?.light?.[property] && !!value?.dark?.[property];

export const isEntryCustomized = (entry: IBuiltinColorDialogEntry, properties: TInlineStyleProperty[]) =>
    properties.some(property => entry.override[property]);

export const isEntryDefault = (entry: IBuiltinColorDialogEntry, properties: TInlineStyleProperty[]) =>
    entry.show && !isEntryCustomized(entry, properties);

const getPreviewValue = (type: TBuiltinColorType, entry: IBuiltinColorDialogEntry, property: TInlineStyleProperty) => {
    if (entry.override[property]) {
        return entry.value[getCurrentInlineStyleMode()][property] || "";
    }
    if (typeof entry.key === "number") {
        return getBuiltinColorPropertyValue(entry.key, property);
    }
    return getBuiltinInlineStylePropertyValue(entry.key, property);
};

export const applyPreviewStyle = (type: TBuiltinColorType, element: HTMLElement, entry: IBuiltinColorDialogEntry) => {
    element.style.color = type === "backgroundColor" ? "" : getPreviewValue(type, entry, "color");
    element.style.backgroundColor = type === "color" ? "" : getPreviewValue(type, entry, "backgroundColor");
    element.textContent = type === "backgroundColor" ? "" : "A";
};

const setProperty = (target: { light: IInlineStyleColors, dark: IInlineStyleColors },
                     source: { light: IInlineStyleColors, dark: IInlineStyleColors },
                     property: TInlineStyleProperty, enabled: boolean) => {
    if (enabled) {
        target.light[property] = source.light[property];
        target.dark[property] = source.dark[property];
    } else {
        delete target.light[property];
        delete target.dark[property];
    }
};

const hasColors = (value: { light: IInlineStyleColors }) =>
    !!value.light.color || !!value.light.backgroundColor;

export const resetEntry = (entry: IBuiltinColorDialogEntry, properties: TInlineStyleProperty[]) => {
    entry.show = true;
    properties.forEach(property => {
        entry.override[property] = false;
    });
    entry.value = cloneThemeValue(entry.fallback);
};

export const createBuiltinDialogEntry = (type: TBuiltinColorType, key: number | TBuiltinInlineStyleID,
                                         data: IInlineStyles): IBuiltinColorDialogEntry => {
    const stored = type === "style1" ?
        getBuiltinInlineStyle(key as TBuiltinInlineStyleID, data) :
        getBuiltinInlineColor(key as number, data);
    const fallback = getFallbackValue(type, key);
    return {
        key,
        label: getEntryLabel(type, key),
        show: !data.builtin.hidden[type].includes(key as never),
        override: {
            color: hasStoredOverride(stored, "color"),
            backgroundColor: hasStoredOverride(stored, "backgroundColor"),
        },
        value: {
            light: {...fallback.light, ...stored?.light},
            dark: {...fallback.dark, ...stored?.dark},
        },
        fallback,
    };
};

export const writeBuiltinEntry = (data: IInlineStyles, type: TBuiltinColorType,
                                  entry: IBuiltinColorDialogEntry) => {
    const properties = getProperties(type);
    if (type === "style1") {
        const id = entry.key as TBuiltinInlineStyleID;
        const current = getBuiltinInlineStyle(id, data) || {
            id,
            light: {} as IInlineStyleColors,
            dark: {} as IInlineStyleColors,
        };
        properties.forEach(property => setProperty(current, entry.value, property, entry.override[property]));
        data.builtin.styles = data.builtin.styles.filter(item => item.id !== id);
        if (hasColors(current)) {
            data.builtin.styles.push(current);
        }
        data.builtin.hidden.style1 = data.builtin.hidden.style1.filter(item => item !== id);
        if (!entry.show) {
            data.builtin.hidden.style1.push(id);
        }
        return;
    }
    const index = entry.key as number;
    const current = getBuiltinInlineColor(index, data) ||
        {index, light: {} as IInlineStyleColors, dark: {} as IInlineStyleColors};
    properties.forEach(property => setProperty(current, entry.value, property, entry.override[property]));
    data.builtin.colors = data.builtin.colors.filter(item => item.index !== index);
    if (hasColors(current)) {
        data.builtin.colors.push(current);
    }
    data.builtin.hidden[type] = data.builtin.hidden[type].filter(item => item !== index);
    if (!entry.show) {
        data.builtin.hidden[type].push(index);
    }
};

export const getBuiltinEditorHTML = (type: TBuiltinColorType) => {
    const properties = getProperties(type);
    return `<div class="fn__flex">
        <span class="color__square color__square--list fn__flex-center" data-role="preview">A</span>
        <span class="fn__flex-1 fn__flex-center" data-role="title"></span>
    </div>
    <div class="fn__hr--b"></div>
    <div data-role="overrides">${properties.map((property, index) => `<label class="fn__flex">
        <span class="fn__flex-center">${properties.length === 1 ? window.siyuan.languages.custom :
        (property === "color" ? window.siyuan.languages.colorFont : window.siyuan.languages.colorPrimary)}</span>
        <span class="fn__space"></span>
        <input class="b3-switch fn__flex-center" data-role="override" data-property="${property}" type="checkbox">
    </label>${index < properties.length - 1 ? "<div class=\"fn__hr\"></div>" : ""}`).join("")}</div>
    <div class="fn__hr--b"></div>
    <div class="ft__on-surface" data-role="defaultHint">${escapeHtml(window.siyuan.languages.useThemeDefaultColor)}</div>
    ${getThemeColorEditorHTML()}`;
};

export const getColorListItemHTML = (options: {
    kind: "builtin" | "custom",
    key: string,
    index: number,
    label: string,
    title?: string,
    previewStyle?: string,
    show: boolean,
    customized?: boolean,
    draggable?: boolean,
    canDelete?: boolean,
    resetHidden?: boolean,
}) => {
    const previewAttr = options.previewStyle ? ` style="${options.previewStyle}"` : " data-role=\"preview\"";
    return `<div class="b3-list-item b3-list-item--narrow" data-kind="${options.kind}" data-key="${escapeAttr(options.key)}" data-index="${options.index}">
    ${options.draggable !== false ? `<span class="b3-list-item__graphic ariaLabel fn__grab" data-drag="true" draggable="true" data-position="north" aria-label="${escapeAttr(window.siyuan.languages.sort)}"><svg><use xlink:href="#iconDrag"></use></svg></span>` : ""}
    <span class="color__square color__square--list"${previewAttr}>${options.kind === "custom" || options.previewStyle ? "A" : ""}</span>
    <span class="b3-list-item__text"${options.title ? ` title="${escapeAttr(options.title)}"` : ""}>${escapeHtml(options.label)}</span>
    ${options.customized ? `<span class="b3-list-item__meta">${escapeHtml(window.siyuan.languages.custom)}</span>` : ""}
    ${options.kind === "builtin" ? `<span class="b3-list-item__action ariaLabel${options.resetHidden ? " fn__none" : ""}" data-action="resetItem" data-position="north" aria-label="${escapeAttr(window.siyuan.languages.reset)}"><svg><use xlink:href="#iconUndo"></use></svg></span>` : ""}
    ${options.canDelete ? `<span class="b3-list-item__action b3-list-item__action--warning ariaLabel" data-action="delete" data-position="north" aria-label="${escapeAttr(window.siyuan.languages.delete)}"><svg><use xlink:href="#iconTrashcan"></use></svg></span>` : ""}
    <span class="b3-list-item__action ariaLabel" data-action="edit" data-position="north" aria-label="${escapeAttr(window.siyuan.languages.edit)}"><svg><use xlink:href="#iconEdit"></use></svg></span>
    <span class="fn__space"></span>
    <input class="b3-switch fn__flex-center ariaLabel" data-action="toggleShow" data-position="north" type="checkbox" aria-label="${escapeAttr(window.siyuan.languages.showInColorPicker)}"${options.show ? " checked" : ""}>
</div>`;
};

export const bindColorListDrag = (listElement: HTMLElement, getKeys: () => string[],
                                  onReorder: (keys: string[]) => void) => {
    let draggingIndex = -1;
    const clearDragover = () => {
        listElement.querySelectorAll<HTMLElement>(".b3-list-item[data-index]").forEach(item => {
            item.classList.remove("dragover__top", "dragover__bottom");
        });
    };
    const clearDragStyles = () => {
        clearDragover();
        listElement.querySelectorAll<HTMLElement>(".b3-list-item[data-index]").forEach(item => {
            item.classList.remove("ft__on-surface");
        });
    };
    listElement.addEventListener("dragstart", (event: DragEvent) => {
        const handleElement = (event.target as HTMLElement).closest<HTMLElement>('[data-drag="true"]');
        const itemElement = handleElement?.closest<HTMLElement>(".b3-list-item[data-index]");
        if (!itemElement) {
            event.preventDefault();
            return;
        }
        draggingIndex = parseInt(itemElement.dataset.index);
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", itemElement.dataset.index);
        itemElement.classList.add("ft__on-surface");
    });
    listElement.addEventListener("dragover", (event: DragEvent) => {
        const itemElement = (event.target as HTMLElement).closest<HTMLElement>(".b3-list-item[data-index]");
        if (!itemElement || draggingIndex < 0) {
            return;
        }
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        clearDragover();
        const rect = itemElement.getBoundingClientRect();
        itemElement.classList.add(event.clientY < rect.top + rect.height / 2 ? "dragover__top" : "dragover__bottom");
    });
    listElement.addEventListener("drop", (event: DragEvent) => {
        const itemElement = (event.target as HTMLElement).closest<HTMLElement>(".b3-list-item[data-index]");
        if (!itemElement || draggingIndex < 0) {
            return;
        }
        event.preventDefault();
        const targetIndex = parseInt(itemElement.dataset.index);
        const rect = itemElement.getBoundingClientRect();
        const before = event.clientY < rect.top + rect.height / 2;
        let insertIndex = targetIndex + (before ? 0 : 1);
        if (draggingIndex < insertIndex) {
            insertIndex--;
        }
        if (draggingIndex !== insertIndex) {
            const keys = getKeys();
            const [key] = keys.splice(draggingIndex, 1);
            keys.splice(insertIndex, 0, key);
            onReorder(keys);
        }
        draggingIndex = -1;
        clearDragStyles();
    });
    listElement.addEventListener("dragend", () => {
        draggingIndex = -1;
        clearDragStyles();
    });
};

export const bindBuiltinEditor = (panel: HTMLElement, type: TBuiltinColorType,
                                  getBase: () => IBuiltinColorDialogEntry | undefined) => {
    const properties = getProperties(type);
    const previewElement = panel.querySelector('[data-role="preview"]') as HTMLElement;
    const titleElement = panel.querySelector('[data-role="title"]') as HTMLElement;
    const hintElement = panel.querySelector('[data-role="defaultHint"]') as HTMLElement;
    const themeColorEditor = bindThemeColorEditor(panel);
    const overrideElements = new Map(Array.from(panel.querySelectorAll<HTMLInputElement>('[data-role="override"]'))
        .map(item => [item.dataset.property as TInlineStyleProperty, item] as const));

    const readEntry = (base: IBuiltinColorDialogEntry): IBuiltinColorDialogEntry => {
        const value = themeColorEditor.getValue(getEditorType(type));
        return {
            ...base,
            override: {
                color: overrideElements.get("color")?.checked ?? base.override.color,
                backgroundColor: overrideElements.get("backgroundColor")?.checked ?? base.override.backgroundColor,
            },
            value: {
                light: {...base.fallback.light, ...base.value.light, ...value.light},
                dark: {...base.fallback.dark, ...base.value.dark, ...value.dark},
            },
        };
    };

    const updateState = () => {
        let anyEnabled = false;
        properties.forEach(property => {
            const enabled = !!overrideElements.get(property)?.checked;
            anyEnabled = anyEnabled || enabled;
            panel.querySelectorAll<HTMLElement>(`[data-type="themeColorEditor"] [data-property="${property}"]`)
                .forEach(item => {
                    item.classList.toggle("fn__none", !enabled);
                    item.querySelectorAll<HTMLInputElement>("input[type=\"color\"]").forEach(input => {
                        input.disabled = !enabled;
                    });
                });
        });
        const themeEditorElement = panel.querySelector('[data-type="themeColorEditor"]') as HTMLElement;
        themeEditorElement.classList.toggle("fn__none", !anyEnabled);
        hintElement.classList.toggle("fn__none", anyEnabled);
        const base = getBase();
        if (base) {
            applyPreviewStyle(type, previewElement, readEntry(base));
        }
    };

    const fill = (entry: IBuiltinColorDialogEntry) => {
        titleElement.textContent = entry.label;
        properties.forEach(property => {
            const input = overrideElements.get(property);
            if (input) {
                input.checked = entry.override[property];
            }
        });
        themeColorEditor.setValue(entry.value, getEditorType(type));
        updateState();
    };

    const commit = (base: IBuiltinColorDialogEntry) => {
        const entry = readEntry(base);
        const value = themeColorEditor.getValue(getEditorType(type));
        properties.forEach(property => {
            entry.override[property] = !!overrideElements.get(property)?.checked;
            entry.value.light[property] = value.light[property] || entry.value.light[property];
            entry.value.dark[property] = value.dark[property] || entry.value.dark[property];
        });
        return entry;
    };

    panel.addEventListener("input", () => updateState());
    panel.addEventListener("change", event => {
        if ((event.target as HTMLElement).matches('[data-role="override"]')) {
            updateState();
        }
    });
    return {
        fill,
        commit,
        updateState,
    };
};

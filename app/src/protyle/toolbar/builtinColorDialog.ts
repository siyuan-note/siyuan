import {Dialog} from "../../dialog";
import {showMessage} from "../../dialog/message";
import {bindThemeColorEditor, getThemeColorEditorHTML} from "../../dialog/themeColorEditor";
import {escapeAttr, escapeHtml} from "../../util/escape";
import {isMobile} from "../../util/functions";
import {
    BUILTIN_INLINE_COLOR_COUNT,
    BUILTIN_INLINE_STYLE_IDS,
    getBuiltinColorPropertyValue,
    getBuiltinInlineColor,
    getBuiltinInlineStyle,
    getBuiltinInlineStylePropertyValue,
    getCurrentInlineStyleMode,
    getInlineStylesCache,
    IBuiltinInlineColor,
    IBuiltinInlineStyle,
    IInlineStyleColors,
    IInlineStyles,
    saveInlineStyles,
    TBuiltinColorType,
    TBuiltinInlineStyleID,
    TInlineStyleProperty,
} from "./inlineStyle";

interface IBuiltinColorDialogEntry {
    key: number | TBuiltinInlineStyleID;
    label: string;
    value?: IBuiltinInlineColor | IBuiltinInlineStyle;
}

interface IBuiltinColorDialogEditor {
    entry: IBuiltinColorDialogEntry;
    element: HTMLElement;
    editor: ReturnType<typeof bindThemeColorEditor>;
    fallback: { light: IInlineStyleColors, dark: IInlineStyleColors };
    overrideElements: Map<TInlineStyleProperty, HTMLInputElement>;
    showElement: HTMLInputElement;
}

const cloneInlineStyles = (data = getInlineStylesCache()): IInlineStyles =>
    JSON.parse(JSON.stringify(data)) as IInlineStyles;

const getTypeLabel = (type: TBuiltinColorType) => {
    if (type === "color") {
        return window.siyuan.languages.colorFont;
    }
    if (type === "backgroundColor") {
        return window.siyuan.languages.colorPrimary;
    }
    return window.siyuan.languages.color;
};

const getProperties = (type: TBuiltinColorType): TInlineStyleProperty[] => {
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

const colorToHex = (value: string, fallback: string) => {
    const normalized = value.trim();
    if (/^#[0-9a-f]{6}$/i.test(normalized)) {
        return normalized.toLowerCase();
    }
    const match = normalized.match(/^rgba?\(\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)/i);
    if (!match) {
        return fallback;
    }
    return `#${match.slice(1, 4).map(item => Math.max(0, Math.min(255, Math.round(Number(item))))
        .toString(16).padStart(2, "0")).join("")}`;
};

const resolveThemeColor = (value: string, fallback: string) => {
    const siyuanStyle = document.getElementById("siyuanStyle") as HTMLStyleElement;
    const disabled = siyuanStyle?.disabled;
    if (siyuanStyle) {
        siyuanStyle.disabled = true;
    }
    const element = document.createElement("span");
    element.style.color = value;
    element.style.position = "fixed";
    element.style.visibility = "hidden";
    document.body.append(element);
    const color = colorToHex(getComputedStyle(element).color, fallback);
    element.remove();
    if (siyuanStyle) {
        siyuanStyle.disabled = disabled;
    }
    return color;
};

const getFallbackValue = (type: TBuiltinColorType, key: number | TBuiltinInlineStyleID) => {
    const getValue = (property: TInlineStyleProperty) => type === "style1" ?
        getBuiltinInlineStylePropertyValue(key as TBuiltinInlineStyleID, property) :
        getBuiltinColorPropertyValue(key as number, property);
    return {
        light: {
            color: resolveThemeColor(getValue("color"), "#000000"),
            backgroundColor: resolveThemeColor(getValue("backgroundColor"), "#ffffff"),
        },
        dark: {
            color: resolveThemeColor(getValue("color"), "#ffffff"),
            backgroundColor: resolveThemeColor(getValue("backgroundColor"), "#000000"),
        },
    };
};

const getEditorType = (type: TBuiltinColorType) => type === "av" ? "style1" : type;

const hasOverride = (entry: IBuiltinColorDialogEntry, property: TInlineStyleProperty) =>
    !!entry.value?.light[property] && !!entry.value?.dark[property];

const getEntryHTML = (type: TBuiltinColorType, entry: IBuiltinColorDialogEntry) => {
    const properties = getProperties(type);
    const customHTML = properties.map(property => `<label class="fn__flex" style="align-items:center">
    <input class="b3-switch" data-role="override" data-property="${property}" type="checkbox"${
        hasOverride(entry, property) ? " checked" : ""}>
    <span class="fn__space"></span>${property === "color" ? window.siyuan.languages.colorFont :
        window.siyuan.languages.colorPrimary}
</label>`).join('<span class="fn__space"></span>');
    return `<div class="b3-label b3-label--inner" data-entry="${escapeAttr(entry.key.toString())}">
    <div class="fn__flex" style="align-items:center;gap:8px">
        <span class="color__square color__square--list" data-role="preview">A</span>
        <span class="fn__flex-1">${escapeHtml(entry.label)}</span>
        <label class="fn__flex" style="align-items:center">
            ${window.siyuan.languages.showInColorPicker}<span class="fn__space"></span>
            <input class="b3-switch" data-role="show" type="checkbox">
        </label>
        <button class="b3-button b3-button--outline" data-action="reset" type="button">
            ${window.siyuan.languages.reset}
        </button>
    </div>
    <div class="fn__flex" style="align-items:center;margin-top:12px">${customHTML}</div>
    ${getThemeColorEditorHTML()}
</div>`;
};

const updatePropertyState = (editor: IBuiltinColorDialogEditor) => {
    editor.overrideElements.forEach((input, property) => {
        editor.element.querySelectorAll<HTMLInputElement>(`[data-property="${property}"] input[type="color"]`)
            .forEach(item => item.disabled = !input.checked);
    });
};

const updatePreview = (type: TBuiltinColorType, editor: IBuiltinColorDialogEditor) => {
    const previewElement = editor.element.querySelector('[data-role="preview"]') as HTMLElement;
    const mode = getCurrentInlineStyleMode();
    const value = editor.editor.getValue(getEditorType(type));
    const getValue = (property: TInlineStyleProperty) => editor.overrideElements.get(property)?.checked ?
        value[mode][property] : editor.fallback[mode][property];
    previewElement.style.color = type === "backgroundColor" ? "" : getValue("color");
    previewElement.style.backgroundColor = type === "color" ? "" : getValue("backgroundColor");
    previewElement.textContent = type === "backgroundColor" ? "" : "A";
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

export const openBuiltinColorDialog = (type: TBuiltinColorType,
                                       onChange?: (data: IInlineStyles) => void) => {
    if (window.siyuan.config.readonly || window.siyuan.isPublish) {
        return;
    }
    const initialData = cloneInlineStyles();
    const entries: IBuiltinColorDialogEntry[] = type === "style1" ?
        BUILTIN_INLINE_STYLE_IDS.map(id => ({
            key: id,
            label: getEntryLabel(type, id),
            value: getBuiltinInlineStyle(id, initialData),
        })) : Array.from({length: BUILTIN_INLINE_COLOR_COUNT}, (_, index) => ({
            key: index + 1,
            label: getEntryLabel(type, index + 1),
            value: getBuiltinInlineColor(index + 1, initialData),
        }));
    let saving = false;
    const dialog = new Dialog({
        title: window.siyuan.languages.manageBuiltinColors,
        width: isMobile() ? "92vw" : "720px",
        content: `<div class="b3-dialog__content" style="max-height:70vh;overflow:auto">
    ${entries.map(entry => getEntryHTML(type, entry)).join("")}
</div>
<div class="b3-dialog__action">
    <button class="b3-button b3-button--outline" data-action="resetAll" type="button">${
        window.siyuan.languages.resetAll}</button>
    <div class="fn__flex-1"></div>
    <button class="b3-button b3-button--cancel" data-action="cancel" type="button">${
        window.siyuan.languages.cancel}</button>
    <div class="fn__space"></div>
    <button class="b3-button b3-button--text" data-action="save" type="button">${
        window.siyuan.languages.save}</button>
</div>`,
    });
    const editors = new Map<string, IBuiltinColorDialogEditor>();
    const hidden = initialData.builtin.hidden[type];
    entries.forEach(entry => {
        const element = dialog.element.querySelector(`[data-entry="${entry.key}"]`) as HTMLElement;
        const editor = bindThemeColorEditor(element);
        const fallback = getFallbackValue(type, entry.key);
        const editorValue = {
            light: {...fallback.light, ...entry.value?.light},
            dark: {...fallback.dark, ...entry.value?.dark},
        };
        editor.setValue(editorValue, getEditorType(type));
        const overrideElements = new Map<TInlineStyleProperty, HTMLInputElement>();
        element.querySelectorAll<HTMLInputElement>('[data-role="override"]').forEach(item => {
            overrideElements.set(item.dataset.property as TInlineStyleProperty, item);
        });
        const showElement = element.querySelector('[data-role="show"]') as HTMLInputElement;
        showElement.checked = !hidden.includes(entry.key as never);
        const state: IBuiltinColorDialogEditor = {entry, element, editor, fallback, overrideElements, showElement};
        editors.set(entry.key.toString(), state);
        updatePropertyState(state);
        updatePreview(type, state);
        element.addEventListener("input", () => updatePreview(type, state));
        element.addEventListener("change", event => {
            if ((event.target as HTMLElement).matches('[data-role="override"]')) {
                updatePropertyState(state);
            }
            updatePreview(type, state);
        });
    });

    const resetEditor = (state: IBuiltinColorDialogEditor) => {
        state.overrideElements.forEach(item => item.checked = false);
        state.showElement.checked = true;
        state.editor.setValue(state.fallback, getEditorType(type));
        updatePropertyState(state);
        updatePreview(type, state);
    };

    dialog.element.addEventListener("click", async event => {
        const actionElement = (event.target as HTMLElement).closest<HTMLElement>("[data-action]");
        if (!actionElement || actionElement.hasAttribute("disabled")) {
            return;
        }
        const action = actionElement.dataset.action;
        if (action === "reset") {
            const entryElement = actionElement.closest<HTMLElement>("[data-entry]");
            const state = entryElement && editors.get(entryElement.dataset.entry);
            if (state) {
                resetEditor(state);
            }
        } else if (action === "resetAll") {
            editors.forEach(resetEditor);
        } else if (action === "cancel") {
            dialog.destroy();
        } else if (action === "save" && !saving) {
            saving = true;
            actionElement.setAttribute("disabled", "disabled");
            const data = cloneInlineStyles();
            const hiddenValues: Array<number | TBuiltinInlineStyleID> = [];
            editors.forEach(state => {
                if (!state.showElement.checked) {
                    hiddenValues.push(state.entry.key);
                }
                const value = state.editor.getValue(getEditorType(type));
                if (type === "style1") {
                    const id = state.entry.key as TBuiltinInlineStyleID;
                    const current = getBuiltinInlineStyle(id, data) || {id, light: {}, dark: {}};
                    getProperties(type).forEach(property => setProperty(current, value, property,
                        state.overrideElements.get(property).checked));
                    data.builtin.styles = data.builtin.styles.filter(item => item.id !== id);
                    if (hasColors(current)) {
                        data.builtin.styles.push(current);
                    }
                } else {
                    const index = state.entry.key as number;
                    const current = getBuiltinInlineColor(index, data) || {index, light: {}, dark: {}};
                    getProperties(type).forEach(property => setProperty(current, value, property,
                        state.overrideElements.get(property).checked));
                    data.builtin.colors = data.builtin.colors.filter(item => item.index !== index);
                    if (hasColors(current)) {
                        data.builtin.colors.push(current);
                    }
                }
            });
            if (type === "style1") {
                data.builtin.hidden.style1 = hiddenValues as TBuiltinInlineStyleID[];
            } else {
                data.builtin.hidden[type] = hiddenValues as number[];
            }
            try {
                const response = await saveInlineStyles(data);
                if (response?.code !== 0) {
                    showMessage(response?.msg || window.siyuan.languages.invalid, 6000, "error");
                    saving = false;
                    actionElement.removeAttribute("disabled");
                    return;
                }
                const savedData = getInlineStylesCache();
                onChange?.(savedData);
                void import("../../util/assets").then(module => module.setInlineStyle());
                dialog.destroy();
            } catch (error) {
                showMessage(error instanceof Error ? error.message : window.siyuan.languages.invalid, 6000, "error");
                saving = false;
                actionElement.removeAttribute("disabled");
            }
        }
        event.preventDefault();
        event.stopPropagation();
    });
};

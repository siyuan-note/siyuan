import {Dialog} from "../../dialog";
import {confirmDialog} from "../../dialog/confirmDialog";
import {showMessage} from "../../dialog/message";
import {bindThemeColorEditor, getThemeColorEditorHTML} from "../../dialog/themeColorEditor";
import {escapeHtml} from "../../util/escape";
import {isMobile} from "../../util/functions";
import {
    getCurrentInlineStyleMode,
    getInlineStyleByID,
    getInlineStylePreview,
    getInlineStylesCache,
    getOrderedStyleKeys,
    IInlineStyle,
    IInlineStyles,
    isBuiltinOrderKey,
    MAX_INLINE_STYLE_NAME_LENGTH,
    MAX_INLINE_STYLES,
    normalizeInlineStyles,
    saveInlineStyles,
    TBuiltinInlineStyleID,
    TInlineStyleType,
} from "./inlineStyle";
import {
    applyPreviewStyle,
    bindBuiltinEditor,
    bindColorListDrag,
    createBuiltinDialogEntry,
    getBuiltinEditorHTML,
    getColorListItemHTML,
    getProperties,
    isEntryCustomized,
    isEntryDefault,
    resetEntry,
    writeBuiltinEntry,
} from "./builtinColorDialog";

const getTypeLabel = (type: TInlineStyleType) => {
    if (type === "color") {
        return window.siyuan.languages.colorFont;
    }
    if (type === "backgroundColor") {
        return window.siyuan.languages.colorPrimary;
    }
    return window.siyuan.languages.color;
};

const cloneInlineStyles = (data = getInlineStylesCache()): IInlineStyles =>
    JSON.parse(JSON.stringify(normalizeInlineStyles(data))) as IInlineStyles;

const renderPreviewStyle = (style: IInlineStyle) => {
    const preview = getInlineStylePreview(style, getCurrentInlineStyleMode(), false);
    return `${preview.color ? `color:${preview.color};` : ""}` +
        `${preview.backgroundColor ? `background-color:${preview.backgroundColor};` : ""}`;
};

const getBuiltinKey = (type: TInlineStyleType, key: string) =>
    type === "style1" ? key as TBuiltinInlineStyleID : Number(key);

export const openInlineStyleDialog = (initialType: TInlineStyleType = "backgroundColor",
                                      onChange?: (data: IInlineStyles) => void) => {
    if (window.siyuan.config.readonly || window.siyuan.isPublish) {
        return;
    }
    const draft = cloneInlineStyles();
    const persistedStyleIDs = new Set(draft.styles.map(style => style.id));
    const properties = getProperties(initialType);
    let editingKey: string | undefined;
    let editingKind: "builtin" | "custom" | "new" | undefined;
    let saving = false;
    const dialog = new Dialog({
        title: window.siyuan.languages.color,
        width: isMobile() ? "92vw" : "600px",
        content: `<div class="b3-dialog__content" style="max-height:70vh">
    <div data-panel="list">
        <div data-type="inlineStyleList" class="b3-list b3-list--background fn__selectnone"></div>
        <div class="fn__hr" data-type="listSpacer"></div>
        <div class="fn__flex" data-type="inlineStyleButtons">
            <button class="b3-button b3-button--outline" data-action="new" type="button">
                <svg><use xlink:href="#iconAdd"></use></svg>${window.siyuan.languages.new}
            </button>
        </div>
    </div>
    <div data-panel="customEditor" class="fn__none">
        <label class="b3-label b3-label--inner fn__flex">
            <span class="fn__size96 fn__flex-center">${window.siyuan.languages.name}</span>
            <input class="b3-text-field fn__flex-1 fn__flex-center" data-field="name">
        </label>
        <label class="b3-label b3-label--inner fn__flex">
            <span class="fn__size96 fn__flex-center">${window.siyuan.languages.type}</span>
            <span class="fn__flex-1 fn__flex-center" data-field="typeLabel"></span>
        </label>
        ${getThemeColorEditorHTML()}
    </div>
    <div data-panel="builtinEditor" class="fn__none">
        ${getBuiltinEditorHTML(initialType)}
    </div>
</div>
<div class="b3-dialog__action" data-panel="actions">
    <button class="b3-button b3-button--outline fn__none" data-action="reset" type="button">${window.siyuan.languages.reset}</button>
    <div class="fn__flex-1"></div>
    <button class="b3-button b3-button--cancel" data-action="cancel" type="button">${window.siyuan.languages.cancel}</button>
    <div class="fn__space"></div>
    <button class="b3-button b3-button--text" data-action="save" type="button">${window.siyuan.languages.save}</button>
</div>`,
    });
    const listPanel = dialog.element.querySelector('[data-panel="list"]') as HTMLElement;
    const customEditorPanel = dialog.element.querySelector('[data-panel="customEditor"]') as HTMLElement;
    const builtinEditorPanel = dialog.element.querySelector('[data-panel="builtinEditor"]') as HTMLElement;
    const listElement = dialog.element.querySelector('[data-type="inlineStyleList"]') as HTMLElement;
    const newElement = dialog.element.querySelector('[data-action="new"]') as HTMLButtonElement;
    const spacerElement = dialog.element.querySelector('[data-type="listSpacer"]') as HTMLElement;
    const resetElement = dialog.element.querySelector('[data-action="reset"]') as HTMLButtonElement;
    const cancelElement = dialog.element.querySelector('[data-action="cancel"]') as HTMLButtonElement;
    const saveElement = dialog.element.querySelector('[data-action="save"]') as HTMLButtonElement;
    const nameElement = dialog.element.querySelector('[data-field="name"]') as HTMLInputElement;
    const typeLabelElement = dialog.element.querySelector('[data-field="typeLabel"]') as HTMLElement;
    const customThemeEditor = bindThemeColorEditor(customEditorPanel);

    const getListKeys = () => getOrderedStyleKeys(initialType, draft);

    const getBuiltinEntry = (key: string) =>
        createBuiltinDialogEntry(initialType, getBuiltinKey(initialType, key), draft);

    const builtinEditor = bindBuiltinEditor(builtinEditorPanel, initialType, () =>
        editingKind === "builtin" && editingKey ? getBuiltinEntry(editingKey) : undefined);

    const renderList = () => {
        const keys = getListKeys();
        listElement.innerHTML = keys.map((key, index) => {
            const builtin = isBuiltinOrderKey(initialType, key);
            if (builtin) {
                const entry = getBuiltinEntry(key);
                return getColorListItemHTML({
                    kind: "builtin",
                    key,
                    index,
                    label: entry.label,
                    show: entry.show,
                    customized: isEntryCustomized(entry, properties),
                    resetHidden: isEntryDefault(entry, properties),
                });
            }
            const style = getInlineStyleByID(key, draft);
            if (!style) {
                return "";
            }
            return getColorListItemHTML({
                kind: "custom",
                key,
                index,
                label: style.name,
                title: style.name,
                previewStyle: renderPreviewStyle(style),
                show: !style.hidden,
                canDelete: true,
            });
        }).join("");
        listElement.querySelectorAll<HTMLElement>('[data-kind="builtin"][data-key]').forEach(item => {
            const preview = item.querySelector('[data-role="preview"]') as HTMLElement;
            if (preview) {
                applyPreviewStyle(initialType, preview, getBuiltinEntry(item.dataset.key));
            }
        });
        newElement.disabled = draft.styles.length >= MAX_INLINE_STYLES;
        spacerElement.classList.toggle("fn__none", keys.length === 0);
    };

    const setEditorActionMode = (mode: "list" | "custom" | "builtin") => {
        listPanel.classList.toggle("fn__none", mode !== "list");
        customEditorPanel.classList.toggle("fn__none", mode !== "custom");
        builtinEditorPanel.classList.toggle("fn__none", mode !== "builtin");
        resetElement.classList.toggle("fn__none", mode !== "builtin");
        cancelElement.dataset.action = mode === "list" ? "cancel" : "cancelEdit";
        saveElement.dataset.action = mode === "list" ? "save" : "confirmEdit";
        saveElement.textContent = mode === "list" ? window.siyuan.languages.save : window.siyuan.languages.confirm;
        saveElement.removeAttribute("disabled");
    };

    const showList = () => {
        editingKey = undefined;
        editingKind = undefined;
        setEditorActionMode("list");
        renderList();
    };

    const showCustomEditor = (key?: string) => {
        const style = key ? getInlineStyleByID(key, draft) : undefined;
        editingKey = key;
        editingKind = style ? "custom" : "new";
        nameElement.value = style?.name || "";
        typeLabelElement.textContent = getTypeLabel(initialType);
        customThemeEditor.setValue(style, initialType);
        setEditorActionMode("custom");
        nameElement.focus();
    };

    const showBuiltinEditor = (key: string) => {
        editingKey = key;
        editingKind = "builtin";
        builtinEditor.fill(getBuiltinEntry(key));
        setEditorActionMode("builtin");
    };

    const confirmEditor = () => {
        if (editingKind === "builtin" && editingKey) {
            writeBuiltinEntry(draft, initialType, builtinEditor.commit(getBuiltinEntry(editingKey)));
            showList();
            return;
        }
        const name = nameElement.value.trim();
        if (!name) {
            showMessage(window.siyuan.languages.namingEmpty, 6000, "error");
            nameElement.focus();
            return;
        }
        if ([...name].length > MAX_INLINE_STYLE_NAME_LENGTH) {
            showMessage(window.siyuan.languages.invalid, 6000, "error");
            nameElement.focus();
            return;
        }
        const previous = editingKey ? getInlineStyleByID(editingKey, draft) : undefined;
        const value = customThemeEditor.getValue(initialType);
        const style: IInlineStyle = {
            id: previous?.id || Lute.NewNodeID(),
            name,
            hidden: previous?.hidden,
            light: value.light,
            dark: value.dark,
        };
        if (previous) {
            draft.styles = draft.styles.map(item => item.id === previous.id ? style : item);
        } else {
            draft.styles.push(style);
            if (!draft.order[initialType].includes(style.id)) {
                draft.order[initialType].push(style.id);
            }
        }
        showList();
    };

    bindColorListDrag(listElement, getListKeys, keys => {
        draft.order[initialType] = keys;
        renderList();
    });
    listElement.addEventListener("click", event => {
        if ((event.target as HTMLElement).closest('[data-action="toggleShow"]')) {
            event.stopPropagation();
        }
    });
    listElement.addEventListener("change", event => {
        const switchElement = (event.target as HTMLElement).closest<HTMLInputElement>('[data-action="toggleShow"]');
        const itemElement = switchElement?.closest<HTMLElement>("[data-key]");
        if (!switchElement || !itemElement) {
            return;
        }
        if (itemElement.dataset.kind === "builtin") {
            const entry = getBuiltinEntry(itemElement.dataset.key);
            entry.show = switchElement.checked;
            writeBuiltinEntry(draft, initialType, entry);
            itemElement.querySelector('[data-action="resetItem"]')?.classList.toggle("fn__none", isEntryDefault(entry, properties));
            return;
        }
        const style = getInlineStyleByID(itemElement.dataset.key, draft);
        if (style) {
            style.hidden = !switchElement.checked;
        }
    });

    dialog.element.addEventListener("click", async event => {
        const actionElement = (event.target as HTMLElement).closest<HTMLElement>("[data-action]");
        if (!actionElement || actionElement.hasAttribute("disabled") || actionElement.classList.contains("fn__none")) {
            return;
        }
        const action = actionElement.dataset.action;
        if (action === "toggleShow") {
            event.stopPropagation();
            return;
        }
        const itemElement = actionElement.closest<HTMLElement>("[data-key]");
        const key = itemElement?.dataset.key;
        if (action === "new") {
            if (draft.styles.length >= MAX_INLINE_STYLES) {
                showMessage(window.siyuan.languages.invalid, 6000, "error");
                return;
            }
            showCustomEditor();
        } else if (action === "edit" && key) {
            if (itemElement.dataset.kind === "builtin") {
                showBuiltinEditor(key);
            } else {
                showCustomEditor(key);
            }
        } else if (action === "resetItem" && key) {
            const entry = getBuiltinEntry(key);
            resetEntry(entry, properties);
            writeBuiltinEntry(draft, initialType, entry);
            renderList();
        } else if (action === "reset") {
            if (editingKind === "builtin" && editingKey) {
                const entry = getBuiltinEntry(editingKey);
                resetEntry(entry, properties);
                writeBuiltinEntry(draft, initialType, entry);
                showBuiltinEditor(editingKey);
            }
        } else if (action === "delete" && key) {
            const style = getInlineStyleByID(key, draft);
            if (!style) {
                return;
            }
            const removeStyle = () => {
                draft.styles = draft.styles.filter(item => item.id !== key);
                (["color", "backgroundColor", "style1"] as TInlineStyleType[]).forEach(type => {
                    draft.order[type] = draft.order[type].filter(item => item !== key);
                });
                renderList();
            };
            if (persistedStyleIDs.has(style.id)) {
                confirmDialog(window.siyuan.languages.deleteOpConfirm,
                    window.siyuan.languages.deleteCustomColorTip.replace("${name}", `<b>${escapeHtml(style.name)}</b>`),
                    removeStyle, undefined, true);
            } else {
                removeStyle();
            }
        } else if (action === "cancelEdit") {
            showList();
        } else if (action === "confirmEdit") {
            confirmEditor();
        } else if (action === "cancel") {
            dialog.destroy();
        } else if (action === "save" && !saving) {
            saving = true;
            actionElement.setAttribute("disabled", "disabled");
            try {
                const response = await saveInlineStyles(draft);
                if (response?.code !== 0) {
                    showMessage(response?.msg || window.siyuan.languages.invalid, 6000, "error");
                    saving = false;
                    actionElement.removeAttribute("disabled");
                    return;
                }
                const data = getInlineStylesCache();
                onChange?.(data);
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
    typeLabelElement.textContent = getTypeLabel(initialType);
    renderList();
};

import {Dialog} from "../../dialog";
import {confirmDialog} from "../../dialog/confirmDialog";
import {showMessage} from "../../dialog/message";
import {escapeAttr, escapeHtml} from "../../util/escape";
import {isMobile} from "../../util/functions";
import {bindThemeColorEditor, getThemeColorEditorHTML} from "../../dialog/themeColorEditor";
import {
    getCurrentInlineStyleMode,
    getInlineStylePreview,
    getInlineStylesCache,
    getInlineStyleType,
    IInlineStyle,
    IInlineStyles,
    MAX_INLINE_STYLE_NAME_LENGTH,
    MAX_INLINE_STYLES,
    saveInlineStyles,
    TInlineStyleType,
} from "./inlineStyle";
import {openBuiltinColorDialog} from "./builtinColorDialog";

const escapeAttribute = (value: string) => escapeAttr(value);

const getTypeLabel = (type: TInlineStyleType) => {
    if (type === "color") {
        return window.siyuan.languages.colorFont;
    }
    if (type === "backgroundColor") {
        return window.siyuan.languages.colorPrimary;
    }
    return window.siyuan.languages.color;
};

const cloneInlineStyles = (): IInlineStyles => JSON.parse(JSON.stringify(getInlineStylesCache())) as IInlineStyles;

const renderPreviewStyle = (style: IInlineStyle) => {
    const preview = getInlineStylePreview(style, getCurrentInlineStyleMode(), false);
    return `${preview.color ? `color:${preview.color};` : ""}` +
        `${preview.backgroundColor ? `background-color:${preview.backgroundColor};` : ""}`;
};

export const openInlineStyleDialog = (initialType: TInlineStyleType = "backgroundColor",
                                      onChange?: (data: IInlineStyles) => void) => {
    if (window.siyuan.config.readonly || window.siyuan.isPublish) {
        return;
    }
    const draft = cloneInlineStyles();
    const persistedStyleIDs = new Set(draft.styles.map(style => style.id));
    let editingIndex: number | undefined;
    let saving = false;
    const dialog = new Dialog({
        title: window.siyuan.languages.color,
        width: isMobile() ? "92vw" : "600px",
        content: `<div class="b3-dialog__content" style="max-height:70vh;overflow:auto">
    <div data-panel="list">
        <div data-type="inlineStyleList" class="b3-list b3-list--background fn__selectnone" style="--file-toggle-width:0px"></div>
        <div class="fn__flex" data-type="inlineStyleButtons">
        <button class="b3-button b3-button--outline" data-action="manageBuiltin" type="button">
            <svg><use xlink:href="#iconSettings"></use></svg>${window.siyuan.languages.manageBuiltinColors}
        </button>
        <div class="fn__space"></div>
        <button class="b3-button b3-button--outline" data-action="new" type="button">
            <svg><use xlink:href="#iconAdd"></use></svg>${window.siyuan.languages.new}
        </button>
        </div>
    </div>
    <div data-panel="editor" class="fn__none">
        <label class="b3-label b3-label--inner fn__flex" style="align-items:center">
            <span style="min-width:96px">${window.siyuan.languages.name}</span>
            <input class="b3-text-field fn__flex-1" data-field="name" style="margin-top:0">
        </label>
        <label class="b3-label b3-label--inner fn__flex" style="align-items:center">
            <span style="min-width:96px">${window.siyuan.languages.type}</span>
            <select class="b3-select fn__flex-1" data-field="type" style="margin-top:0">
                <option value="color">${window.siyuan.languages.colorFont}</option>
                <option value="backgroundColor">${window.siyuan.languages.colorPrimary}</option>
                <option value="style1">${window.siyuan.languages.color}</option>
            </select>
            <span class="fn__flex-1 fn__none" data-field="typeLabel"></span>
        </label>
        ${getThemeColorEditorHTML()}
    </div>
</div>
<div class="b3-dialog__action" data-panel="actions">
    <button class="b3-button b3-button--cancel" data-action="cancel" type="button">${window.siyuan.languages.cancel}</button>
    <div class="fn__space"></div>
    <button class="b3-button b3-button--text" data-action="save" type="button">${window.siyuan.languages.save}</button>
</div>`,
    });
    const listPanel = dialog.element.querySelector('[data-panel="list"]') as HTMLElement;
    const editorPanel = dialog.element.querySelector('[data-panel="editor"]') as HTMLElement;
    const listElement = dialog.element.querySelector('[data-type="inlineStyleList"]') as HTMLElement;
    const newElement = dialog.element.querySelector('[data-action="new"]') as HTMLButtonElement;
    const buttonsElement = dialog.element.querySelector('[data-type="inlineStyleButtons"]') as HTMLElement;
    const cancelElement = dialog.element.querySelector('[data-action="cancel"]') as HTMLButtonElement;
    const saveElement = dialog.element.querySelector('[data-action="save"]') as HTMLButtonElement;
    const nameElement = dialog.element.querySelector('[data-field="name"]') as HTMLInputElement;
    const typeElement = dialog.element.querySelector('[data-field="type"]') as HTMLSelectElement;
    const typeLabelElement = dialog.element.querySelector('[data-field="typeLabel"]') as HTMLElement;
    const themeColorEditor = bindThemeColorEditor(editorPanel);

    const renderList = () => {
        listElement.innerHTML = draft.styles.length === 0 ?
            "" :
            draft.styles.map((style, index) => `<div class="b3-list-item b3-list-item--narrow" data-id="${escapeAttribute(style.id)}" data-index="${index}">
    <span class="b3-list-item__graphic ariaLabel fn__grab" data-drag="true" draggable="true" data-position="north" aria-label="${escapeAttribute(window.siyuan.languages.sort)}"><svg><use xlink:href="#iconDrag"></use></svg></span>
    <span class="color__square color__square--list" style="${renderPreviewStyle(style)}">A</span>
    <span class="b3-list-item__text" title="${escapeAttribute(style.name)}">${escapeHtml(style.name)}</span>
    <span class="b3-list-item__meta">${escapeHtml(getTypeLabel(getInlineStyleType(style) || "color"))}</span>
    <span class="b3-list-item__action ariaLabel" data-action="edit" data-index="${index}" data-position="north" aria-label="${escapeAttribute(window.siyuan.languages.edit)}"><svg><use xlink:href="#iconEdit"></use></svg></span>
    <span class="b3-list-item__action b3-list-item__action--warning ariaLabel" data-action="delete" data-index="${index}" data-position="north" aria-label="${escapeAttribute(window.siyuan.languages.delete)}"><svg><use xlink:href="#iconTrashcan"></use></svg></span>
</div>`).join("");
        newElement.disabled = draft.styles.length >= MAX_INLINE_STYLES;
        buttonsElement.style.marginTop = draft.styles.length === 0 ? "0" : "8px";
    };

    const setEditorActionMode = (editing: boolean) => {
        cancelElement.dataset.action = editing ? "cancelEdit" : "cancel";
        saveElement.dataset.action = editing ? "confirmEdit" : "save";
        saveElement.textContent = editing ? window.siyuan.languages.confirm : window.siyuan.languages.save;
    };

    const showList = () => {
        editingIndex = undefined;
        editorPanel.classList.add("fn__none");
        listPanel.classList.remove("fn__none");
        setEditorActionMode(false);
        renderList();
    };

    const showEditor = (index?: number) => {
        editingIndex = index ?? -1;
        const style = typeof index === "number" ? draft.styles[index] : undefined;
        nameElement.value = style?.name || "";
        typeElement.value = style ? getInlineStyleType(style) : initialType;
        typeElement.classList.toggle("fn__none", !!style);
        typeLabelElement.classList.toggle("fn__none", !style);
        typeLabelElement.textContent = getTypeLabel(typeElement.value as TInlineStyleType);
        themeColorEditor.setValue(style, typeElement.value as TInlineStyleType);
        listPanel.classList.add("fn__none");
        editorPanel.classList.remove("fn__none");
        setEditorActionMode(true);
        nameElement.focus();
    };

    const confirmEditor = () => {
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
        const type = typeElement.value as TInlineStyleType;
        const previous = editingIndex >= 0 ? draft.styles[editingIndex] : undefined;
        const value = themeColorEditor.getValue(type);
        const style: IInlineStyle = {
            id: previous?.id || Lute.NewNodeID(),
            name,
            light: value.light,
            dark: value.dark,
        };
        if (previous) {
            draft.styles[editingIndex] = style;
        } else {
            draft.styles.push(style);
        }
        showList();
    };

    let draggingIndex = -1;
    const clearDragover = () => {
        listElement.querySelectorAll<HTMLElement>(".b3-list-item[data-index]").forEach(item => {
            item.classList.remove("dragover__top", "dragover__bottom");
        });
    };
    const clearDragStyles = () => {
        clearDragover();
        listElement.querySelectorAll<HTMLElement>(".b3-list-item[data-index]").forEach(item => {
            item.style.opacity = "";
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
        itemElement.style.opacity = ".38";
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
            const [style] = draft.styles.splice(draggingIndex, 1);
            draft.styles.splice(insertIndex, 0, style);
            renderList();
        }
        draggingIndex = -1;
        clearDragStyles();
    });
    listElement.addEventListener("dragend", () => {
        draggingIndex = -1;
        clearDragStyles();
    });

    typeElement.addEventListener("change", () => {
        themeColorEditor.setType(typeElement.value as TInlineStyleType);
    });
    dialog.element.addEventListener("click", async event => {
        const actionElement = (event.target as HTMLElement).closest<HTMLElement>("[data-action]");
        if (!actionElement || actionElement.hasAttribute("disabled")) {
            return;
        }
        const action = actionElement.dataset.action;
        const index = parseInt(actionElement.dataset.index);
        if (action === "new") {
            if (draft.styles.length >= MAX_INLINE_STYLES) {
                showMessage(window.siyuan.languages.invalid, 6000, "error");
                return;
            }
            showEditor();
        } else if (action === "manageBuiltin") {
            openBuiltinColorDialog(initialType, onChange);
        } else if (action === "edit") {
            showEditor(index);
        } else if (action === "delete") {
            const style = draft.styles[index];
            if (!style) {
                return;
            }
            const removeStyle = () => {
                draft.styles.splice(index, 1);
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
                const response = await saveInlineStyles({
                    ...draft,
                    builtin: cloneInlineStyles().builtin,
                });
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
    renderList();
};

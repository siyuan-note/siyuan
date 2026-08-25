import {Dialog} from "../../../dialog";
import {confirmDialog} from "../../../dialog/confirmDialog";
import {showMessage} from "../../../dialog/message";
import {bindThemeColorEditor, getThemeColorEditorHTML} from "../../../dialog/themeColorEditor";
import {escapeAttr, escapeHtml} from "../../../util/escape";
import {isMobile} from "../../../util/functions";
import {transaction} from "../../wysiwyg/transaction";
import {
    AV_CUSTOM_COLOR_LIMIT,
    getAvailableAVCustomColorIndex,
    getAVColorStyle,
    getAVCustomColors,
} from "./color";
import {getInlineStyleType, getInlineStylesCache} from "../../toolbar/inlineStyle";
import {openBuiltinColorDialog} from "../../toolbar/builtinColorDialog";
import * as dayjs from "dayjs";

const cloneCustomColors = (colors: IAVCustomColor[]) => JSON.parse(JSON.stringify(colors)) as IAVCustomColor[];

export const openAVCustomColorDialog = (options: {
    protyle: IProtyle,
    data: IAV,
    blockElement: HTMLElement,
}) => {
    if (window.siyuan.config.readonly || window.siyuan.isPublish) {
        return;
    }
    const originalColors = cloneCustomColors(getAVCustomColors(options.data));
    const draft = cloneCustomColors(originalColors);
    const usedIndexes = new Set(options.data.usedCustomColorIndexes || []);
    const appearanceStyles = getInlineStylesCache().styles.filter(style => getInlineStyleType(style) === "style1");
    let editingIndex: number | undefined;
    let editingColorIndex: number | undefined;
    const dialog = new Dialog({
        title: window.siyuan.languages.manageColors,
        width: isMobile() ? "92vw" : "600px",
        content: `<div class="b3-dialog__content" style="max-height:70vh;overflow:auto">
    <div data-panel="list">
        <div data-type="avCustomColorList" class="b3-list b3-list--background fn__selectnone" style="--file-toggle-width:0px"></div>
        <div class="fn__flex" data-type="avColorButtons">
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
        <div class="b3-label b3-label--inner" data-field="colorIndex"></div>
        ${appearanceStyles.length > 0 ? `<label class="b3-label b3-label--inner fn__flex" style="align-items:center">
            <span style="min-width:96px">${window.siyuan.languages.appearance}</span>
            <select class="b3-select fn__flex-1" data-field="appearance" style="margin-top:0">
                <option value="">${window.siyuan.languages.select}</option>
                ${appearanceStyles.map((style, index) => `<option value="${index}">${escapeHtml(style.name)}</option>`).join("")}
            </select>
        </label>` : ""}
        ${getThemeColorEditorHTML()}
    </div>
</div>
<div class="b3-dialog__action">
    <button class="b3-button b3-button--cancel" data-action="cancel" type="button">${window.siyuan.languages.cancel}</button>
    <div class="fn__space"></div>
    <button class="b3-button b3-button--text" data-action="save" type="button">${window.siyuan.languages.save}</button>
</div>`,
    });
    const listPanel = dialog.element.querySelector('[data-panel="list"]') as HTMLElement;
    const editorPanel = dialog.element.querySelector('[data-panel="editor"]') as HTMLElement;
    const listElement = dialog.element.querySelector('[data-type="avCustomColorList"]') as HTMLElement;
    const newElement = dialog.element.querySelector('[data-action="new"]') as HTMLButtonElement;
    const buttonsElement = dialog.element.querySelector('[data-type="avColorButtons"]') as HTMLElement;
    const cancelElement = dialog.element.querySelector('[data-action="cancel"]') as HTMLButtonElement;
    const saveElement = dialog.element.querySelector('[data-action="save"]') as HTMLButtonElement;
    const colorIndexElement = dialog.element.querySelector('[data-field="colorIndex"]') as HTMLElement;
    const themeColorEditor = bindThemeColorEditor(editorPanel);
    const appearanceElement = dialog.element.querySelector('[data-field="appearance"]') as HTMLSelectElement;

    const renderList = () => {
        listElement.innerHTML = draft.map((color, index) => {
            const used = usedIndexes.has(color.index);
            return `<div class="b3-list-item b3-list-item--narrow" data-index="${index}">
    <span class="color__square color__square--list" style="${getAVColorStyle({
        color: color.index.toString(),
        resolvedColor: color,
    })}">A</span>
    <span class="b3-list-item__text">${window.siyuan.languages.color} ${color.index}</span>
    <span class="b3-list-item__action ariaLabel" data-action="edit" data-index="${index}" data-position="north" aria-label="${escapeAttr(window.siyuan.languages.edit)}"><svg><use xlink:href="#iconEdit"></use></svg></span>
    <span class="b3-list-item__action b3-list-item__action--warning ariaLabel" data-action="delete" data-index="${index}" data-position="north" aria-disabled="${used}"${used ? ' style="cursor:not-allowed;opacity:.38"' : ""} aria-label="${escapeAttr(window.siyuan.languages.delete)}"><svg><use xlink:href="#iconTrashcan"></use></svg></span>
</div>`;
        }).join("");
        newElement.disabled = draft.length >= AV_CUSTOM_COLOR_LIMIT;
        buttonsElement.style.marginTop = draft.length === 0 ? "0" : "8px";
    };

    const setEditorActionMode = (editing: boolean) => {
        cancelElement.dataset.action = editing ? "cancelEdit" : "cancel";
        saveElement.dataset.action = editing ? "confirmEdit" : "save";
        saveElement.textContent = editing ? window.siyuan.languages.confirm : window.siyuan.languages.save;
    };
    const showList = () => {
        editingIndex = undefined;
        editingColorIndex = undefined;
        editorPanel.classList.add("fn__none");
        listPanel.classList.remove("fn__none");
        setEditorActionMode(false);
        renderList();
    };
    const showEditor = (index?: number) => {
        const color = typeof index === "number" ? draft[index] : undefined;
        const colorIndex = color?.index || getAvailableAVCustomColorIndex(draft);
        if (!colorIndex) {
            showMessage(window.siyuan.languages.invalid, 6000, "error");
            return;
        }
        editingIndex = index ?? -1;
        editingColorIndex = colorIndex;
        colorIndexElement.textContent = `${window.siyuan.languages.color} ${colorIndex}`;
        if (appearanceElement) {
            appearanceElement.value = "";
        }
        themeColorEditor.setValue(color, "style1");
        listPanel.classList.add("fn__none");
        editorPanel.classList.remove("fn__none");
        setEditorActionMode(true);
    };
    const confirmEditor = () => {
        const value = themeColorEditor.getValue("style1");
        const color: IAVCustomColor = {
            index: editingColorIndex,
            light: {
                color: value.light.color,
                backgroundColor: value.light.backgroundColor,
            },
            dark: {
                color: value.dark.color,
                backgroundColor: value.dark.backgroundColor,
            },
        };
        if (editingIndex >= 0) {
            draft[editingIndex] = color;
        } else {
            draft.push(color);
            draft.sort((a, b) => a.index - b.index);
        }
        showList();
    };

    appearanceElement?.addEventListener("change", () => {
        const style = appearanceStyles[parseInt(appearanceElement.value)];
        if (style) {
            themeColorEditor.setValue(style, "style1");
        }
    });

    dialog.element.addEventListener("click", event => {
        const actionElement = (event.target as HTMLElement).closest<HTMLElement>("[data-action]");
        if (!actionElement || actionElement.hasAttribute("disabled")) {
            return;
        }
        const action = actionElement.dataset.action;
        const index = parseInt(actionElement.dataset.index);
        if (action === "new") {
            showEditor();
        } else if (action === "manageBuiltin") {
            openBuiltinColorDialog("av");
        } else if (action === "edit") {
            showEditor(index);
        } else if (action === "delete") {
            const color = draft[index];
            if (!color) {
                return;
            }
            if (usedIndexes.has(color.index)) {
                showMessage(window.siyuan.languages.invalid, 6000, "error");
                return;
            }
            confirmDialog(window.siyuan.languages.deleteOpConfirm, window.siyuan.languages.confirmDelete, () => {
                draft.splice(index, 1);
                renderList();
            }, undefined, true);
        } else if (action === "cancelEdit") {
            showList();
        } else if (action === "confirmEdit") {
            confirmEditor();
        } else if (action === "cancel") {
            dialog.destroy();
        } else if (action === "save") {
            transaction(options.protyle, [{
                action: "setAttrViewCustomColors",
                avID: options.data.id,
                blockID: options.blockElement.dataset.nodeId,
                data: draft,
            }, {
                action: "doUpdateUpdated",
                id: options.blockElement.dataset.nodeId,
                data: dayjs().format("YYYYMMDDHHmmss"),
            }], [{
                action: "setAttrViewCustomColors",
                avID: options.data.id,
                blockID: options.blockElement.dataset.nodeId,
                data: originalColors,
            }], {
                callback: () => {
                    dialog.destroy();
                },
            });
        }
        event.preventDefault();
        event.stopPropagation();
    });
    renderList();
};

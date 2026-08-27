import {Dialog} from "../../../dialog";
import {confirmDialog} from "../../../dialog/confirmDialog";
import {showMessage} from "../../../dialog/message";
import {bindThemeColorEditor, getThemeColorEditorHTML} from "../../../dialog/themeColorEditor";
import {isMobile} from "../../../util/functions";
import {
    AV_CUSTOM_COLOR_LIMIT,
    getAvailableAVCustomColorIndex,
    getAVColorOrder,
    getAVColorStyle,
    getAVCustomColors,
    normalizeAVColorOrder,
} from "./color";
import {
    getInlineStylesCache,
    IInlineStyles,
    normalizeInlineStyles,
    saveWorkspaceAVPalette,
} from "../../toolbar/inlineStyle";
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
} from "../../toolbar/builtinColorDialog";

const cloneCustomColors = (colors: IAVCustomColor[]) => JSON.parse(JSON.stringify(colors)) as IAVCustomColor[];

const cloneInlineStyles = () =>
    JSON.parse(JSON.stringify(normalizeInlineStyles(getInlineStylesCache()))) as IInlineStyles;

export const openAVCustomColorDialog = (options: {
    protyle: IProtyle,
    data: IAV,
    blockElement: HTMLElement,
}) => {
    if (window.siyuan.config.readonly || window.siyuan.isPublish) {
        return;
    }
    const draft = cloneCustomColors(getAVCustomColors());
    let orderDraft = [...getAVColorOrder()];
    const builtinDraft = cloneInlineStyles();
    const modifiedBuiltinIndexes = new Set<number>();
    const usedIndexes = new Set(options.data.usedCustomColorIndexes || []);
    const properties = getProperties("av");
    let editingColorIndex: number | undefined;
    let editingBuiltinKey: string | undefined;
    let saving = false;
    const dialog = new Dialog({
        title: window.siyuan.languages.manageColors,
        width: isMobile() ? "92vw" : "600px",
        content: `<div class="b3-dialog__content" style="max-height:70vh">
    <div data-panel="list">
        <div data-type="avCustomColorList" class="b3-list b3-list--background fn__selectnone"></div>
        <div class="fn__hr" data-type="listSpacer"></div>
        <div class="fn__flex" data-type="avColorButtons">
            <button class="b3-button b3-button--outline" data-action="new" type="button">
                <svg><use xlink:href="#iconAdd"></use></svg>${window.siyuan.languages.new}
            </button>
        </div>
    </div>
    <div data-panel="customEditor" class="fn__none">
        <div class="b3-label b3-label--inner" data-field="colorIndex"></div>
        ${getThemeColorEditorHTML()}
    </div>
    <div data-panel="builtinEditor" class="fn__none">
        ${getBuiltinEditorHTML("av")}
    </div>
</div>
<div class="b3-dialog__action">
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
    const listElement = dialog.element.querySelector('[data-type="avCustomColorList"]') as HTMLElement;
    const newElement = dialog.element.querySelector('[data-action="new"]') as HTMLButtonElement;
    const resetElement = dialog.element.querySelector('[data-action="reset"]') as HTMLButtonElement;
    const cancelElement = dialog.element.querySelector('[data-action="cancel"]') as HTMLButtonElement;
    const saveElement = dialog.element.querySelector('[data-action="save"]') as HTMLButtonElement;
    const colorIndexElement = dialog.element.querySelector('[data-field="colorIndex"]') as HTMLElement;
    const themeColorEditor = bindThemeColorEditor(customEditorPanel);

    const getListKeys = () => normalizeAVColorOrder(orderDraft, draft);
    const findCustomColor = (index: number) => draft.find(item => item.index === index);
    const getBuiltinEntry = (key: string) => createBuiltinDialogEntry("av", Number(key), builtinDraft);
    const writeBuiltinDraft = (entry: ReturnType<typeof createBuiltinDialogEntry>) => {
        writeBuiltinEntry(builtinDraft, "av", entry);
        modifiedBuiltinIndexes.add(Number(entry.key));
    };

    const builtinEditor = bindBuiltinEditor(builtinEditorPanel, "av", () =>
        editingBuiltinKey ? getBuiltinEntry(editingBuiltinKey) : undefined);

    const renderList = () => {
        const keys = getListKeys();
        listElement.innerHTML = keys.map((key, index) => {
            const colorIndex = Number(key);
            const custom = findCustomColor(colorIndex);
            if (custom) {
                return getColorListItemHTML({
                    kind: "custom",
                    key,
                    index,
                    label: `${window.siyuan.languages.color} ${custom.index}`,
                    previewStyle: getAVColorStyle({
                        color: custom.index.toString(),
                        resolvedColor: custom,
                    }),
                    show: !custom.hidden,
                    canDelete: true,
                });
            }
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
        }).join("");
        listElement.querySelectorAll<HTMLElement>('[data-kind="builtin"][data-key]').forEach(item => {
            const preview = item.querySelector('[data-role="preview"]') as HTMLElement;
            if (preview) {
                applyPreviewStyle("av", preview, getBuiltinEntry(item.dataset.key));
            }
        });
        newElement.disabled = draft.length >= AV_CUSTOM_COLOR_LIMIT;
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
        editingColorIndex = undefined;
        editingBuiltinKey = undefined;
        setEditorActionMode("list");
        renderList();
    };

    const showCustomEditor = (colorIndex?: number) => {
        const color = typeof colorIndex === "number" ? findCustomColor(colorIndex) : undefined;
        const nextIndex = color?.index || getAvailableAVCustomColorIndex(draft);
        if (!nextIndex) {
            showMessage(window.siyuan.languages.invalid, 6000, "error");
            return;
        }
        editingColorIndex = nextIndex;
        editingBuiltinKey = undefined;
        colorIndexElement.textContent = `${window.siyuan.languages.color} ${nextIndex}`;
        themeColorEditor.setValue(color, "style1");
        setEditorActionMode("custom");
    };

    const showBuiltinEditor = (key: string) => {
        editingBuiltinKey = key;
        editingColorIndex = undefined;
        builtinEditor.fill(getBuiltinEntry(key));
        setEditorActionMode("builtin");
    };

    const confirmEditor = () => {
        if (editingBuiltinKey) {
            writeBuiltinDraft(builtinEditor.commit(getBuiltinEntry(editingBuiltinKey)));
            showList();
            return;
        }
        if (typeof editingColorIndex !== "number") {
            return;
        }
        const value = themeColorEditor.getValue("style1");
        const previous = findCustomColor(editingColorIndex);
        const color: IAVCustomColor = {
            index: editingColorIndex,
            hidden: previous?.hidden,
            light: {
                color: value.light.color,
                backgroundColor: value.light.backgroundColor,
            },
            dark: {
                color: value.dark.color,
                backgroundColor: value.dark.backgroundColor,
            },
        };
        if (previous) {
            draft[draft.indexOf(previous)] = color;
        } else {
            draft.push(color);
            if (!orderDraft.includes(color.index.toString())) {
                orderDraft.push(color.index.toString());
            }
        }
        showList();
    };

    bindColorListDrag(listElement, getListKeys, keys => {
        orderDraft = keys;
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
            writeBuiltinDraft(entry);
            itemElement.querySelector('[data-action="resetItem"]')?.classList.toggle("fn__none", isEntryDefault(entry, properties));
            return;
        }
        const color = findCustomColor(Number(itemElement.dataset.key));
        if (color) {
            color.hidden = !switchElement.checked;
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
        const itemElement = actionElement.closest<HTMLElement>(".b3-list-item");
        const key = itemElement?.dataset.key;
        if (action === "new") {
            showCustomEditor();
        } else if (action === "edit") {
            if (itemElement?.dataset.kind === "builtin" && key) {
                showBuiltinEditor(key);
            } else if (itemElement?.dataset.kind === "custom" && key) {
                showCustomEditor(Number(key));
            }
        } else if (action === "resetItem" && key) {
            const entry = getBuiltinEntry(key);
            resetEntry(entry, properties);
            writeBuiltinDraft(entry);
            renderList();
        } else if (action === "reset") {
            if (editingBuiltinKey) {
                const entry = getBuiltinEntry(editingBuiltinKey);
                resetEntry(entry, properties);
                writeBuiltinDraft(entry);
                showBuiltinEditor(editingBuiltinKey);
            }
        } else if (action === "delete" && key) {
            const color = findCustomColor(Number(key));
            if (!color) {
                return;
            }
            if (usedIndexes.has(color.index)) {
                showMessage(window.siyuan.languages.invalid, 6000, "error");
                return;
            }
            confirmDialog(window.siyuan.languages.deleteOpConfirm, window.siyuan.languages.confirmDelete, () => {
                draft.splice(draft.indexOf(color), 1);
                orderDraft = orderDraft.filter(item => item !== key);
                renderList();
            }, undefined, true);
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
                builtinDraft.av = {
                    colors: cloneCustomColors(draft),
                    order: normalizeAVColorOrder(orderDraft, draft),
                };
                const response = await saveWorkspaceAVPalette(builtinDraft.av,
                    Array.from(modifiedBuiltinIndexes).map(index => {
                        const color = builtinDraft.builtin.colors.find(item => item.index === index);
                        return {
                            index,
                            customized: !!color,
                            light: color?.light || {},
                            dark: color?.dark || {},
                            hidden: builtinDraft.builtin.hidden.av.includes(index),
                        };
                    }));
                if (response?.code !== 0) {
                    showMessage(response?.msg || window.siyuan.languages.invalid, 6000, "error");
                    saving = false;
                    actionElement.removeAttribute("disabled");
                    return;
                }
                options.data.customColors = cloneCustomColors(getInlineStylesCache().av.colors);
                options.data.colorOrder = [...getInlineStylesCache().av.order];
                void import("../../../util/assets").then(module => module.setInlineStyle());
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

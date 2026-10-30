import {Constants} from "../../../constants";
import {Dialog} from "../../../dialog";
import {fetchSyncPost} from "../../../util/fetch";
import {escapeAttr, escapeHtml} from "../../../util/escape";
import {transaction} from "../../wysiwyg/transaction";
import {getAVData} from "./virtualScroll";
import {getFieldsByData} from "./view";
import {insertRows} from "./row";
import {registerSubItemsCleanup, toggleSubItems} from "./subItemsState";
import type {Menu} from "../../../plugin/Menu";
import {showMessage} from "../../../dialog/message";
import {isMobile} from "../../../util/functions";
import {bindBottomSheetDialog} from "../../../mobile/util/bindBottomSheetDialog";
import {beginAVEditorSession} from "./editorSession";
import {getAVFilteredTipContext} from "./filteredTip";
import {getSubItemsInitialParentKey, getSubItemsRelationPairs, getSubItemsRelationPreview} from "./subItemsRelationPreview";
import type {ISubItemsRelationPair} from "./subItemsRelationPreview";

const operationContext = (blockElement: HTMLElement) => ({
    avID: blockElement.dataset.avId,
    blockID: blockElement.dataset.nodeId,
    viewID: blockElement.getAttribute(Constants.CUSTOM_SY_AV_VIEW) || "",
});

const editable = (protyle: IProtyle, blockElement: HTMLElement) => !protyle.disabled &&
    !window.siyuan.isPublish && !protyle.options.history && blockElement.isConnected;

export const reparentSubItems = (protyle: IProtyle, blockElement: HTMLElement, srcIDs: string[], parentID: string,
                               previousID?: string, nextID?: string, groupID?: string) => {
    if (!editable(protyle, blockElement)) {
        return;
    }
    const operation: IOperation = {action: "reparentAttrViewItems", ...operationContext(blockElement),
        srcIDs: [...new Set(srcIDs)], parentID, previousID, nextID, groupID, context: getAVFilteredTipContext("target", protyle)};
    transaction(protyle, [operation], [{...operation}]);
};

const openParentPicker = (protyle: IProtyle, blockElement: HTMLElement, srcIDs: string[], groupID: string) => {
    const data = getAVData(blockElement);
    if (!data?.subItems?.enabled || !editable(protyle, blockElement)) {
        return;
    }
    let request = 0;
    let page = 1;
    let controller: AbortController;
    let disposeSheet: () => void;
    const context = operationContext(blockElement);
    const endSession = beginAVEditorSession(blockElement);
    const valid = () => editable(protyle, blockElement) && blockElement.dataset.avId === context.avID && blockElement.dataset.nodeId === context.blockID &&
        blockElement.getAttribute(Constants.CUSTOM_SY_AV_VIEW) === context.viewID;
    const dialog = new Dialog({title: window.siyuan.languages.avChangeParent, width: isMobile() ? "100vw" : "480px",
        content: `<div class="b3-dialog__content"><input class="b3-text-field fn__block" aria-label="${window.siyuan.languages.search}" placeholder="${window.siyuan.languages.search}"><div class="fn__hr"></div><div data-results></div><button class="b3-button fn__block" data-more>${window.siyuan.languages.loadMore}</button></div>`,
        destroyCallback: () => {
            request++;
            controller?.abort();
            observer?.disconnect();
            disposeSheet?.();
            untrack?.();
            endSession();
        }});
    const untrack = registerSubItemsCleanup(blockElement, () => dialog.destroy());
    const observer = new MutationObserver(() => { if (!valid()) dialog.destroy(); });
    observer.observe(protyle.element, {childList: true, subtree: true});
    observer.observe(blockElement, {attributes: true, attributeFilter: ["data-av-id", "data-node-id", Constants.CUSTOM_SY_AV_VIEW]});
    if (isMobile()) {
        disposeSheet = bindBottomSheetDialog(dialog, async () => { dialog.destroy(); });
    }
    const input = dialog.element.querySelector("input");
    const results = dialog.element.querySelector<HTMLElement>("[data-results]");
    const more = dialog.element.querySelector<HTMLButtonElement>("[data-more]");
    const load = async (append: boolean) => {
        if (!valid()) {
            dialog.destroy();
            return;
        }
        controller?.abort();
        controller = new AbortController();
        const token = ++request;
        const requestedPage = append ? page + 1 : 1;
        more.disabled = true;
        try {
            const response = await fetchSyncPost("/api/av/getAttributeViewRelationCandidates", {
                ...context, keyID: data.subItems.parentKeyID, excludeItemIDs: srcIDs,
                keyword: input.value, page: requestedPage, pageSize: 50,
            }, undefined, true, controller.signal);
            if (token !== request || !dialog.element.isConnected || !valid() || response.code !== 0) {
                return;
            }
            const html = response.data.rows.map(row => {
                const cell = row.cells.find(value => value.valueType === "block");
                return `<button class="b3-menu__item" data-parent="${escapeAttr(row.id)}"><span class="b3-menu__label">${escapeHtml(cell?.value?.block?.content || row.id)}</span></button>`;
            }).join("");
            page = requestedPage;
            if (append) {
                results.insertAdjacentHTML("beforeend", html);
            } else {
                results.innerHTML = `<button class="b3-menu__item" data-parent=""><span class="b3-menu__label">${window.siyuan.languages.avMakeRoot}</span></button>${html}`;
            }
            more.classList.toggle("fn__none", page * 50 >= response.data.total);
        } catch (error) {
            if (token === request && !controller.signal.aborted) {
                showMessage(escapeHtml(error.message), 6000, "error");
            }
        } finally {
            if (token === request) more.disabled = false;
        }
    };
    input.addEventListener("input", () => { page = 1; void load(false); });
    more.addEventListener("click", () => { void load(true); });
    results.addEventListener("click", event => {
        const target = (event.target as Element).closest<HTMLElement>("[data-parent]");
        if (target && valid()) {
            reparentSubItems(protyle, blockElement, srcIDs, target.dataset.parent, undefined, undefined, groupID);
            dialog.destroy();
        }
    });
    void load(false);
    if (!isMobile()) input.focus();
};

export const addSubItemsMenu = (menu: Menu, protyle: IProtyle, blockElement: HTMLElement,
                              itemIDs: string[], groupID = "") => {
    if (!blockElement.hasAttribute("data-sub-items") || !itemIDs.length) {
        return;
    }
    if (itemIDs.length === 1) {
        menu.addItem({id: "avAddSubItem", icon: "iconAdd", label: window.siyuan.languages.avAddSubItem, click: () => {
            if (!editable(protyle, blockElement)) return;
            toggleSubItems(blockElement, protyle, groupID, itemIDs[0], true);
            insertRows({protyle, blockElement, count: 1, previousID: "", parentID: itemIDs[0], groupID});
        }});
    }
    menu.addItem({id: "avChangeParent", icon: "iconMove", label: window.siyuan.languages.avChangeParent,
        click: () => openParentPicker(protyle, blockElement, itemIDs, groupID)});
    menu.addItem({id: "avPromoteSubItem", icon: "iconUp", label: window.siyuan.languages.avPromoteSubItem, click: () => {
        if (!editable(protyle, blockElement)) return;
        const operation: IOperation = {action: "promoteAttrViewItems", ...operationContext(blockElement), srcIDs: itemIDs, groupID,
            context: getAVFilteredTipContext("target", protyle)};
        transaction(protyle, [operation], [{...operation}]);
    }});
    menu.addItem({id: "avMakeRoot", icon: "iconUp", label: window.siyuan.languages.avMakeRoot,
        click: () => reparentSubItems(protyle, blockElement, itemIDs, "", undefined, undefined, groupID)});
};

export const getSubItemsSettingsHTML = (data: IAV, existing = false) => {
    const enabled = Boolean(data.subItems?.enabled);
    const pairs = getSubItemsRelationPairs(getFieldsByData(data) || [], data.id);
    const currentDisplay = data.views?.find(view => view.id === data.viewID)?.subItemsDisplay || "flat";
    const enableHTML = `<button class="b3-menu__item" data-sub-items-enabled="${!enabled}"${existing ? " disabled" : ""}><span class="b3-menu__label">${window.siyuan.languages[enabled ? "avDisableSubItems" : "avEnableSubItems"]}</span></button>`;
    const choicesHTML = pairs.map(pair => `<button class="b3-menu__item" data-sub-items-pair="${escapeAttr(pair.id)}" aria-pressed="false"><span class="b3-menu__label">${escapeHtml(pair.first.name)} / ${escapeHtml(pair.second.name)}</span><svg class="b3-menu__checked fn__none"><use xlink:href="#iconSelect"></use></svg></button>`).join("");
    return `<div class="b3-menu__items">
<button class="b3-menu__item" data-type="nobg">
    <span class="block__icon block__icon--menu-back" data-type="${existing ? "go-sub-items" : "go-config"}"><svg><use xlink:href="#iconLeft"></use></svg></span>
    <span class="b3-menu__label ft__center">${window.siyuan.languages[existing ? "avSubItemsExistingFields" : "avSubItems"]}</span>
</button>
<button class="b3-menu__separator"></button>
${existing ? `<div class="b3-menu__item b3-menu__item--readonly"><span class="b3-menu__label ft__on-surface fn__flex"><span class="fn__flex-center">${window.siyuan.languages.avSubItemsParentFieldTip}</span></span></div>
${choicesHTML}<div data-sub-items-preview class="fn__none"></div><button class="b3-menu__separator"></button>${enableHTML}` : `${enableHTML}
${!enabled && pairs.length ? `<button class="b3-menu__item" data-type="go-sub-items-existing"><span class="b3-menu__label">${window.siyuan.languages.avSubItemsExistingFields}</span><svg class="b3-menu__icon b3-menu__icon--small"><use xlink:href="#iconRight"></use></svg></button>` : ""}
${enabled && (data.viewType === "table" || data.viewType === "list") ? ["flat", "nested"].map(display => `<button class="b3-menu__item" data-sub-items-display="${display}"><span class="b3-menu__label">${window.siyuan.languages[display === "nested" ? "avNestedDisplay" : "avFlatDisplay"]}</span>${currentDisplay === display ? '<svg class="b3-menu__checked"><use xlink:href="#iconSelect"></use></svg>' : ""}</button>`).join("") : ""}`}
</div>`;
};

export const bindSubItemsSettings = (menuElement: HTMLElement, protyle: IProtyle, blockElement: HTMLElement, data: IAV, existing = false, onResize?: () => void) => {
    if (protyle.disabled || window.siyuan.isPublish || protyle.options.history) {
        menuElement.querySelectorAll<HTMLButtonElement>("button:not([data-type=nobg])").forEach(button => { button.disabled = true; });
        return;
    }
    const fields = getFieldsByData(data) || [];
    const pairs = getSubItemsRelationPairs(fields, data.id);
    let selectedPair: ISubItemsRelationPair;
    let parentKeyID: string;
    const enableButton = menuElement.querySelector<HTMLButtonElement>("[data-sub-items-enabled]");
    const choices = menuElement.querySelectorAll<HTMLButtonElement>("[data-sub-items-pair]");
    const canEdit = () => editable(protyle, blockElement) && blockElement.dataset.avId === data.id;
    const previewData = () => {
        const cached = getAVData(blockElement);
        return cached?.id === data.id && cached.viewID === data.viewID ? cached : data;
    };
    const updatePreview = () => {
        const preview = getSubItemsRelationPreview(previewData(), selectedPair, parentKeyID);
        const element = menuElement.querySelector<HTMLElement>("[data-sub-items-preview]");
        const direction = window.siyuan.languages.avSubItemsRelationDirection
            .replace(/\$\{(?:parent|children)\}/g, (token: string) => token === "${parent}" ? preview.parentField.name : preview.childrenField.name);
        element.innerHTML = `<button class="b3-menu__separator"></button>
<div class="b3-menu__item" data-type="nobg"><span class="b3-menu__label">${window.siyuan.languages.avSubItemsPreview}</span><button class="block__icon" data-sub-items-reverse>${window.siyuan.languages.avSubItemsReverse}</button></div>
<div class="b3-menu__item b3-menu__item--readonly"><div class="b3-menu__label av__sub-items-preview">${preview.examples.length ? preview.examples.map(example => `<div><div class="fn__ellipsis" title="${escapeAttr(example.title)}">${escapeHtml(example.title)}</div><div class="av__sub-items-preview-children">${example.children.map(child => `<div class="fn__ellipsis" title="${escapeAttr(child)}">${escapeHtml(child)}</div>`).join("")}</div></div>`).join("") : window.siyuan.languages.avSubItemsPreviewEmpty}</div></div>
<div class="b3-menu__item b3-menu__item--readonly"><span class="b3-menu__label ft__on-surface fn__flex"><span class="fn__flex-center">${escapeHtml(direction)}</span></span></div>
${preview.multipleParents ? `<div class="b3-menu__item b3-menu__item--readonly"><span class="b3-menu__label ft__error">${window.siyuan.languages.avSubItemsPreviewInvalid}</span></div>` : ""}`;
        element.classList.remove("fn__none");
        enableButton.disabled = preview.multipleParents;
        element.querySelector<HTMLButtonElement>("[data-sub-items-reverse]").onclick = event => {
            event.preventDefault();
            event.stopPropagation();
            if (!canEdit()) return;
            parentKeyID = parentKeyID === selectedPair.first.id ? selectedPair.second.id : selectedPair.first.id;
            updatePreview();
        };
        onResize?.();
    };
    choices.forEach(button => {
        button.onclick = event => {
            event.preventDefault();
            event.stopPropagation();
            if (!canEdit()) return;
            selectedPair = pairs.find(pair => pair.id === button.dataset.subItemsPair);
            if (!selectedPair) return;
            parentKeyID = getSubItemsInitialParentKey(previewData(), selectedPair, data.subItems?.parentKeyID);
            choices.forEach(choice => {
                const selected = choice.dataset.subItemsPair === selectedPair.id;
                choice.setAttribute("aria-pressed", String(selected));
                choice.querySelector(".b3-menu__checked").classList.toggle("fn__none", !selected);
            });
            updatePreview();
        };
    });
    enableButton.onclick = () => {
        if (!canEdit() || enableButton.disabled || existing && !parentKeyID) return;
        const parent = fields.find(field => field.id === parentKeyID);
        const operation: IOperation = {action: "setAttrViewSubItems", ...operationContext(blockElement), data: {
            enabled: !data.subItems?.enabled, parentKeyID, childrenKeyID: parent?.relation?.backKeyID,
            parentName: window.siyuan.languages.avParentItem, childrenName: window.siyuan.languages.avChildItems,
        }};
        transaction(protyle, [operation], [{...operation}]);
        menuElement.closest(".av__panel")?.remove();
    };
    menuElement.querySelectorAll<HTMLButtonElement>("[data-sub-items-display]").forEach(button => {
        button.onclick = () => {
            if (!editable(protyle, blockElement)) return;
            const operation: IOperation = {action: "setAttrViewSubItemsDisplay", ...operationContext(blockElement),
                data: button.dataset.subItemsDisplay === "nested" ? "nested" : "flat"};
            transaction(protyle, [operation], [{...operation}]);
            menuElement.closest(".av__panel")?.remove();
        };
    });
};

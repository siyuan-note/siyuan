import {fetchPost} from "../util/fetch";
import {focusByRange} from "../protyle/util/selection";
import {Dialog} from "../dialog";
import {isMobile} from "../util/functions";
import {Constants} from "../constants";
import {escapeAriaLabel, escapeAttr, escapeHtml} from "../util/escape";
import {showMessage} from "../dialog/message";
import {Menu} from "../plugin/Menu";
import {upDownHint} from "../util/upDownHint";
import {clearAIEditorHistory, startAIEditorAction} from "./editor";

interface IAIEditorAction {
    id: string;
    name: string;
    action: string;
}

const editDialog = (item: IAIEditorAction) => {
    const dialog = new Dialog({
        title: window.siyuan.languages.update,
        content: `<div class="b3-dialog__content">
    <input class="b3-text-field fn__block" placeholder="${window.siyuan.languages.memo}">
    <div class="fn__hr"></div>
    <textarea class="b3-text-field fn__block" placeholder="${window.siyuan.languages.aiCustomAction}"></textarea>
</div>
<div class="b3-dialog__action">
    <button class="b3-button b3-button--remove">${window.siyuan.languages.delete}</button><div class="fn__space"></div>
    <button class="b3-button b3-button--cancel">${window.siyuan.languages.cancel}</button><div class="fn__space"></div>
    <button class="b3-button b3-button--text">${window.siyuan.languages.confirm}</button>
</div>`,
        width: isMobile() ? "92vw" : "520px",
    });
    dialog.element.setAttribute("data-key", Constants.DIALOG_AIUPDATECUSTOMACTION);
    const nameElement = dialog.element.querySelector("input");
    nameElement.value = item.name;
    const customElement = dialog.element.querySelector("textarea");
    const btnsElement = dialog.element.querySelectorAll(".b3-button");
    dialog.bindInput(customElement, () => {
        (btnsElement[2] as HTMLButtonElement).click();
    });
    customElement.value = item.action;
    btnsElement[1].addEventListener("click", () => {
        dialog.destroy();
    });
    btnsElement[2].addEventListener("click", () => {
        if (!nameElement.value && !customElement.value) {
            showMessage(window.siyuan.languages["_kernel"][142]);
            return;
        }
        fetchPost("/api/ai/editor/saveAction", {
            id: item.id,
            name: nameElement.value,
            action: customElement.value,
        }, () => {
            dialog.destroy();
        });
    });
    btnsElement[0].addEventListener("click", () => {
        fetchPost("/api/ai/editor/removeAction", {id: item.id}, () => {
            dialog.destroy();
        });
    });
    nameElement.focus();
};

const customDialog = (protyle: IProtyle, elements: HTMLElement[], range?: Range) => {
    const dialog = new Dialog({
        title: window.siyuan.languages.aiCustomAction,
        content: `<div class="b3-dialog__content">
    <input class="b3-text-field fn__block" value="" placeholder="${window.siyuan.languages.memo}">
    <div class="fn__hr"></div>
    <textarea class="b3-text-field fn__block" placeholder="${window.siyuan.languages.aiCustomAction}"></textarea>
</div>
<div class="b3-dialog__action">
    <button class="b3-button b3-button--cancel">${window.siyuan.languages.cancel}</button><div class="fn__space"></div>
    <button class="b3-button b3-button--text">${window.siyuan.languages.use}</button><div class="fn__space"></div>
    <button class="b3-button b3-button--text">${window.siyuan.languages.save}</button>
</div>`,
        width: isMobile() ? "92vw" : "520px",
    });
    dialog.element.setAttribute("data-key", Constants.DIALOG_AICUSTOMACTION);
    const nameElement = dialog.element.querySelector("input");
    const customElement = dialog.element.querySelector("textarea");
    const btnsElement = dialog.element.querySelectorAll(".b3-button");
    dialog.bindInput(customElement, () => {
        (btnsElement[1] as HTMLButtonElement).click();
    });
    btnsElement[0].addEventListener("click", () => {
        dialog.destroy();
    });
    btnsElement[1].addEventListener("click", () => {
        if (!customElement.value) {
            showMessage(window.siyuan.languages["_kernel"][142]);
            return;
        }
        dialog.destroy();
        startAIEditorAction(protyle, elements, range, customElement.value);
    });
    btnsElement[2].addEventListener("click", () => {
        if (!nameElement.value && !customElement.value) {
            showMessage(window.siyuan.languages["_kernel"][142]);
            return;
        }
        fetchPost("/api/ai/editor/saveAction", {
            name: nameElement.value,
            action: customElement.value,
        }, () => {
            dialog.destroy();
        });
    });
    nameElement.focus();
};

const filterAI = (element: HTMLElement, inputElement: HTMLInputElement) => {
    element.querySelectorAll(".b3-list-item").forEach(item => {
        if (item.textContent.indexOf(inputElement.value) > -1) {
            item.classList.remove("fn__none");
        } else {
            item.classList.add("fn__none");
        }
    });
    element.querySelectorAll(".b3-menu__separator").forEach(item => {
        if (inputElement.value) {
            item.classList.add("fn__none");
        } else {
            item.classList.remove("fn__none");
        }
    });
    element.querySelector(".b3-list-item--focus")?.classList.remove("b3-list-item--focus");
    element.querySelector(".b3-list-item:not(.fn__none)")?.classList.add("b3-list-item--focus");
};

const openAIActions = (actions: IAIEditorAction[], elements: HTMLElement[], protyle: IProtyle, range?: Range) => {
    window.siyuan.menus.menu.remove();
    const menu = new Menu(Constants.MENU_AI, () => {
        if (protyle.toolbar.range) {
            focusByRange(protyle.toolbar.range);
        }
    });
    let customHTML = "";
    actions.forEach((item) => {
        customHTML += `<div data-type="saved" data-id="${escapeAttr(item.id)}" data-position="10west" class="b3-list-item b3-list-item--narrow ariaLabel" aria-label="${escapeAriaLabel(item.action)}">
    <span class="b3-list-item__text">${escapeHtml(item.name)}</span>
    <span data-type="edit" class="b3-list-item__action"><svg><use xlink:href="#iconEdit"></use></svg></span>
</div>`;
    });
    if (customHTML) {
        customHTML = `<div class="b3-menu__separator"></div>${customHTML}`;
    }
    const clearContext = "Clear context";
    menu.addItem({
        iconHTML: "",
        type: "empty",
        label: `<div class="fn__flex-column b3-menu__filter">
    <input class="b3-text-field fn__flex-shrink"/>
    <div class="fn__hr"></div>
    <div class="b3-list fn__flex-1 b3-list--background">
       <div class="b3-list-item b3-list-item--narrow b3-list-item--focus" data-action="Continue writing">
            ${window.siyuan.languages.aiContinueWrite}
        </div>
        <div class="b3-menu__separator"></div>
        <div class="b3-list-item b3-list-item--narrow" data-action="${window.siyuan.languages.aiExtractSummary}">
            ${window.siyuan.languages.aiExtractSummary}
        </div>
        <div class="b3-list-item b3-list-item--narrow" data-action="${window.siyuan.languages.aiBrainStorm}">
            ${window.siyuan.languages.aiBrainStorm}
        </div>
        <div class="b3-list-item b3-list-item--narrow" data-action="${window.siyuan.languages.aiFixGrammarSpell}">
            ${window.siyuan.languages.aiFixGrammarSpell}
        </div>
        <div class="b3-list-item b3-list-item--narrow" data-action="${clearContext}">
            ${window.siyuan.languages.clearContext}
        </div>
        <div class="b3-menu__separator"></div>
        <div class="b3-list-item b3-list-item--narrow" data-type="custom">
            ${window.siyuan.languages.aiCustomAction}
        </div>
        ${customHTML}
    </div>
</div>`,
        bind(element) {
            /// #if MOBILE
            element.setAttribute("style", "height: 100%;padding: 0 16px;");
            element.querySelectorAll(".b3-menu__separator").forEach(item => {
                item.remove();
            });
            /// #endif
            const listElement = element.querySelector(".b3-list");
            const inputElement = element.querySelector("input");
            const runAction = (itemElement: HTMLElement) => {
                let action = itemElement.dataset.action;
                if (itemElement.dataset.type === "saved") {
                    const item = actions.find((currentItem) => currentItem.id === itemElement.dataset.id);
                    action = item?.action || item?.name;
                }
                if (typeof action !== "string") {
                    return;
                }
                if (action === clearContext) {
                    clearAIEditorHistory(protyle);
                    showMessage(window.siyuan.languages.clearContextSucc);
                } else {
                    menu.close();
                    startAIEditorAction(protyle, elements, range, action);
                }
            };
            inputElement.addEventListener("keydown", (event: KeyboardEvent) => {
                if (event.isComposing) {
                    return;
                }
                const currentElement = upDownHint(listElement, event);
                if (currentElement) {
                    event.stopPropagation();
                }
                if (event.key === "Enter") {
                    event.preventDefault();
                    event.stopPropagation();
                    const currentElement = listElement.querySelector(".b3-list-item--focus") as HTMLElement;
                    if (!currentElement) {
                        return;
                    }
                    if (currentElement.dataset.type === "custom") {
                        customDialog(protyle, elements, range);
                        menu.close();
                    } else {
                        runAction(currentElement);
                    }
                }
            });
            inputElement.addEventListener("compositionend", () => {
                filterAI(element, inputElement);
            });
            inputElement.addEventListener("input", (event: KeyboardEvent) => {
                if (event.isComposing) {
                    return;
                }
                filterAI(element, inputElement);
            });
            element.addEventListener("click", (event) => {
                let target = event.target as HTMLElement;
                while (target && (target !== element)) {
                    if (target.classList.contains("b3-list-item__action")) {
                        const subItem = actions.find((item) => item.id === target.parentElement.dataset.id);
                        if (subItem) {
                            editDialog(subItem);
                        }
                        menu.close();
                        event.stopPropagation();
                        event.preventDefault();
                        break;
                    } else if (target.classList.contains("b3-list-item")) {
                        if (target.dataset.type === "custom") {
                            customDialog(protyle, elements, range);
                            menu.close();
                        } else {
                            runAction(target);
                        }
                        event.stopPropagation();
                        event.preventDefault();
                        break;
                    }
                    target = target.parentElement;
                }
            });
        }
    });
    menu.element.querySelector(".b3-menu__items").setAttribute("style", "overflow: initial");
    /// #if MOBILE
    menu.fullscreen();
    /// #else
    const rect = elements[elements.length - 1]?.getBoundingClientRect() || range?.getBoundingClientRect() ||
        protyle.element.getBoundingClientRect();
    menu.open({
        x: rect.left,
        y: rect.bottom,
        h: rect.height,
    });
    menu.element.querySelector("input").focus();
    /// #endif
};

let aiActionsRequestID = 0;

export const AIActions = (elements: Element[], protyle: IProtyle, range?: Range) => {
    window.siyuan.menus.menu.remove();
    const sourceElements = elements.filter((item): item is HTMLElement => item instanceof HTMLElement);
    const sourceRange = range?.cloneRange();
    if (sourceRange) {
        protyle.toolbar.range = sourceRange;
    }
    const requestID = ++aiActionsRequestID;
    fetchPost("/api/ai/editor/lsActions", {}, (response) => {
        if (requestID !== aiActionsRequestID ||
            (sourceElements.length > 0 && !sourceElements[sourceElements.length - 1].isConnected) ||
            (sourceRange && (!protyle.wysiwyg.element.contains(sourceRange.startContainer) ||
                !protyle.wysiwyg.element.contains(sourceRange.endContainer)))) {
            return;
        }
        openAIActions(Array.isArray(response.data) ? response.data : [], sourceElements, protyle, sourceRange);
    });
};

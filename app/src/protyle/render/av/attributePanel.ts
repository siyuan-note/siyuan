import {renderAVAttribute} from "./blockAttr";
import {
    cancelHeightAnimation,
    collapseHeight,
    expandHeight,
    isHeightAnimating
} from "../../../util/heightAnimation";
import {transaction} from "../../wysiwyg/transaction";

const updateEmptyState = (element: HTMLElement, hideEmpty: boolean) => {
    element.classList.toggle("protyle-db-attr--hide-empty", hideEmpty);
};

const refreshActions = new Set<TOperation>([
    "addAttrViewCol",
    "removeAttrViewCol",
    "updateAttrViewCol",
    "sortAttrViewKey",
    "duplicateAttrViewKey",
    "setAttrViewColIcon",
    "setAttrViewColDesc",
    "setAttrViewName",
    "setAttrViewCustomColors",
    "updateAttrViewColTemplate",
    "updateAttrViewColNumberFormat",
    "setAttrViewColDateFormat",
]);

export class AVAttributePanel {
    public element: HTMLElement;
    private bodyElement: HTMLElement;
    private protyle: IProtyle;
    private targetID = "";
    private renderToken = 0;
    private renderingTargetID = "";
    private collapsed: boolean;
    private activeAvID = "";
    private showEmptyFields = false;
    private suppressTabClick = false;
    private renderCallbacks: ((element: HTMLElement) => void)[] = [];
    private refreshTimeout?: ReturnType<typeof setTimeout>;

    constructor(protyle: IProtyle) {
        this.protyle = protyle;
        this.collapsed = window.siyuan.config.editor.databaseAttrViewMode === 1;
        this.element = document.createElement("div");
        this.element.className = "protyle-db-attr fn__none";
        this.element.innerHTML = `<div class="protyle-db-attr__header fn__flex">
    <button type="button" class="protyle-db-attr__toggle fn__flex fn__flex-1" data-type="toggle" aria-expanded="${!this.collapsed}" aria-label="${window.siyuan.languages.database}">
        <span class="block__icon block__icon--show fn__flex-center"><svg><use xlink:href="#iconRight"></use></svg></span>
        <span class="block__logo fn__flex-1">${window.siyuan.languages.database}</span>
    </button>
    <button type="button" class="protyle-db-attr__edit block__icon block__icon--show ariaLabel fn__none" data-position="4west" data-type="toggle-empty" aria-label="${window.siyuan.languages.displayEmptyFields}"><svg><use xlink:href="#iconEdit"></use></svg></button>
</div>`;
        this.bodyElement = document.createElement("div");
        this.bodyElement.className = "custom-attr protyle-db-attr__body";
        this.element.appendChild(this.bodyElement);
        this.element.addEventListener("click", (event) => {
            const target = event.target as HTMLElement;
            if (target.closest('[data-type="toggle-empty"]')) {
                this.showEmptyFields = !this.showEmptyFields;
                this.updateEmptyState();
                event.preventDefault();
                event.stopPropagation();
            } else if (target.closest('[data-type="av-tab"]')) {
                if (this.suppressTabClick) {
                    event.preventDefault();
                    event.stopPropagation();
                    return;
                }
                this.activeAvID = (target.closest('[data-type="av-tab"]') as HTMLElement).dataset.id || "";
                this.updateTabs();
                event.preventDefault();
                event.stopPropagation();
            } else if (target.closest('[data-type="toggle"]')) {
                this.toggle();
                event.preventDefault();
                event.stopPropagation();
            }
        });
        this.updateCollapsedState();
        this.updateEmptyState();
    }

    public render(force = false) {
        if (!window.siyuan.config.editor.databaseAttrShow) {
            this.hideByDisplayConfig();
            return;
        }
        const targetID = this.protyle.block.showAll ? this.protyle.block.id : this.protyle.block.rootID;
        if (!targetID || (!force && targetID === this.targetID &&
            (this.element.dataset.rendered === "true" || this.renderingTargetID === targetID))) {
            return;
        }
        if (targetID !== this.targetID) {
            this.showEmptyFields = false;
        }
        const currentBodyElement = this.bodyElement;
        const keepCurrentBody = force && targetID === this.targetID;
        this.targetID = targetID;
        this.element.dataset.nodeId = targetID;
        if (!keepCurrentBody) {
            this.element.removeAttribute("data-rendered");
        }
        const token = ++this.renderToken;
        this.renderingTargetID = targetID;
        const bodyElement = document.createElement("div");
        bodyElement.className = "custom-attr protyle-db-attr__body";
        if (!keepCurrentBody) {
            this.updateCollapsedState();
            currentBodyElement.replaceWith(bodyElement);
            this.bodyElement = bodyElement;
        }
        renderAVAttribute(bodyElement, targetID, this.protyle, (renderedElement) => {
            if (token !== this.renderToken) {
                return;
            }
            this.renderingTargetID = "";
            if (keepCurrentBody) {
                this.updateCollapsedState();
                currentBodyElement.replaceWith(renderedElement);
                this.bodyElement = renderedElement;
            }
            this.element.dataset.rendered = "true";
            this.updateTabs();
            this.updateEmptyState();
            this.element.classList.toggle("fn__none", !renderedElement.querySelector("[data-av-id], .custom-attr__avbacklinks"));
            const callbacks = this.renderCallbacks.splice(0);
            callbacks.forEach(callback => callback(this.bodyElement));
        });
    }

    public afterRender(callback: (element: HTMLElement) => void) {
        if (!window.siyuan.config.editor.databaseAttrShow) {
            return;
        }
        if (this.element.dataset.rendered === "true" && !this.renderingTargetID) {
            callback(this.bodyElement);
            return;
        }
        this.renderCallbacks.push(callback);
        this.render();
    }

    public refresh() {
        if (typeof this.refreshTimeout !== "undefined") {
            clearTimeout(this.refreshTimeout);
            this.refreshTimeout = undefined;
        }
        this.render(true);
    }

    public updateDisplayConfig() {
        if (!window.siyuan.config.editor.databaseAttrShow) {
            this.hideByDisplayConfig();
            return;
        }
        this.updateTabs();
        this.updateEmptyState();
        if (this.element.dataset.rendered === "true") {
            this.element.classList.toggle("fn__none", !this.bodyElement.querySelector("[data-av-id], .custom-attr__avbacklinks"));
        } else {
            this.render();
        }
    }

    public hasDatabase(avID: string) {
        return Boolean(this.bodyElement.querySelector(`[data-av-id="${avID}"]`));
    }

    public hasItem(itemID: string) {
        return Boolean(itemID && this.bodyElement.querySelector(`[data-row-id="${itemID}"]`));
    }

    public refreshForOperation(operation: IOperation) {
        if (operation.action === "sortAttrViewBinding" && operation.id === this.targetID) {
            this.sortBinding(operation.avID, operation.previousID);
            return;
        }
        const avID = operation.action === "setAttrViewName" ? operation.id : operation.avID;
        if (!avID) {
            return;
        }
        if (operation.action === "insertAttrViewBlock" && operation.srcs?.some(item => item.id === this.targetID)) {
            this.refresh();
            return;
        }
        if (refreshActions.has(operation.action) && this.hasDatabase(avID)) {
            this.refresh();
            return;
        }
        if (operation.action === "updateAttrViewCell" && operation.rowID && this.hasItem(operation.rowID) &&
            (["block", "number"].includes(operation.data?.type) || this.hasRenderTemplate(avID))) {
            this.queueRefresh();
            return;
        }
        if (operation.action === "updateAttrViewCells" && operation.cellUpdates?.some(cell =>
            this.hasItem(cell.rowID) && (["block", "number"].includes(cell.data?.type) ||
                this.hasRenderTemplate(avID)))) {
            this.queueRefresh();
            return;
        }
        if (operation.action === "removeAttrViewBlock" &&
            (this.hasDatabase(operation.avID) || operation.srcIDs?.some(item => this.hasItem(item)))) {
            this.refresh();
        }
    }

    private hasRenderTemplate(avID: string) {
        const databaseElement = this.bodyElement.querySelector<HTMLElement>(`[data-av-id="${avID}"]`);
        return Array.from(databaseElement?.querySelectorAll<HTMLElement>("[data-render-template]") || [])
            .some(item => Boolean(item.dataset.renderTemplate?.trim()));
    }

    private queueRefresh() {
        if (typeof this.refreshTimeout !== "undefined") {
            clearTimeout(this.refreshTimeout);
        }
        this.refreshTimeout = setTimeout(() => {
            this.refreshTimeout = undefined;
            this.refresh();
        }, 100);
    }

    public expand(avID?: string, animate = false) {
        if (avID) {
            this.activeAvID = avID;
        }
        this.setCollapsed(false, animate);
        this.updateTabs();
    }

    public toggle() {
        this.setCollapsed(!this.collapsed, true);
    }

    public displayEmptyFields() {
        if (!window.siyuan.config.editor.databaseAttrHideEmpty || this.showEmptyFields) {
            return;
        }
        this.showEmptyFields = true;
        this.updateEmptyState();
    }

    private updateCollapsedState() {
        cancelHeightAnimation(this.bodyElement);
        this.element.classList.toggle("protyle-db-attr--collapsed", this.collapsed);
        this.updateCollapsedControls();
        this.updateEmptyState();
    }

    private updateCollapsedControls() {
        const toggleElement = this.element.querySelector('[data-type="toggle"]');
        toggleElement?.setAttribute("aria-expanded", (!this.collapsed).toString());
        const useElement = toggleElement?.querySelector("use");
        useElement?.setAttribute("xlink:href", this.collapsed ? "#iconRight" : "#iconDown");
    }

    private setCollapsed(collapsed: boolean, animate: boolean) {
        if (animate && isHeightAnimating(this.bodyElement)) {
            return;
        }
        if (animate && collapsed === this.collapsed) {
            return;
        }
        this.collapsed = collapsed;
        if (!animate) {
            this.updateCollapsedState();
            return;
        }
        this.updateCollapsedControls();
        this.updateEmptyState();
        if (collapsed) {
            collapseHeight(this.bodyElement, () => {
                if (this.collapsed) {
                    this.element.classList.add("protyle-db-attr--collapsed");
                }
            });
        } else {
            this.element.classList.remove("protyle-db-attr--collapsed");
            expandHeight(this.bodyElement);
        }
    }

    private updateTabs() {
        const databaseElements = Array.from(this.bodyElement.querySelectorAll<HTMLElement>(":scope > [data-av-id]"));
        let tabsElement = this.bodyElement.querySelector<HTMLElement>(":scope > .protyle-db-attr__tabs");
        const useTabs = window.siyuan.config.editor.databaseAttrUseTabs;
        if (useTabs && databaseElements.length > 1) {
            if (!tabsElement) {
                tabsElement = document.createElement("div");
                tabsElement.className = "protyle-db-attr__tabs layout-tab-bar fn__flex";
                this.bodyElement.prepend(tabsElement);
            }
            tabsElement.innerHTML = databaseElements.map(item => {
                const title = item.querySelector(".custom-attr__avheader .block__logo span")?.textContent || window.siyuan.languages.database;
                return `<button type="button" draggable="${!this.protyle.disabled}" class="item${item.dataset.avId === this.activeAvID ? " item--focus" : ""}" data-type="av-tab" data-id="${item.dataset.avId}"><span class="item__text">${Lute.EscapeHTMLStr(title)}</span></button>`;
            }).join("");
            this.bindTabDrag(tabsElement);
        } else {
            tabsElement?.remove();
        }
        if (databaseElements.length > 0 && !databaseElements.some(item => item.dataset.avId === this.activeAvID)) {
            this.activeAvID = databaseElements[0]?.dataset.avId || "";
        }
        databaseElements.forEach(item => {
            item.classList.toggle("fn__none", useTabs && databaseElements.length > 1 && item.dataset.avId !== this.activeAvID);
        });
        if (tabsElement) {
            tabsElement.querySelectorAll("[data-type=\"av-tab\"]").forEach(item => {
                item.classList.toggle("item--focus", item.getAttribute("data-id") === this.activeAvID);
            });
        }
    }

    private bindTabDrag(tabsElement: HTMLElement) {
        if (tabsElement.dataset.dragBound === "true") {
            return;
        }
        tabsElement.dataset.dragBound = "true";
        let draggedAvID = "";
        let oldPreviousID = "";
        const clearDragState = () => {
            tabsElement.querySelector('[data-dragging="true"]')?.removeAttribute("data-dragging");
            draggedAvID = "";
            oldPreviousID = "";
            setTimeout(() => {
                this.suppressTabClick = false;
            });
        };
        tabsElement.addEventListener("dragstart", (event: DragEvent) => {
            const tabElement = (event.target as HTMLElement).closest<HTMLElement>('[data-type="av-tab"]');
            if (!tabElement || this.protyle.disabled) {
                event.preventDefault();
                return;
            }
            draggedAvID = tabElement.dataset.id || "";
            if (!draggedAvID) {
                event.preventDefault();
                return;
            }
            const tabElements = Array.from(tabsElement.querySelectorAll<HTMLElement>('[data-type="av-tab"]'));
            const oldIndex = tabElements.indexOf(tabElement);
            oldPreviousID = 0 < oldIndex ? tabElements[oldIndex - 1].dataset.id || "" : "";
            this.suppressTabClick = true;
            tabElement.dataset.dragging = "true";
            event.dataTransfer.effectAllowed = "move";
            event.dataTransfer.setData("text/plain", draggedAvID);
            event.stopPropagation();
        });
        tabsElement.addEventListener("dragover", (event: DragEvent) => {
            if (!draggedAvID) {
                return;
            }
            event.preventDefault();
            event.stopPropagation();
            event.dataTransfer.dropEffect = "move";
            const draggedElement = tabsElement.querySelector<HTMLElement>(`[data-type="av-tab"][data-id="${draggedAvID}"]`);
            if (!draggedElement) {
                return;
            }
            const targetElement = Array.from(tabsElement.querySelectorAll<HTMLElement>('[data-type="av-tab"]')).find(item => {
                if (item === draggedElement) {
                    return false;
                }
                const rect = item.getBoundingClientRect();
                return event.clientX < rect.left + rect.width / 2;
            });
            if (targetElement) {
                targetElement.before(draggedElement);
            } else {
                tabsElement.append(draggedElement);
            }
        });
        tabsElement.addEventListener("dragenter", (event: DragEvent) => {
            if (draggedAvID) {
                event.preventDefault();
                event.stopPropagation();
            }
        });
        tabsElement.addEventListener("dragleave", (event: DragEvent) => {
            if (draggedAvID) {
                event.stopPropagation();
            }
        });
        tabsElement.addEventListener("drop", (event: DragEvent) => {
            if (!draggedAvID) {
                return;
            }
            event.preventDefault();
            event.stopPropagation();
            const tabElements = Array.from(tabsElement.querySelectorAll<HTMLElement>('[data-type="av-tab"]'));
            const avIDs = tabElements.map(item => item.dataset.id || "");
            const index = avIDs.indexOf(draggedAvID);
            if (-1 === index) {
                clearDragState();
                return;
            }
            const previousID = 0 < index ? avIDs[index - 1] : "";
            if (previousID === oldPreviousID) {
                this.updateTabs();
                clearDragState();
                return;
            }
            this.applyBindingOrder(avIDs);
            transaction(this.protyle, [{
                action: "sortAttrViewBinding",
                id: this.targetID,
                avID: draggedAvID,
                previousID,
            }], [{
                action: "sortAttrViewBinding",
                id: this.targetID,
                avID: draggedAvID,
                previousID: oldPreviousID,
            }], {
                callback: () => this.refresh(),
            });
            clearDragState();
        });
        tabsElement.addEventListener("dragend", (event: DragEvent) => {
            if (!draggedAvID) {
                return;
            }
            event.stopPropagation();
            this.updateTabs();
            clearDragState();
        });
    }

    private sortBinding(avID: string, previousID: string) {
        const databaseElements = Array.from(this.bodyElement.querySelectorAll<HTMLElement>(":scope > [data-av-id]"));
        const avIDs = databaseElements.map(item => item.dataset.avId || "");
        const index = avIDs.indexOf(avID);
        if (-1 === index || (previousID && !avIDs.includes(previousID))) {
            this.refresh();
            return;
        }
        avIDs.splice(index, 1);
        const previousIndex = previousID ? avIDs.indexOf(previousID) : -1;
        avIDs.splice(previousIndex + 1, 0, avID);
        this.applyBindingOrder(avIDs);
    }

    private applyBindingOrder(avIDs: string[]) {
        avIDs.forEach(avID => {
            const databaseElement = this.bodyElement.querySelector<HTMLElement>(`:scope > [data-av-id="${avID}"]`);
            if (databaseElement) {
                this.bodyElement.append(databaseElement);
            }
        });
        this.updateTabs();
    }

    private updateEmptyState() {
        const hideEmpty = window.siyuan.config.editor.databaseAttrHideEmpty;
        if (!hideEmpty) {
            this.showEmptyFields = false;
        }
        updateEmptyState(this.element, hideEmpty && !this.showEmptyFields);
        const editElement = this.element.querySelector<HTMLElement>('[data-type="toggle-empty"]');
        editElement?.classList.toggle("fn__none", !hideEmpty || this.collapsed);
        editElement?.setAttribute("aria-label", window.siyuan.languages[
            this.showEmptyFields ? "hideEmptyFields" : "displayEmptyFields"
        ]);
    }

    private hideByDisplayConfig() {
        this.showEmptyFields = false;
        cancelHeightAnimation(this.bodyElement);
        if (this.renderingTargetID) {
            this.renderToken++;
            this.renderingTargetID = "";
        }
        this.element.removeAttribute("data-rendered");
        this.element.classList.add("fn__none");
    }
}

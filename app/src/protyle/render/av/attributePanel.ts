import {renderAVAttribute} from "./blockAttr";
import {
    cancelHeightAnimation,
    collapseHeight,
    expandHeight,
    isHeightAnimating
} from "../../../util/heightAnimation";

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
    private renderCallbacks: ((element: HTMLElement) => void)[] = [];

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
        if (operation.action === "updateAttrViewCell" && ["block", "number"].includes(operation.data?.type) && operation.rowID &&
            this.hasItem(operation.rowID)) {
            this.refresh();
            return;
        }
        if (operation.action === "updateAttrViewCells" && operation.cellUpdates?.some(cell =>
            ["block", "number"].includes(cell.data?.type) && this.hasItem(cell.rowID))) {
            this.refresh();
            return;
        }
        if (operation.action === "removeAttrViewBlock" &&
            (this.hasDatabase(operation.avID) || operation.srcIDs?.some(item => this.hasItem(item)))) {
            this.refresh();
        }
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
                return `<button type="button" class="item${item.dataset.avId === this.activeAvID ? " item--focus" : ""}" data-type="av-tab" data-id="${item.dataset.avId}"><span class="item__text">${Lute.EscapeHTMLStr(title)}</span></button>`;
            }).join("");
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

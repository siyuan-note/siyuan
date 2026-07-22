import {renderAVAttribute} from "./blockAttr";
import {fetchPost} from "../../../util/fetch";

const updateEmptyState = (element: HTMLElement, hideEmpty: boolean) => {
    element.classList.toggle("protyle-db-attr--hide-empty", hideEmpty);
    const useElement = element.querySelector('[data-type="hideEmpty"] use');
    useElement?.setAttribute("xlink:href", hideEmpty ? "#iconEyeoff" : "#iconEye");
    const toggleElement = element.querySelector('[data-type="hideEmpty"]');
    toggleElement?.setAttribute("aria-label", hideEmpty ? window.siyuan.languages.displayEmptyFields : window.siyuan.languages.hideEmptyFields);
};

let hideEmptySaving = false;
let hideEmptySavePending = false;
const saveHideEmpty = () => {
    if (hideEmptySaving) {
        hideEmptySavePending = true;
        return;
    }
    hideEmptySaving = true;
    const hideEmpty = window.siyuan.config.editor.databaseAttrHideEmpty;
    void fetchPost("/api/setting/setEditor", window.siyuan.config.editor, (response) => {
        if (!hideEmptySavePending && window.siyuan.config.editor.databaseAttrHideEmpty === hideEmpty) {
            window.siyuan.config.editor.databaseAttrHideEmpty = response.data.databaseAttrHideEmpty;
        }
    }).finally(() => {
        hideEmptySaving = false;
        if (hideEmptySavePending) {
            hideEmptySavePending = false;
            saveHideEmpty();
        }
    });
};

export class AVAttributePanel {
    public element: HTMLElement;
    private bodyElement: HTMLElement;
    private protyle: IProtyle;
    private targetID = "";
    private renderToken = 0;
    private collapsed: boolean;
    private activeAvID = "";

    constructor(protyle: IProtyle) {
        this.protyle = protyle;
        this.collapsed = window.siyuan.config.editor.databaseAttrViewMode === 1;
        this.element = document.createElement("div");
        this.element.className = "protyle-db-attr fn__none";
        this.element.innerHTML = `<button type="button" class="protyle-db-attr__header fn__flex" data-type="toggle" aria-expanded="${!this.collapsed}" aria-label="${window.siyuan.languages.database}">
    <span class="block__icon block__icon--show fn__flex-center"><svg><use xlink:href="#iconRight"></use></svg></span>
    <span class="block__logo fn__flex-1"><svg class="block__logoicon"><use xlink:href="#iconDatabase"></use></svg><span>${window.siyuan.languages.database}</span></span>
    <span class="block__icon block__icon--show ariaLabel" data-type="hideEmpty" data-position="north" aria-label="${window.siyuan.languages.hideEmptyFields}"><svg><use xlink:href="#iconEye"></use></svg></span>
</button>`;
        this.bodyElement = document.createElement("div");
        this.bodyElement.className = "custom-attr protyle-db-attr__body";
        this.element.appendChild(this.bodyElement);
        this.element.addEventListener("click", (event) => {
            const target = event.target as HTMLElement;
            if (target.closest('[data-type="hideEmpty"]')) {
                const hideEmpty = !window.siyuan.config.editor.databaseAttrHideEmpty;
                window.siyuan.config.editor.databaseAttrHideEmpty = hideEmpty;
                document.querySelectorAll<HTMLElement>(".protyle-db-attr").forEach(item => updateEmptyState(item, hideEmpty));
                saveHideEmpty();
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
        const targetID = this.protyle.block.showAll ? this.protyle.block.id : this.protyle.block.rootID;
        if (!targetID || (!force && targetID === this.targetID && this.element.dataset.rendered === "true")) {
            return;
        }
        this.targetID = targetID;
        this.element.dataset.nodeId = targetID;
        this.element.removeAttribute("data-rendered");
        const token = ++this.renderToken;
        const bodyElement = document.createElement("div");
        bodyElement.className = "custom-attr protyle-db-attr__body";
        this.bodyElement.replaceWith(bodyElement);
        this.bodyElement = bodyElement;
        renderAVAttribute(bodyElement, targetID, this.protyle, (renderedElement) => {
            if (token !== this.renderToken) {
                return;
            }
            this.element.dataset.rendered = "true";
            this.updateTabs();
            this.updateEmptyState();
            this.element.classList.toggle("fn__none", !renderedElement.querySelector("[data-av-id], .custom-attr__avbacklinks"));
        });
    }

    public refresh() {
        this.render(true);
    }

    public hasDatabase(avID: string) {
        return Boolean(this.bodyElement.querySelector(`[data-av-id="${avID}"]`));
    }

    public hasItem(itemID: string) {
        return Boolean(itemID && this.bodyElement.querySelector(`[data-row-id="${itemID}"]`));
    }

    public refreshForOperation(operation: IOperation) {
        if (!operation.avID) {
            return;
        }
        if (operation.action === "insertAttrViewBlock" && operation.srcs?.some(item => item.id === this.targetID)) {
            this.refresh();
            return;
        }
        if (operation.action === "removeAttrViewBlock" &&
            (this.hasDatabase(operation.avID) || operation.srcIDs?.some(item => this.hasItem(item)))) {
            this.refresh();
        }
    }

    public expand() {
        this.collapsed = false;
        this.updateCollapsedState();
    }

    public toggle() {
        this.collapsed = !this.collapsed;
        this.updateCollapsedState();
    }

    private updateCollapsedState() {
        this.element.classList.toggle("protyle-db-attr--collapsed", this.collapsed);
        const toggleElement = this.element.querySelector('[data-type="toggle"]');
        toggleElement?.setAttribute("aria-expanded", (!this.collapsed).toString());
        const useElement = toggleElement?.querySelector("use");
        useElement?.setAttribute("xlink:href", this.collapsed ? "#iconRight" : "#iconDown");
    }

    private updateTabs() {
        const databaseElements = Array.from(this.bodyElement.querySelectorAll<HTMLElement>(":scope > [data-av-id]"));
        let tabsElement = this.bodyElement.querySelector<HTMLElement>(":scope > .protyle-db-attr__tabs");
        const useTabs = window.siyuan.config.editor.databaseAttrUseTabs;
        if (useTabs && databaseElements.length > 1) {
            if (!tabsElement) {
                tabsElement = document.createElement("div");
                tabsElement.className = "protyle-db-attr__tabs";
                this.bodyElement.prepend(tabsElement);
            }
            tabsElement.innerHTML = databaseElements.map(item => {
                const title = item.querySelector(".custom-attr__avheader .block__logo span")?.textContent || window.siyuan.languages.database;
                return `<button type="button" class="b3-button${item.dataset.avId === this.activeAvID ? " b3-button--outline" : ""}" data-type="av-tab" data-id="${item.dataset.avId}">${Lute.EscapeHTMLStr(title)}</button>`;
            }).join("");
        } else {
            tabsElement?.remove();
        }
        if (!databaseElements.some(item => item.dataset.avId === this.activeAvID)) {
            this.activeAvID = databaseElements[0]?.dataset.avId || "";
        }
        databaseElements.forEach(item => {
            item.classList.toggle("fn__none", useTabs && databaseElements.length > 1 && item.dataset.avId !== this.activeAvID);
        });
        if (tabsElement) {
            tabsElement.querySelectorAll("[data-type=\"av-tab\"]").forEach(item => {
                item.classList.toggle("b3-button--outline", item.getAttribute("data-id") === this.activeAvID);
            });
        }
    }

    private updateEmptyState() {
        updateEmptyState(this.element, window.siyuan.config.editor.databaseAttrHideEmpty);
    }
}

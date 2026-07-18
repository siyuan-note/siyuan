import {renderAVAttribute} from "./blockAttr";

export class AVAttributePanel {
    public element: HTMLElement;
    private bodyElement: HTMLElement;
    private protyle: IProtyle;
    private targetID = "";
    private renderToken = 0;
    private collapsed: boolean;

    constructor(protyle: IProtyle) {
        this.protyle = protyle;
        this.collapsed = window.siyuan.config.editor.databaseAttrViewMode === 1;
        this.element = document.createElement("div");
        this.element.className = "protyle-db-attr fn__none";
        this.element.innerHTML = `<button type="button" class="protyle-db-attr__header fn__flex" data-type="toggle" aria-expanded="${!this.collapsed}" aria-label="${window.siyuan.languages.database}">
    <span class="block__icon block__icon--show fn__flex-center"><svg><use xlink:href="#iconRight"></use></svg></span>
    <span class="block__logo fn__flex-1"><svg class="block__logoicon"><use xlink:href="#iconDatabase"></use></svg><span>${window.siyuan.languages.database}</span></span>
</button>`;
        this.bodyElement = document.createElement("div");
        this.bodyElement.className = "custom-attr protyle-db-attr__body";
        this.element.appendChild(this.bodyElement);
        this.element.addEventListener("click", (event) => {
            const target = event.target as HTMLElement;
            if (target.closest('[data-type="toggle"]')) {
                this.toggle();
                event.preventDefault();
                event.stopPropagation();
            }
        });
        this.updateCollapsedState();
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
            this.element.classList.toggle("fn__none", renderedElement.childElementCount === 0);
        });
    }

    public refresh() {
        this.render(true);
    }

    public hasDatabase(avID: string) {
        return Boolean(this.bodyElement.querySelector(`[data-av-id="${avID}"]`));
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
}

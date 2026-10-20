import {Backlink} from "./Backlink";
import {setPadding} from "../../protyle/ui/initUI";

export const getBottomBacklinkBlockId = (protyle: IProtyle) => {
    return protyle.block.showAll ? protyle.block.id : (protyle.block.parentID || protyle.block.rootID);
};

export class BottomBacklinkPanel {
    public backlink?: Backlink;
    private backlinkElement?: HTMLElement;
    private backlinkIntersectionObserver?: IntersectionObserver;
    private backlinkMutationObserver?: MutationObserver;
    private backlinkEmpty = false;
    private unregisterPanel?: () => void;

    constructor(private protyle: IProtyle, private registerPanel?: (panel: Backlink) => () => void) {
    }

    public update(reset = false) {
        if (reset) {
            this.destroy();
        }
        if (!window.siyuan.config.editor.backlinkShowBottom) {
            this.destroy();
            return;
        }
        if (this.backlinkElement) {
            this.updateBacklinkVisibility();
            return;
        }

        const backlinkElement = document.createElement("div");
        backlinkElement.className = "fn__none sy__backlink--bottom sy__backlink--pending";
        this.backlinkElement = backlinkElement;
        this.protyle.wysiwyg.element.after(backlinkElement);
        setPadding(this.protyle);

        this.backlinkIntersectionObserver = new IntersectionObserver((entries) => {
            if (this.backlinkElement !== backlinkElement || !entries[0].isIntersecting ||
                backlinkElement.classList.contains("fn__none")) {
                return;
            }
            if (!this.backlink) {
                this.backlink = new Backlink({
                    app: this.protyle.app,
                    blockId: this.getBacklinkBlockId(),
                    rootId: this.protyle.block.rootID,
                    notebookId: this.protyle.notebookId,
                    type: "bottom",
                    element: backlinkElement,
                    ownerProtyle: this.protyle,
                    emptyChange: (empty) => {
                        if (this.backlinkElement !== backlinkElement) {
                            return;
                        }
                        const pending = backlinkElement.classList.contains("sy__backlink--pending");
                        if (!pending && this.backlinkEmpty === empty) {
                            return;
                        }
                        const contentElement = this.protyle.contentElement;
                        contentElement.classList.add("protyle-content--backlink-reveal");
                        backlinkElement.classList.remove("sy__backlink--pending");
                        this.backlinkEmpty = empty;
                        this.updateBacklinkVisibility(pending);
                        contentElement.getBoundingClientRect();
                        requestAnimationFrame(() => {
                            contentElement.classList.remove("protyle-content--backlink-reveal");
                        });
                    },
                });
                this.unregisterPanel = this.registerPanel?.(this.backlink);
            } else {
                this.backlink.refreshDirty();
            }
        }, {
            root: this.protyle.contentElement,
            rootMargin: "640px 0px",
        });
        this.backlinkIntersectionObserver.observe(backlinkElement);

        this.backlinkMutationObserver = new MutationObserver(() => {
            this.updateBacklinkVisibility();
        });
        this.backlinkMutationObserver.observe(this.protyle.wysiwyg.element, {
            attributes: true,
            attributeFilter: ["data-bottom-eof"],
        });
        this.updateBacklinkVisibility();
    }

    public refresh() {
        if (!this.backlink) {
            return;
        }
        const blockId = this.getBacklinkBlockId();
        const rootId = this.protyle.block.rootID;
        this.backlink.switchBlock(blockId, rootId, this.protyle.notebookId);
    }

    private getBacklinkBlockId() {
        return getBottomBacklinkBlockId(this.protyle);
    }

    private updateBacklinkVisibility(forcePadding = false) {
        if (!this.backlinkElement) {
            return;
        }
        const hidden = this.backlinkEmpty || (!this.protyle.block.showAll && this.protyle.block.scroll &&
            !this.protyle.wysiwyg.element.hasAttribute("data-bottom-eof"));
        if (this.backlinkElement.classList.contains("fn__none") !== hidden || forcePadding) {
            this.backlinkElement.classList.toggle("fn__none", hidden);
            setPadding(this.protyle);
        }
    }

    public destroy() {
        const hasBacklinkElement = !!this.backlinkElement;
        this.backlinkIntersectionObserver?.disconnect();
        this.backlinkMutationObserver?.disconnect();
        this.unregisterPanel?.();
        this.unregisterPanel = undefined;
        this.backlink?.destroy();
        this.backlinkElement?.remove();
        this.backlinkIntersectionObserver = undefined;
        this.backlinkMutationObserver = undefined;
        this.backlink = undefined;
        this.backlinkElement = undefined;
        this.backlinkEmpty = false;
        if (hasBacklinkElement) {
            setPadding(this.protyle);
        }
    }
}

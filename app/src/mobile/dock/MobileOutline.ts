import {Tree} from "../../util/Tree";
import {fetchPost} from "../../util/fetch";
import {openMobileFileById} from "../editor";
import {Constants} from "../../constants";
import {getEventName} from "../../protyle/util/compatibility";
import {App} from "../../index";
import {closePanel} from "../util/closePanel";

export class MobileOutline {
    private tree: Tree;
    private openNodes: { [key: string]: string[] } = {};
    private element: Element;

    constructor(app: App) {
        this.element = document.querySelector('#sidebar [data-type="sidebar-outline"]');
        this.element.innerHTML = `<div class="toolbar toolbar--border toolbar--dark">
    <div class="fn__space"></div>
    <div class="toolbar__text">
        ${window.siyuan.languages.outline}
    </div>
    <span class="fn__flex-1 fn__space"></span>
    <svg data-type="expand" class="toolbar__icon"><use xlink:href="#iconExpand"></use></svg>
    <span class="fn__space"></span>
    <svg data-type="collapse" class="toolbar__icon"><use xlink:href="#iconContract"></use></svg>
</div>
<div class="fn__flex-1"></div>`;
        this.tree = new Tree({
            element: this.element.lastElementChild as HTMLElement,
            data: null,
            click: (element: HTMLElement) => {
                const id = element.getAttribute("data-node-id");
                if (!window.siyuan.mobile.editor.protyle.preview.element.classList.contains("fn__none")) {
                    closePanel();
                    document.getElementById(id)?.scrollIntoView();
                } else {
                    fetchPost("/api/block/checkBlockFold", {id}, (foldResponse) => {
                        openMobileFileById(app, id, foldResponse.data ? [Constants.CB_GET_FOCUS, Constants.CB_GET_ALL, Constants.CB_GET_HTML] : [Constants.CB_GET_FOCUS, Constants.CB_GET_SETID, Constants.CB_GET_CONTEXT, Constants.CB_GET_HTML]);
                    });
                }
            }
        });
        this.element.firstElementChild.querySelector('[data-type="collapse"]').addEventListener(getEventName(), () => {
            this.tree.collapseAll();
        });
        const expandElement = this.element.firstElementChild.querySelector('[data-type="expand"]');
        expandElement.addEventListener(getEventName(), () => {
            if (expandElement.classList.contains("toolbar__icon--active")) {
                expandElement.classList.remove("toolbar__icon--active");
            } else {
                expandElement.classList.add("toolbar__icon--active");
            }
            this.tree.expandAll();
        });
        this.update();
    }

    public update() {
        if (!window.siyuan.mobile.editor.protyle.preview.element.classList.contains("fn__none")) {
            window.siyuan.mobile.editor.protyle.preview.render(window.siyuan.mobile.editor.protyle, (outlineData) => {
                this.tree.updateData(outlineData);
            });
            return;
        }
        fetchPost("/api/outline/getDocOutline", {
            id: window.siyuan.mobile.editor.protyle.block.rootID,
        }, response => {
            let currentId;
            let currentElement = this.element.querySelector(".b3-list-item--focus");
            if (currentElement) {
                currentId = currentElement.getAttribute("data-node-id");
            }

            const blockId = window.siyuan.mobile.editor.protyle.block.rootID;
            if (this.openNodes[blockId]) {
                this.openNodes[blockId] = this.tree.getExpandIds();
            }
            this.tree.updateData(response.data);
            if (this.openNodes[blockId] && !this.element.firstElementChild.querySelector('[data-type="expand"]').classList.contains("toolbar__icon--active")) {
                this.tree.setExpandIds(this.openNodes[blockId]);
            } else {
                this.tree.expandAll();
                this.openNodes[blockId] = this.tree.getExpandIds();
            }

            if (currentId) {
                currentElement = this.element.querySelector(`[data-node-id="${currentId}"]`);
                if (currentElement) {
                    currentElement.classList.add("b3-list-item--focus");
                }
            }
        });
    }
}

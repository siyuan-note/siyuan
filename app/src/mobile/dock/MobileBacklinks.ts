import {Tree} from "../../util/Tree";
import {fetchPost} from "../../util/fetch";
import {Constants} from "../../constants";
import {openMobileFileById} from "../editor";
import {App} from "../../index";

export class MobileBacklinks {
    public element: HTMLElement;
    private tree: Tree;
    private notebookId: string;
    private mTree: Tree;
    public beforeLen = 10;

    constructor(app: App) {
        this.element = document.querySelector('#sidebar [data-type="sidebar-backlink"]');
        this.element.innerHTML = `<div class="toolbar toolbar--border toolbar--dark">
    <div class="fn__space"></div>
    <div class="toolbar__text">
        ${window.siyuan.languages.backlinks}
    </div>
    <span class="counter listCount"></span>
    <span class="fn__space"></span>
    <svg data-type="expand" class="toolbar__icon"><use xlink:href="#iconExpand"></use></svg>
    <span class="fn__space"></span>
    <svg data-type="collapse" class="toolbar__icon"><use xlink:href="#iconContract"></use></svg>
</div>
<div class="backlinkList fn__flex-1"></div>
<div class="toolbar">
    <div class="fn__space"></div>
    <div class="toolbar__text">
        ${window.siyuan.languages.mentions}
    </div>
    <span class="counter listMCount"></span>
    <span class="fn__space"></span>
    <svg data-type="mExpand" class="toolbar__icon"><use xlink:href="#iconExpand"></use></svg>
    <span class="fn__space"></span>
    <svg data-type="mCollapse" class="toolbar__icon"><use xlink:href="#iconContract"></use></svg>
    <span class="fn__space"></span>
    <svg data-type="layout" class="toolbar__icon"><use xlink:href="#iconDown"></use></svg>
</div>
<div class="backlinkMList fn__flex-1"></div>`;

        this.tree = new Tree({
            element: this.element.querySelector(".backlinkList") as HTMLElement,
            data: null,
            click(element: HTMLElement) {
                openMobileFileById(app, element.getAttribute("data-node-id"), [Constants.CB_GET_HL, Constants.CB_GET_CONTEXT]);
            }
        });
        this.mTree = new Tree({
            element: this.element.querySelector(".backlinkMList") as HTMLElement,
            data: null,
            click: (element) => {
                openMobileFileById(app, element.getAttribute("data-node-id"), [Constants.CB_GET_HL, Constants.CB_GET_CONTEXT]);
            },
        });
        this.element.addEventListener("click", (event) => {
            let target = event.target as HTMLElement;
            while (target && !target.isEqualNode(this.element)) {
                if (target.classList.contains("toolbar__icon")) {
                    const type = target.getAttribute("data-type");
                    switch (type) {
                        case "collapse":
                            this.tree.collapseAll();
                            break;
                        case "expand":
                            this.tree.expandAll();
                            break;
                        case "mExpand":
                            this.mTree.expandAll();
                            break;
                        case "mCollapse":
                            this.mTree.collapseAll();
                            break;
                        case "layout":
                            if (this.mTree.element.style.flex) {
                                if (this.mTree.element.style.height === "0px") {
                                    this.mTree.element.removeAttribute("style");
                                    target.setAttribute("aria-label", window.siyuan.languages.up);
                                    target.querySelector("use").setAttribute("xlink:href", "#iconUp");
                                } else {
                                    this.mTree.element.removeAttribute("style");
                                    target.setAttribute("aria-label", window.siyuan.languages.down);
                                    target.querySelector("use").setAttribute("xlink:href", "#iconDown");
                                }
                            } else {
                                if (target.getAttribute("aria-label") === window.siyuan.languages.down) {
                                    this.mTree.element.setAttribute("style", "flex:none;height:0px");
                                    target.setAttribute("aria-label", window.siyuan.languages.up);
                                    target.querySelector("use").setAttribute("xlink:href", "#iconUp");
                                } else {
                                    this.mTree.element.setAttribute("style", `flex:none;height:${this.element.clientHeight - this.tree.element.previousElementSibling.clientHeight * 2}px`);
                                    target.setAttribute("aria-label", window.siyuan.languages.down);
                                    target.querySelector("use").setAttribute("xlink:href", "#iconDown");
                                }
                            }
                            target.setAttribute("data-clicked", "true");
                            break;
                    }
                }
                target = target.parentElement;
            }
        });

        this.update();
    }

    public update() {
        fetchPost("/api/ref/getBacklink", {
            id: window.siyuan.mobile.editor.protyle.block.id,
            beforeLen: this.beforeLen,
            k: "",
            mk: "",
        }, response => {
            this.notebookId = response.data.box;
            this.tree.updateData(response.data.backlinks);
            this.mTree.updateData(response.data.backmentions);

            const countElement = this.element.querySelector(".listCount");
            if (response.data.linkRefsCount === 0) {
                countElement.classList.add("fn__none");
            } else {
                countElement.classList.remove("fn__none");
                countElement.textContent = response.data.linkRefsCount.toString();
            }
            const mCountElement = this.element.querySelector(".listMCount");
            if (response.data.mentionsCount === 0) {
                mCountElement.classList.add("fn__none");
            } else {
                mCountElement.classList.remove("fn__none");
                mCountElement.textContent = response.data.mentionsCount.toString();
            }

            const layoutElement = this.element.querySelector("[data-type='layout']");
            if (layoutElement.getAttribute("data-clicked")) {
                return;
            }
            if (response.data.mentionsCount === 0) {
                this.mTree.element.setAttribute("style", "flex:none;height:0px");
                layoutElement.setAttribute("aria-label", window.siyuan.languages.up);
                layoutElement.querySelector("use").setAttribute("xlink:href", "#iconUp");
                return;
            }
            if (response.data.linkRefsCount === 0) {
                this.mTree.element.setAttribute("style", `flex:none;height:${this.element.clientHeight - this.tree.element.previousElementSibling.clientHeight * 2}px`);
                layoutElement.setAttribute("aria-label", window.siyuan.languages.down);
                layoutElement.querySelector("use").setAttribute("xlink:href", "#iconDown");
            } else {
                this.mTree.element.removeAttribute("style");
                layoutElement.setAttribute("aria-label", window.siyuan.languages.down);
                layoutElement.querySelector("use").setAttribute("xlink:href", "#iconDown");
            }
        });
    }
}

import {Tree} from "../../util/Tree";
import {fetchPost} from "../../util/fetch";
import {hasClosestByClassName} from "../../protyle/util/hasClosest";
import {MenuItem} from "../../menus/Menu";
import {Dialog} from "../../dialog";
import {confirmDialog} from "../../dialog/confirmDialog";
import {escapeHtml} from "../../util/escape";
import {popSearch, toolbarSearchEvent} from "./search";

export class MobileTags {
    public element: HTMLElement;
    private tree: Tree;
    private openNodes: string[];

    constructor() {
        this.element = document.querySelector('#sidebar [data-type="sidebar-tag"]');
        this.element.innerHTML = `<div class="toolbar">
    <div class="fn__space"></div>
    <div class="toolbar__text">
        ${window.siyuan.languages.tag}
    </div>
    <span class="fn__space"></span>
    <svg data-type="expand" class="toolbar__icon"><use xlink:href="#iconFullscreen"></use></svg>
    <span class="fn__space"></span>
    <svg data-type="collapse" class="toolbar__icon"><use xlink:href="#iconContract"></use></svg>
    <span class="fn__space"></span>
    <svg data-type="sort" class="toolbar__icon"><use xlink:href="#iconSort"></use></svg>
</div>
<div class="fn__flex-1 tagList"></div>
<img style="position: absolute;top: 0;left: 0;height: 100%;width: 100%;padding: 30vw;box-sizing: border-box;" src="/stage/loading-pure.svg">`;

        this.tree = new Tree({
            element: this.element.querySelector(".tagList") as HTMLElement,
            data: null,
            click: (element: HTMLElement) => {
                const actionElement = hasClosestByClassName(event.target as HTMLElement, "b3-list-item__action");
                if (actionElement) {
                    const labelName = element.getAttribute("data-label");
                    if (actionElement.getAttribute("data-type") === "edit") {
                        const dialog = new Dialog({
                            title: window.siyuan.languages.rename,
                            content: `<div class="b3-dialog__content"><input class="b3-text-field fn__block" value="${labelName}"></div>
<div class="b3-dialog__action">
    <button class="b3-button b3-button--cancel">${window.siyuan.languages.cancel}</button><div class="fn__space"></div>
    <button class="b3-button b3-button--text">${window.siyuan.languages.confirm}</button>
</div>`,
                            width: "80vw",
                        });
                        const btnsElement = dialog.element.querySelectorAll(".b3-button");
                        btnsElement[0].addEventListener("click", () => {
                            dialog.destroy();
                        });
                        const inputElement = dialog.element.querySelector("input");
                        dialog.bindInput(inputElement, () => {
                            (btnsElement[1] as HTMLButtonElement).click();
                        });
                        inputElement.focus();
                        inputElement.select();
                        btnsElement[1].addEventListener("click", () => {
                            fetchPost("/api/tag/renameTag", {oldLabel: labelName, newLabel: inputElement.value});
                        });
                    } else {
                        confirmDialog(window.siyuan.languages.deleteOpConfirm, `${window.siyuan.languages.confirmDelete} <b>${escapeHtml(labelName)}</b>?`, () => {
                            fetchPost("/api/tag/removeTag", {label: labelName});
                        });
                    }
                } else {
                    const modelElement = document.getElementById("model");
                    const modelMainElement = document.getElementById("modelMain");
                    popSearch(modelElement, modelMainElement);
                    (document.getElementById("toolbarSearch") as HTMLInputElement).value = `#${element.getAttribute("data-label")}#`;
                    toolbarSearchEvent();
                }
            },
            topExtHTML: '<span class="b3-list-item__action" data-type="edit"><svg><use xlink:href="#iconEdit"></use></svg></span><span class="b3-list-item__action" data-type="remove"><svg><use xlink:href="#iconTrashcan"></use></svg></span>'
        });
        this.element.addEventListener("click", (event) => {
            let target = event.target as HTMLElement;
            while (target && !target.isEqualNode(this.element)) {
                if (target.classList.contains("toolbar__icon")) {
                    const type = target.getAttribute("data-type");
                    switch (type) {
                        case "collapse":
                            this.tree.collapseAll();
                            event.preventDefault();
                            event.stopPropagation();
                            break;
                        case "expand":
                            this.tree.expandAll();
                            event.preventDefault();
                            event.stopPropagation();
                            break;
                        case "sort":
                            window.siyuan.menus.menu.remove();
                            window.siyuan.menus.menu.append(new MenuItem({
                                icon: window.siyuan.config.tag.sort === 0 ? "iconSelect" : undefined,
                                label: window.siyuan.languages.fileNameASC,
                                click: () => {
                                    window.siyuan.config.tag.sort = 0;
                                    this.update();
                                },
                            }).element);
                            window.siyuan.menus.menu.append(new MenuItem({
                                icon: window.siyuan.config.tag.sort === 1 ? "iconSelect" : undefined,
                                label: window.siyuan.languages.fileNameDESC,
                                click: () => {
                                    window.siyuan.config.tag.sort = 1;
                                    this.update();
                                },
                            }).element);
                            window.siyuan.menus.menu.append(new MenuItem({
                                icon: window.siyuan.config.tag.sort === 4 ? "iconSelect" : undefined,
                                label: window.siyuan.languages.fileNameNatASC,
                                click: () => {
                                    window.siyuan.config.tag.sort = 4;
                                    this.update();
                                },
                            }).element);
                            window.siyuan.menus.menu.append(new MenuItem({
                                icon: window.siyuan.config.tag.sort === 5 ? "iconSelect" : undefined,
                                label: window.siyuan.languages.fileNameNatDESC,
                                click: () => {
                                    window.siyuan.config.tag.sort = 5;
                                    this.update();
                                },
                            }).element);
                            window.siyuan.menus.menu.append(new MenuItem({
                                icon: window.siyuan.config.tag.sort === 7 ? "iconSelect" : undefined,
                                label: window.siyuan.languages.refCountASC,
                                click: () => {
                                    window.siyuan.config.tag.sort = 7;
                                    this.update();
                                },
                            }).element);
                            window.siyuan.menus.menu.append(new MenuItem({
                                icon: window.siyuan.config.tag.sort === 8 ? "iconSelect" : undefined,
                                label: window.siyuan.languages.refCountDESC,
                                click: () => {
                                    window.siyuan.config.tag.sort = 8;
                                    this.update();
                                },
                            }).element);
                            window.siyuan.menus.menu.popup({x: event.clientX, y: event.clientY});
                            window.siyuan.menus.menu.element.style.zIndex = "310";
                            event.preventDefault();
                            event.stopPropagation();
                            break;
                    }
                }
                target = target.parentElement;
            }
        });
        this.update();
    }

    public update() {
        this.element.lastElementChild.classList.remove("fn__none");
        fetchPost("/api/tag/getTag", {
            sort: window.siyuan.config.tag.sort
        }, response => {
            if (this.openNodes) {
                this.openNodes = this.tree.getExpandIds();
            }
            this.tree.updateData(response.data);
            if (this.openNodes) {
                this.tree.setExpandIds(this.openNodes);
            } else {
                this.openNodes = this.tree.getExpandIds();
            }
            this.element.lastElementChild.classList.add("fn__none");
        });
    }
}

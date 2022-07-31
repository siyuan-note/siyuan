import {Tab} from "../Tab";
import {Model} from "../Model";
import {Tree} from "../../util/Tree";
import {getDockByType, setPanelFocus} from "../util";
import {fetchPost} from "../../util/fetch";
import {updateHotkeyTip} from "../../protyle/util/compatibility";
import {openGlobalSearch} from "../../search/util";
import {MenuItem} from "../../menus/Menu";
import {Dialog} from "../../dialog";
import {confirmDialog} from "../../dialog/confirmDialog";
import {escapeHtml} from "../../util/escape";

export class Tag extends Model {
    private openNodes: string[];
    private tree: Tree;
    private element: Element;

    constructor(tab: Tab) {
        super({
            id: tab.id,
            msgCallback(data) {
                if (data) {
                    switch (data.cmd) {
                        case "transactions":
                            data.data[0].doOperations.forEach((item: IOperation) => {
                                let needReload = false;
                                if ((item.action === "update" || item.action === "insert") && item.data.indexOf('data-type="tag"') > -1) {
                                    needReload = true;
                                } else if (item.action === "delete") {
                                    needReload = true;
                                }
                                if (needReload) {
                                    this.update();
                                }
                            });
                            break;
                        case "unmount":
                        case "remove":
                        case "mount":
                            if (data.cmd !== "mount" || data.code !== 1) {
                                this.update();
                            }
                            break;
                    }
                }
            }
        });

        this.element = tab.panelElement;
        this.element.classList.add("fn__flex-column", "file-tree", "sy__tag");

        this.element.innerHTML = `<div class="block__icons">
    <div class="block__logo">
        <svg><use xlink:href="#iconTags"></use></svg>
        ${window.siyuan.languages.tag}
    </div>
    <span class="fn__flex-1"></span>
    <span class="fn__space"></span>
    <span data-type="refresh" class="block__icon b3-tooltips b3-tooltips__sw" aria-label="${window.siyuan.languages.refresh}"><svg><use xlink:href='#iconRefresh'></use></svg></span>
    <span class="fn__space"></span>
    <span data-type="expand" class="block__icon b3-tooltips b3-tooltips__sw" aria-label="${window.siyuan.languages.expandAll} ${updateHotkeyTip("⌘↓")}">
        <svg><use xlink:href="#iconFullscreen"></use></svg>
    </span>
    <span class="fn__space"></span>
    <span data-type="collapse" class="block__icon b3-tooltips b3-tooltips__sw" aria-label="${window.siyuan.languages.collapseAll} ${updateHotkeyTip("⌘↑")}">
        <svg><use xlink:href="#iconContract"></use></svg>
    </span>
    <span class="fn__space"></span>
    <span data-type="sort" class="block__icon b3-tooltips b3-tooltips__sw" aria-label="${window.siyuan.languages.sort}">
        <svg><use xlink:href="#iconSort"></use></svg>
    </span>
    <span class="fn__space"></span>
    <span data-type="min" class="block__icon b3-tooltips b3-tooltips__sw" aria-label="${window.siyuan.languages.min} ${updateHotkeyTip(window.siyuan.config.keymap.general.closeTab.custom)}"><svg><use xlink:href='#iconMin'></use></svg></span>
</div>
<div class="fn__flex-1"></div>`;

        this.tree = new Tree({
            element: this.element.lastElementChild as HTMLElement,
            data: null,
            click(element: HTMLElement) {
                openGlobalSearch(`#${element.getAttribute("data-label")}#`, !window.siyuan.ctrlIsPressed);
            },
            rightClick: (element: HTMLElement, event: MouseEvent) => {
                const labelName = element.getAttribute("data-label");
                window.siyuan.menus.menu.remove();
                window.siyuan.menus.menu.append(new MenuItem({
                    label: window.siyuan.languages.rename,
                    click() {
                        const dialog = new Dialog({
                            title: window.siyuan.languages.rename,
                            content: `<div class="b3-dialog__content"><input class="b3-text-field fn__block" value="${labelName}"></div>
<div class="b3-dialog__action">
    <button class="b3-button b3-button--cancel">${window.siyuan.languages.cancel}</button><div class="fn__space"></div>
    <button class="b3-button b3-button--text">${window.siyuan.languages.confirm}</button>
</div>`,
                            width: "520px",
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
                    }
                }).element);
                window.siyuan.menus.menu.append(new MenuItem({
                    icon: "iconTrashcan",
                    label: window.siyuan.languages.remove,
                    click: () => {
                        confirmDialog(window.siyuan.languages.delete, `${window.siyuan.languages.confirmDelete} <b>${escapeHtml(labelName)}</b>?`, () => {
                            fetchPost("/api/tag/removeTag", {label: labelName});
                        });
                    },
                }).element);
                window.siyuan.menus.menu.popup({x: event.clientX, y: event.clientY});
            },
        });
        // 为了快捷键的 dispatch
        this.element.querySelector('[data-type="collapse"]').addEventListener("click", () => {
            this.tree.collapseAll();
        });
        this.element.querySelector('[data-type="expand"]').addEventListener("click", () => {
            this.tree.expandAll();
        });
        this.element.addEventListener("click", (event: MouseEvent) => {
            setPanelFocus(this.element.firstElementChild);
            let target = event.target as HTMLElement;
            while (target && !target.isEqualNode(this.element)) {
                if (target.classList.contains("block__icon")) {
                    const type = target.getAttribute("data-type");
                    switch (type) {
                        case "min":
                            getDockByType("tag").toggleModel("tag");
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
                            event.preventDefault();
                            event.stopPropagation();
                            break;
                        case "refresh":
                            this.update();
                            break;
                    }
                }
                target = target.parentElement;
            }
        });
        this.update();
        setPanelFocus(this.element.firstElementChild);
    }

    private update() {
        const element = this.element.querySelector('.block__icon[data-type="refresh"] svg');
        if (element.classList.contains("fn__rotate")) {
            return;
        }
        element.classList.add("fn__rotate");
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
            element.classList.remove("fn__rotate");
        });
    }
}

import {Layout} from "./index";
import {genUUID} from "../util/genID";
import {
    getInstanceById,
    getWndByLayout,
    newCenterEmptyTab,
    resizeTabs,
    setPanelFocus,
    switchWnd
} from "./util";
import {Tab} from "./Tab";
import {Model} from "./Model";
import {Editor} from "../editor";
import {Graph} from "./dock/Graph";
import {hasClosestByAttribute, hasClosestByClassName, hasClosestByTag} from "../protyle/util/hasClosest";
import {Constants} from "../constants";
/// #if !BROWSER
import {webFrame} from "electron";
import {getCurrentWindow} from "@electron/remote";
/// #endif
import {Search} from "../search";
import {showMessage} from "../dialog/message";
import {openFileById, updatePanelByEditor} from "../editor/util";
import {scrollCenter} from "../util/highlightById";
import {getAllModels} from "./getAll";
import {clearCounter} from "./status";
import {saveScroll} from "../protyle/scroll/saveScroll";
import {Asset} from "../asset";
import {newFile} from "../util/newFile";
import {MenuItem} from "../menus/Menu";
import {escapeHtml} from "../util/escape";

export class Wnd {
    public id: string;
    public parent?: Layout;
    public element: HTMLElement;
    public headersElement: HTMLElement;
    public children: Tab[] = [];
    public resize?: TDirection;

    constructor(resize?: TDirection, parentType?: TLayout) {
        this.id = genUUID();
        this.resize = resize;
        this.element = document.createElement("div");
        this.element.classList.add("fn__flex-1", "fn__flex");
        let dragHTML = '<div class="layout-tab-container__drag fn__none"></div>';
        if (parentType === "left" || parentType === "right" || parentType === "top" || parentType === "bottom") {
            dragHTML = "";
        }
        this.element.innerHTML = `<div data-type="wnd" data-id="${this.id}" class="fn__flex-column fn__flex fn__flex-1">
    <div class="fn__flex fn__none">
        <ul class="fn__flex layout-tab-bar"></ul>
        <ul class="layout-tab-bar layout-tab-bar--readonly fn__flex-1">
            <li class="item item--readonly">
                <span data-type="new" class="item__close" title="${window.siyuan.languages.newFile}"><svg style="height: 10px;width: 10px;padding: 3px"><use xlink:href="#iconAdd"></use></svg></span>
                <span class="fn__flex-1"></span>
                <span data-type="more" data-menu="true" class="item__close" title="${window.siyuan.languages.more}"><svg><use xlink:href="#iconDown"></use></svg></span>
            </li>
        </ul>
    </div>
    <div class="layout-tab-container fn__flex-1">${dragHTML}</div>
</div>`;
        this.headersElement = this.element.querySelector(".layout-tab-bar");
        this.headersElement.addEventListener("mousedown", (event) => {
            // 点击鼠标滚轮关闭
            if (event.button !== 1) {
                return;
            }
            let target = event.target as HTMLElement;
            while (target && !target.isEqualNode(this.headersElement)) {
                if (target.tagName === "LI") {
                    this.removeTab(target.getAttribute("data-id"));
                    window.siyuan.menus.menu.remove();
                    event.stopPropagation();
                    event.preventDefault();
                    break;
                }
                target = target.parentElement;
            }

        });
        this.headersElement.addEventListener("mousewheel", (event: WheelEvent) => {
            this.headersElement.scrollLeft = this.headersElement.scrollLeft + event.deltaY;
        }, {passive: true});
        this.headersElement.parentElement.addEventListener("click", (event) => {
            let target = event.target as HTMLElement;
            while (target && !target.isEqualNode(this.headersElement)) {
                if (target.classList.contains("item__close") && target.getAttribute("data-type") === "new") {
                    setPanelFocus(this.headersElement.parentElement.parentElement);
                    newFile(undefined, undefined, true);
                    break;
                } else if (target.classList.contains("item__close") && target.getAttribute("data-type") === "more") {
                    this.renderTabList(event);
                    break;
                } else if (target.tagName === "LI" && target.getAttribute("data-id")) {
                    this.switchTab(target, true);
                    break;
                }
                target = target.parentElement;
            }
        });
        this.headersElement.addEventListener("dblclick", (event) => {
            if (window.siyuan.config.fileTree.openFilesUseCurrentTab) {
                let target = event.target as HTMLElement;
                while (target && !target.isEqualNode(this.headersElement)) {
                    if (target.tagName === "LI") {
                        target.classList.remove("item--unupdate");
                        break;
                    }
                    target = target.parentElement;
                }
            }
        });
        const dragElement = this.element.querySelector(".layout-tab-container__drag") as HTMLElement;
        if (!dragElement) {
            return;
        }
        this.element.addEventListener("dragenter", (event: DragEvent & { target: HTMLElement }) => {
            if (event.dataTransfer.types.includes(Constants.SIYUAN_DROP_TAB)) {
                const tabHeadersElement = hasClosestByClassName(event.target, "layout-tab-bar");
                if (tabHeadersElement) {
                    return;
                }
                const tabPanelsElement = hasClosestByClassName(event.target, "layout-tab-container", true);
                if (tabPanelsElement) {
                    dragElement.classList.remove("fn__none");
                    dragElement.setAttribute("style", "height:100%;width:100%;right:auto;bottom:auto");
                }
            }
        });
        this.headersElement.addEventListener("dragover", function (event: DragEvent & { target: HTMLElement }) {
            const it = this as HTMLElement;
            if (event.dataTransfer.types.includes(Constants.SIYUAN_DROP_FILE)) {
                event.preventDefault();
                it.style.opacity = ".1";
                return;
            }
            if (!event.dataTransfer.types.includes(Constants.SIYUAN_DROP_TAB) || !window.siyuan.dragElement) {
                return;
            }
            event.preventDefault();
            const newTabHeaderElement = hasClosestByTag(event.target, "LI");
            let oldTabHeaderElement = window.siyuan.dragElement;
            let exitDrag = false;
            Array.from(it.childNodes).find((item: HTMLElement) => {
                if (item.style.opacity === "0.1") {
                    oldTabHeaderElement = item;
                    exitDrag = true;
                    return true;
                }
            });
            if (!newTabHeaderElement && !oldTabHeaderElement.classList.contains("item--pin")) {
                it.classList.add("layout-tab-bar--drag");
            }
            if (!exitDrag) {
                if (oldTabHeaderElement.classList.contains("item--pin")) {
                    return;
                }
                oldTabHeaderElement = oldTabHeaderElement.cloneNode(true) as HTMLElement;
                oldTabHeaderElement.setAttribute("data-clone", "true");
                it.append(oldTabHeaderElement);
                return;
            }
            if (!newTabHeaderElement) {
                return;
            }
            if (!newTabHeaderElement.isSameNode(oldTabHeaderElement) &&
                ((oldTabHeaderElement.classList.contains("item--pin") && newTabHeaderElement.classList.contains("item--pin")) ||
                    (!oldTabHeaderElement.classList.contains("item--pin") && !newTabHeaderElement.classList.contains("item--pin")))) {
                const rect = newTabHeaderElement.getClientRects()[0];
                if (event.clientX > rect.left + rect.width / 2) {
                    newTabHeaderElement.after(oldTabHeaderElement);
                } else {
                    newTabHeaderElement.before(oldTabHeaderElement);
                }
            }
        });
        this.headersElement.addEventListener("dragleave", function () {
            const it = this as HTMLElement;
            it.classList.remove("layout-tab-bar--drag");
            document.querySelectorAll(".layout-tab-bar").forEach(item => {
                if (item !== it) {
                    const cloneElement = item.querySelector("li[data-clone='true']");
                    if (cloneElement) {
                        cloneElement.remove();
                    }
                }
            });
            it.style.opacity = "";
        });
        this.headersElement.addEventListener("drop", function (event: DragEvent & { target: HTMLElement }) {
            const it = this as HTMLElement;
            if (event.dataTransfer.types.includes(Constants.SIYUAN_DROP_FILE)) {
                // 文档树拖拽
                setPanelFocus(it.parentElement.parentElement);
                event.dataTransfer.getData(Constants.SIYUAN_DROP_FILE).split(",").forEach(item => {
                    if (item) {
                        openFileById({
                            id: item,
                            action: [Constants.CB_GET_FOCUS, Constants.CB_GET_SCROLL]
                        });
                    }
                });
                window.siyuan.dragElement = undefined;
                it.style.opacity = "";
                return;
            }
            const oldTab = getInstanceById(event.dataTransfer.getData(Constants.SIYUAN_DROP_TAB)) as Tab;
            it.classList.remove("layout-tab-bar--drag");

            const nextTabHeaderElement = (Array.from(it.childNodes).find((item: HTMLElement) => {
                if (item.style.opacity === "0.1") {
                    return true;
                }
            }) as HTMLElement)?.nextElementSibling;

            if (!it.contains(oldTab.headElement)) {
                // 从其他 Wnd 拖动过来
                const cloneTabElement = it.querySelector("[data-clone='true']");
                if (!cloneTabElement) {
                    return;
                }
                cloneTabElement.before(oldTab.headElement);
                cloneTabElement.remove();
                if (oldTab.model instanceof Asset) {
                    // https://github.com/siyuan-note/siyuan/issues/6890
                    const pdfViewerElement = oldTab.model.element.querySelector("#viewerContainer");
                    if (pdfViewerElement) {
                        pdfViewerElement.setAttribute("data-scrolltop", pdfViewerElement.scrollTop.toString());
                    }
                }
                // 对象顺序
                const newWnd = getInstanceById(it.parentElement.parentElement.getAttribute("data-id")) as Wnd;
                newWnd.moveTab(oldTab, nextTabHeaderElement ? nextTabHeaderElement.getAttribute("data-id") : undefined);
                resizeTabs();
                return;
            }

            let tempTab: Tab;
            oldTab.parent.children.find((item, index) => {
                if (item.id === oldTab.id) {
                    tempTab = oldTab.parent.children.splice(index, 1)[0];
                    return true;
                }
            });
            if (nextTabHeaderElement) {
                oldTab.parent.children.find((item, index) => {
                    if (item.id === nextTabHeaderElement.getAttribute("data-id")) {
                        oldTab.parent.children.splice(index, 0, tempTab);
                        return true;
                    }
                });
            } else {
                oldTab.parent.children.push(tempTab);
            }
        });
        dragElement.addEventListener("dragover", (event: DragEvent & { layerX: number, layerY: number }) => {
            event.preventDefault();
            if (!dragElement.nextElementSibling) {
                return;
            }
            const rect = dragElement.parentElement.getBoundingClientRect();
            const height = rect.height;
            const width = rect.width;
            const x = event.clientX - rect.left;
            const y = event.clientY - rect.top;
            if ((x <= width / 3 && (y <= height / 8 || y >= height * 7 / 8)) ||
                (x <= width / 8 && (y > height / 8 || y < height * 7 / 8))) {
                dragElement.setAttribute("style", "height:100%;width:50%;right:50%;bottom:0;left:0;top:0");
            } else if ((x > width * 2 / 3 && (y <= height / 8 || y >= height * 7 / 8)) ||
                (x >= width * 7 / 8 && (y > height / 8 || y < height * 7 / 8))) {
                dragElement.setAttribute("style", "height:100%;width:50%;right:0;bottom:0;left:50%;top:0");
            } else if (x > width / 3 && x < width * 2 / 3 && y <= height / 8) {
                dragElement.setAttribute("style", "height:50%;width:100%;right:0;bottom:50%;left:0;top:0");
            } else if (x > width / 3 && x < width * 2 / 3 && y >= height * 7 / 8) {
                dragElement.setAttribute("style", "height:50%;width:100%;right:0;bottom:0;left:0;top:50%");
            } else {
                dragElement.setAttribute("style", "height:100%;width:100%;right:0;bottom:0;top:0;left:0");
            }
        });
        dragElement.addEventListener("dragleave", () => {
            dragElement.classList.add("fn__none");
        });
        dragElement.addEventListener("drop", (event: DragEvent & { target: HTMLElement }) => {
            dragElement.classList.add("fn__none");
            const targetWndElement = event.target.parentElement.parentElement;
            const targetWnd = getInstanceById(targetWndElement.getAttribute("data-id")) as Wnd;
            const tabId = event.dataTransfer.getData(Constants.SIYUAN_DROP_TAB);
            const oldTab = getInstanceById(tabId) as Tab;
            if (oldTab.model instanceof  Asset) {
                // https://github.com/siyuan-note/siyuan/issues/6890
                const pdfViewerElement = oldTab.model.element.querySelector("#viewerContainer");
                if (pdfViewerElement) {
                    pdfViewerElement.setAttribute("data-scrolltop", pdfViewerElement.scrollTop.toString());
                }
            }
            if (dragElement.style.height === "50%" || dragElement.style.width === "50%") {
                // split
                if (dragElement.style.height === "50%") {
                    // split to bottom
                    const newWnd = targetWnd.split("tb");
                    newWnd.headersElement.append(oldTab.headElement);
                    newWnd.headersElement.parentElement.classList.remove("fn__none");
                    newWnd.moveTab(oldTab);

                    if (dragElement.style.bottom === "50%" && newWnd.element.previousElementSibling && targetWnd.element.parentElement) {
                        // 交换位置
                        switchWnd(newWnd, targetWnd);
                    }
                } else if (dragElement.style.width === "50%") {
                    // split to right
                    const newWnd = targetWnd.split("lr");
                    newWnd.headersElement.append(oldTab.headElement);
                    newWnd.headersElement.parentElement.classList.remove("fn__none");
                    newWnd.moveTab(oldTab);

                    if (dragElement.style.right === "50%" && newWnd.element.previousElementSibling && targetWnd.element.parentElement) {
                        // 交换位置
                        switchWnd(newWnd, targetWnd);
                    }
                }
                return;
            }


            if (targetWndElement.contains(document.querySelector(`[data-id="${tabId}"]`))) {
                return;
            }
            if (targetWnd) {
                targetWnd.headersElement.append(oldTab.headElement);
                targetWnd.headersElement.parentElement.classList.remove("fn__none");
                targetWnd.moveTab(oldTab);
                resizeTabs();
            }
        });
    }

    public showHeading() {
        const currentElement = this.headersElement.querySelector(".item--focus") as HTMLElement;
        if (!currentElement) {
            return;
        }
        if (currentElement.offsetLeft + currentElement.clientWidth > this.headersElement.scrollLeft + this.headersElement.clientWidth) {
            this.headersElement.scrollLeft = currentElement.offsetLeft + currentElement.clientWidth - this.headersElement.clientWidth;
        } else if (currentElement.offsetLeft < this.headersElement.scrollLeft) {
            this.headersElement.scrollLeft = currentElement.offsetLeft;
        }
    }

    public switchTab(target: HTMLElement, pushBack = false, update = true) {
        setPanelFocus(this.headersElement.parentElement.parentElement);
        let currentTab: Tab;
        this.children.forEach((item) => {
            if (target === item.headElement) {
                if (item.headElement && item.headElement.classList.contains("fn__none")) {
                    // https://github.com/siyuan-note/siyuan/issues/267
                } else {
                    if (item.headElement) {
                        item.headElement.classList.add("item--focus");
                        item.headElement.setAttribute("data-activetime", (new Date()).getTime().toString());
                    }
                    item.panelElement.classList.remove("fn__none");
                }
                currentTab = item;
            } else {
                item.headElement?.classList.remove("item--focus");
                if (!item.panelElement.classList.contains("fn__none")) {
                    // 必须现判断，否则会触发 observer.observe(this.element, {attributeFilter: ["class"]}); 导致 https://ld246.com/article/1641198819303
                    item.panelElement.classList.add("fn__none");
                }
            }
        });
        if (currentTab) {
            const initData = currentTab.headElement.getAttribute("data-initdata");
            if (initData) {
                const json = JSON.parse(initData);
                currentTab.addModel(new Editor({
                    tab: currentTab,
                    blockId: json.blockId,
                    mode: json.mode,
                    action: typeof json.action === "string" ? [json.action] : json.action,
                    scrollAttr: json.scrollAttr,
                }));
                currentTab.headElement.removeAttribute("data-initdata");
                return;
            }
        }

        if (currentTab && target === currentTab.headElement) {
            if (currentTab.model instanceof Graph) {
                currentTab.model.onGraph(false);
            } else if (currentTab.model instanceof Asset && currentTab.model.pdfObject) {
                // https://github.com/siyuan-note/siyuan/issues/5655
                currentTab.model.pdfObject.pdfViewer.container.focus();
            }
        }

        if (currentTab && currentTab.model instanceof Editor) {
            const keepCursorId = currentTab.headElement.getAttribute("keep-cursor");
            if (keepCursorId) {
                // 在新页签中打开，但不跳转到新页签，但切换到新页签时需调整滚动
                let nodeElement: HTMLElement;
                Array.from(currentTab.model.editor.protyle.wysiwyg.element.querySelectorAll(`[data-node-id="${keepCursorId}"]`)).find((item: HTMLElement) => {
                    if (!hasClosestByAttribute(item, "data-type", "NodeBlockQueryEmbed", true)) {
                        nodeElement = item;
                        return true;
                    }
                });
                if (nodeElement) {
                    if (!currentTab.model.editor.protyle.toolbar.range) {
                        const range = document.createRange();
                        range.selectNodeContents(nodeElement);
                        range.collapse();
                        currentTab.model.editor.protyle.toolbar.range = range;
                    }
                    scrollCenter(currentTab.model.editor.protyle, nodeElement, true);
                } else {
                    openFileById({
                        id: keepCursorId,
                        action: [Constants.CB_GET_FOCUS, Constants.CB_GET_CONTEXT]
                    });
                }
                currentTab.headElement.removeAttribute("keep-cursor");
            }
            // focusin 触发前，layout__wnd--active 和 tab 已设置，需在调用里面更新
            if (update) {
                updatePanelByEditor(currentTab.model.editor.protyle, true, pushBack);
            }
        } else {
            updatePanelByEditor(undefined, false);
        }
    }

    public addTab(tab: Tab, keepCursor = false) {
        if (keepCursor) {
            tab.headElement?.classList.remove("item--focus");
            tab.panelElement.classList.add("fn__none");
        }
        let oldFocusIndex = 0;
        this.children.forEach((item, index) => {
            if (item.headElement && item.headElement.classList.contains("item--focus")) {
                oldFocusIndex = index;
                let nextElement = item.headElement.nextElementSibling;
                while (nextElement && nextElement.classList.contains("item--pin")) {
                    oldFocusIndex++;
                    nextElement = nextElement.nextElementSibling;
                }
            }
            if (!keepCursor) {
                item.headElement?.classList.remove("item--focus");
                item.panelElement.classList.add("fn__none");
            }
        });

        this.children.splice(oldFocusIndex + 1, 0, tab);

        if (tab.headElement) {
            this.headersElement.parentElement.classList.remove("fn__none");
            if (this.headersElement.childElementCount === 0) {
                this.headersElement.append(tab.headElement);
            } else {
                this.headersElement.children[oldFocusIndex].after(tab.headElement);
            }
            tab.headElement.querySelector(".item__close").addEventListener("click", (event) => {
                if (tab.headElement.classList.contains("item--pin")) {
                    tab.unpin();
                } else {
                    tab.parent.removeTab(tab.id);
                }
                window.siyuan.menus.menu.remove();
                event.stopPropagation();
                event.preventDefault();
            });

            tab.headElement.setAttribute("data-activetime", (new Date()).getTime().toString());
        }
        const containerElement = this.element.querySelector(".layout-tab-container");
        if (!containerElement.querySelector(".fn__flex-1")) {
            // empty center
            containerElement.append(tab.panelElement);
        } else if (!containerElement.querySelector(".layout-tab-container__drag")) {
            // Dock
            containerElement.children[oldFocusIndex].after(tab.panelElement);
        } else {
            containerElement.children[oldFocusIndex + 1].after(tab.panelElement);
        }

        tab.parent = this;
        if (tab.callback) {
            tab.callback(tab);
        }
        // 移除 centerLayout 中的 empty
        if (this.parent.type === "center" && this.children.length === 2 && !this.children[0].headElement) {
            this.removeTab(this.children[0].id);
        } else if (this.children.length > window.siyuan.config.fileTree.maxOpenTabCount) {
            this.removeOverCounter(oldFocusIndex);
        }
    }

    private renderTabList(event: MouseEvent) {
        window.siyuan.menus.menu.remove();
        window.siyuan.menus.menu.element.classList.add("b3-menu--list");
        Array.from(this.headersElement.children).forEach((item: HTMLElement) => {
            const iconElement = item.querySelector(".item__icon");
            const graphicElement = item.querySelector(".item__graphic");
            window.siyuan.menus.menu.append(new MenuItem({
                label: escapeHtml(item.querySelector(".item__text").textContent),
                action: "iconClose",
                iconHTML: iconElement ? `<span class="b3-menu__icon">${iconElement.innerHTML}</span>` : "",
                icon: graphicElement ? graphicElement.firstElementChild.getAttribute("xlink:href").substring(1) : "",
                bind: (element) => {
                    element.addEventListener("click", (event) => {
                        if (hasClosestByTag(event.target as Element, "svg")) {
                            this.removeTab(item.getAttribute("data-id"));
                            if (element.previousElementSibling || element.nextElementSibling) {
                                element.remove();
                            } else {
                                window.siyuan.menus.menu.remove();
                            }
                        } else {
                            this.switchTab(item, true);
                            this.showHeading();
                            window.siyuan.menus.menu.remove();
                        }
                        event.preventDefault();
                        event.stopPropagation();
                    });
                },
                current: item.classList.contains("item--focus")
            }).element);
        });
        window.siyuan.menus.menu.popup({
            x: event.clientX,
            y: event.clientY,
            w: 16
        });
    }

    private removeOverCounter(oldFocusIndex?: number) {
        if (typeof oldFocusIndex === "undefined") {
            this.children.forEach((item, index) => {
                if (item.headElement && item.headElement.classList.contains("item--focus")) {
                    oldFocusIndex = index;
                }
            });
        }
        let removeId: string;
        let openTime: string;
        this.children.forEach((item, index) => {
            if (item.headElement.classList.contains("item--pin") ||
                item.headElement.classList.contains("item--focus") ||
                index === oldFocusIndex) {
                return;
            }
            if (!openTime) {
                openTime = item.headElement.getAttribute("data-activetime");
                removeId = this.children[index].id;
            } else if (item.headElement.getAttribute("data-activetime") < openTime) {
                openTime = item.headElement.getAttribute("data-activetime");
                removeId = this.children[index].id;
            }
        });
        if (removeId) {
            this.removeTab(removeId);
        }
    }

    private destroyModel(model: Model) {
        if (!model) {
            return;
        }
        if (model instanceof Editor && model.editor) {
            window.siyuan.blockPanels.forEach((item) => {
                if (item.element && model.editor.protyle.wysiwyg.element.contains(item.element)) {
                    item.destroy();
                }
            });
            model.editor.destroy();
            return;
        }
        if (model instanceof Search) {
            if (model.edit) {
                model.edit.destroy();
            }
            return;
        }
        if (model instanceof Asset) {
            if (model.pdfObject && model.pdfObject.pdfLoadingTask) {
                model.pdfObject.pdfLoadingTask.destroy();
            }
        }
        model.send("closews", {});
    }

    private removeTabAction = (id: string, closeAll = false, hasSaveScroll = true, animate = true) => {
        clearCounter();
        this.children.find((item, index) => {
            if (item.id === id) {
                if (item.model instanceof Editor && hasSaveScroll) {
                    saveScroll(item.model.editor.protyle);
                }
                if (this.children.length === 1) {
                    this.destroyModel(this.children[0].model);
                    this.children = [];
                    if (["top", "bottom", "left", "right"].includes(this.parent.type)) {
                        item.panelElement.remove();
                    } else {
                        this.remove();
                    }
                    // 关闭分屏页签后光标消失
                    const editors = getAllModels().editor;
                    if (editors.length === 0) {
                        updatePanelByEditor();
                    } else {
                        editors.forEach(item => {
                            if (!item.element.classList.contains("fn__none")) {
                                setPanelFocus(item.parent.parent.headersElement.parentElement.parentElement);
                                updatePanelByEditor(item.editor.protyle, true, true);
                                return;
                            }
                        });
                    }
                    return;
                }
                if (item.headElement) {
                    if (item.headElement.classList.contains("item--focus")) {
                        let currentIndex = index + 1;
                        if (index === this.children.length - 1) {
                            currentIndex = index - 1;
                        }
                        if (this.children[currentIndex] && !closeAll) {
                            this.switchTab(this.children[currentIndex].headElement, true);
                        }
                    }
                    if (animate) {
                        item.headElement.setAttribute("style", "max-width: 0px;");
                        setTimeout(() => {
                            item.headElement.remove();
                        }, Constants.TIMEOUT_TRANSITION);
                    } else {
                        item.headElement.remove();
                    }
                }
                item.panelElement.remove();
                this.destroyModel(item.model);
                this.children.splice(index, 1);
                resizeTabs();
                return true;
            }
        });
        // 初始化移除窗口，但 centerLayout 还没有赋值 https://ld246.com/article/1658718634416
        if (window.siyuan.layout.centerLayout) {
            const wnd = getWndByLayout(window.siyuan.layout.centerLayout);
            if (!wnd) {
                const wnd = new Wnd();
                window.siyuan.layout.centerLayout.addWnd(wnd);
                wnd.addTab(newCenterEmptyTab());
            }
        }
        /// #if !BROWSER
        webFrame.clearCache();
        getCurrentWindow().webContents.session.clearCache();
        /// #endif
    };

    public removeTab(id: string, closeAll = false, needSaveScroll = true, animate = true) {
        for (let index = 0; index < this.children.length; index++) {
            const item = this.children[index];
            if (item.id === id) {
                if ((item.model instanceof Editor) && item.model.editor?.protyle) {
                    if (item.model.editor.protyle.upload.isUploading) {
                        showMessage(window.siyuan.languages.uploading);
                        return;
                    }
                    this.removeTabAction(id, closeAll, needSaveScroll, animate);
                } else {
                    this.removeTabAction(id, closeAll, needSaveScroll, animate);
                }
                return;
            }
        }
    }

    public moveTab(tab: Tab, nextId?: string) {
        this.element.querySelector(".layout-tab-container").append(tab.panelElement);
        if (tab.model instanceof Editor) {
            // DOM 移动后 range 会变化，因此置空
            tab.model.editor.protyle.toolbar.range = null;
        }
        if (nextId) {
            // 只能用 find https://github.com/siyuan-note/siyuan/issues/3455
            this.children.find((item, index) => {
                if (item.id === nextId) {
                    this.children.splice(index, 0, tab);
                    return true;
                }
            });
        } else {
            this.children.push(tab);
        }
        if (this.children.length > window.siyuan.config.fileTree.maxOpenTabCount) {
            this.removeOverCounter();
        }
        this.switchTab(tab.headElement);

        const oldWnd = tab.parent;
        if (oldWnd.children.length === 1) {
            oldWnd.children = [];
            oldWnd.remove();
        } else {
            oldWnd.children.find((item, index) => {
                if (item.id === tab.id) {
                    oldWnd.children.splice(index, 1);
                    resizeTabs();
                    return true;
                }
            });
            oldWnd.switchTab(oldWnd.children[oldWnd.children.length - 1].headElement);
        }
        tab.parent = this;
        resizeTabs();
    }

    public split(direction: TDirection) {
        if (this.children.length === 1 && !this.children[0].headElement) {
            // 场景：没有打开的文档，点击标签面板打开
            return this;
        }
        const wnd = new Wnd(direction);
        if (direction === this.parent.direction) {
            this.parent.addWnd(wnd, this.id);
        } else if (this.parent.children.length === 1) {
            // layout 仅含一个时，只需更新 direction
            this.parent.direction = direction;
            if (direction === "tb") {
                this.parent.element.classList.add("fn__flex-column");
                this.parent.element.classList.remove("fn__flex");
            } else {
                this.parent.element.classList.remove("fn__flex-column");
                this.parent.element.classList.add("fn__flex");
            }
            this.parent.addWnd(wnd, this.id);
        } else {
            this.parent.children.find((item, index) => {
                if (item.id === this.id) {
                    const layout = new Layout({
                        resize: item.resize,
                        direction,
                    });
                    this.parent.addLayout(layout, item.id);
                    const movedWnd = this.parent.children.splice(index, 1)[0];
                    if (movedWnd.resize) {
                        movedWnd.element.previousElementSibling.remove();
                        movedWnd.resize = undefined;
                    }
                    layout.addWnd.call(layout, movedWnd);
                    layout.addWnd.call(layout, wnd);

                    if (direction === "tb" && movedWnd.element.style.width) {
                        layout.element.style.width = movedWnd.element.style.width;
                        layout.element.classList.remove("fn__flex-1");
                        movedWnd.element.style.width = "";
                        movedWnd.element.classList.add("fn__flex-1");
                    } else if (direction === "lr" && movedWnd.element.style.height) {
                        layout.element.style.height = movedWnd.element.style.height;
                        layout.element.classList.remove("fn__flex-1");
                        movedWnd.element.style.height = "";
                        movedWnd.element.classList.add("fn__flex-1");
                    }
                    return true;
                }
            });
        }
        return wnd;
    }

    private remove() {
        let layout = this.parent;
        let element = this.element;
        let id = this.id;
        while (layout && layout.children.length === 1 && "center" !== layout.type) {
            id = layout.id;
            element = layout.element;
            layout = layout.parent;
        }

        layout.children.find((item, index) => {
            if (item.id === id) {
                if (layout.children.length > 1) {
                    let previous = layout.children[index - 1];
                    if (index === 0) {
                        previous = layout.children[1];
                    }
                    if (layout.children.length === 2) {
                        if (layout.direction === "lr") {
                            previous.element.style.width = "";
                        } else {
                            previous.element.style.height = "";
                        }
                        previous.resize = undefined;
                        previous.element.classList.add("fn__flex-1");
                    } else if (!previous.element.classList.contains("fn__flex-1")) {
                        // 分屏后要均分 https://github.com/siyuan-note/siyuan/issues/5657
                        if (layout.direction === "lr") {
                            previous.element.style.width = (previous.element.clientWidth + element.clientWidth) + "px";
                        } else {
                            previous.element.style.height = (previous.element.clientHeight + element.clientHeight) + "px";
                        }
                    }
                    // https://github.com/siyuan-note/siyuan/issues/5844
                    if (layout.children.length > 2 && index === 0) {
                        layout.children[1].resize = undefined;
                    }
                }
                layout.children.splice(index, 1);
                return true;
            }
        });
        if (element.previousElementSibling && element.previousElementSibling.classList.contains("layout__resize")) {
            element.previousElementSibling.remove();
        } else if (element.nextElementSibling && element.nextElementSibling.classList.contains("layout__resize")) {
            element.nextElementSibling.remove();
        }
        element.remove();
        resizeTabs();
    }
}

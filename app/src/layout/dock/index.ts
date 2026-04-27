import {setStorageVal, updateHotkeyTip} from "../../protyle/util/compatibility";
import {Layout} from "../index";
import {Wnd} from "../Wnd";
import {Tab} from "../Tab";
import {Files} from "./Files";
import {Outline} from "./Outline";
import {getAllModels, getAllTabs} from "../getAll";
import {Bookmark} from "./Bookmark";
import {Tag} from "./Tag";
import {Graph} from "./Graph";
import {Model} from "../Model";
import {adjustLayout, saveLayout, setPanelFocus} from "../util";
import {getDockByType, resizeTabs} from "../tabUtil";
import {Inbox} from "./Inbox";
import {Protyle} from "../../protyle";
import {Backlink} from "./Backlink";
import {adjustDockPadding, resetFloatDockSize} from "./util";
import {hasClosestByAttribute, hasClosestByClassName} from "../../protyle/util/hasClosest";
import {App} from "../../index";
import {Plugin} from "../../plugin";
import {Custom} from "./Custom";
import {clearBeforeResizeTop, recordBeforeResizeTop} from "../../protyle/util/resize";
import {Constants} from "../../constants";

const TYPES = ["file", "outline", "inbox", "bookmark", "tag", "graph", "globalGraph", "backlink"];

export class Dock {
    public elements: HTMLElement[];
    public layout: Layout;
    private position: TDockPosition;
    private app: App;
    public resizeElement: HTMLElement;
    public pin = true;
    public data: { [key in TDock | string]?: Model | boolean };
    private hideResizeTimeout: number;

    constructor(options: {
        app: App,
        data: {
            pin: boolean,
            data: Config.IUILayoutDockTab[][]
        },
        position: TDockPosition
    }) {
        switch (options.position) {
            case "Left":
                this.layout = window.siyuan.layout.layout.children[0].children[0] as Layout;
                this.resizeElement = this.layout.element.nextElementSibling as HTMLElement;
                this.layout.element.classList.add("layout__dockl");
                this.layout.element.insertAdjacentHTML("beforeend", '<div class="layout__dockresize layout__dockresize--lr"></div>');
                this.elements = Array.from(document.querySelectorAll(`#dock${options.position} .dock__items`));
                break;
            case "Right":
                this.layout = window.siyuan.layout.layout.children[0].children[2] as Layout;
                this.resizeElement = this.layout.element.previousElementSibling as HTMLElement;
                this.layout.element.classList.add("layout__dockr");
                this.layout.element.insertAdjacentHTML("beforeend", '<div class="layout__dockresize layout__dockresize--lr"></div>');
                this.elements = Array.from(document.querySelectorAll(`#dock${options.position} .dock__items`));
                break;
            case "Bottom":
                this.layout = window.siyuan.layout.layout.children[1] as Layout;
                this.resizeElement = this.layout.element.previousElementSibling as HTMLElement;
                this.layout.element.classList.add("layout__dockb");
                this.layout.element.insertAdjacentHTML("beforeend", '<div class="layout__dockresize"></div>');
                this.elements = [document.getElementById("dockLeft").lastElementChild as HTMLElement, document.getElementById("dockRight").lastElementChild as HTMLElement];
                break;
        }
        this.app = options.app;
        this.position = options.position;
        this.pin = options.data.pin;
        this.data = {};
        if (options.data.data[0]) {
            this.genButton(options.data.data[0], 0);
        }
        if (options.data.data[1]) {
            this.genButton(options.data.data[1], 1);
        }
        const activeElements = [this.elements[0].querySelector(".dock__item--active"),
            this.elements[1].querySelector(".dock__item--active")];
        // 初始化文件树
        const fileElement = document.querySelector('.dock__item[data-type="file"]');
        if (fileElement && !fileElement.classList.contains("dock__item--active") &&
            (this.elements[0].contains(fileElement) || this.elements[1].contains(fileElement))) {
            this.toggleModel("file", true, false, false, false);
            this.toggleModel("file", false, false, false, false);
        }

        if (!activeElements[0] && !activeElements[1]) {
            this.resizeElement.classList.add("fn__none");
            // 如果没有打开的侧栏，隐藏 layout 的子元素
            if (this.layout.children.length > 1) {
                this.layout.children.forEach(child => {
                    child.element.classList.add("fn__none");
                });
                this.layout.children[0].element.nextElementSibling?.classList.add("fn__none");
            }
        } else {
            activeElements.forEach(item => {
                if (item) {
                    this.toggleModel(item.getAttribute("data-type") as TDock, true, false, false, false);
                }
            });
        }
        if (this.position !== "Bottom") {
            this.elements[0].parentElement.addEventListener("mousedown", (event: MouseEvent) => {
                const item = hasClosestByClassName(event.target as HTMLElement, "dock__item");
                if (!item || !item.getAttribute("data-type")) {
                    return;
                }
                const documentSelf = document;
                documentSelf.ondragstart = () => false;
                let ghostElement: HTMLElement;
                let selectItem: HTMLElement;
                const moveItem = document.createElement("span");
                moveItem.classList.add("dock__item", "fn__none");
                moveItem.style.background = "var(--b3-theme-primary-light)";
                moveItem.innerHTML = "<svg></svg>";
                moveItem.id = "dockMoveItem";
                document.querySelectorAll(".dock__split").forEach((splitItem: HTMLElement) => {
                    splitItem.style.setProperty("display", "block", "important");
                });
                documentSelf.onmousemove = (moveEvent: MouseEvent) => {
                    if (window.siyuan.config.readonly ||
                        Math.abs(moveEvent.clientY - event.clientY) < 3 && Math.abs(moveEvent.clientX - event.clientX) < 3) {
                        return;
                    }
                    moveEvent.preventDefault();
                    moveEvent.stopPropagation();
                    if (!ghostElement) {
                        item.style.opacity = "0.38";
                        ghostElement = item.cloneNode(true) as HTMLElement;
                        ghostElement.setAttribute("data-ghost-type", "dock");
                        this.elements[0].parentElement.append(ghostElement);
                        ghostElement.setAttribute("id", "dragGhost");
                        ghostElement.setAttribute("style", `background-color:var(--b3-theme-background-light);position: fixed; top: ${event.clientY}px; left: ${event.clientX}px; z-index:999997;`);
                    }

                    ghostElement.style.top = (moveEvent.clientY - 42) + "px";
                    ghostElement.style.left = (moveEvent.clientX - 21) + "px";

                    const targetItem = hasClosestByClassName(moveEvent.target as HTMLElement, "dock__item") ||
                        hasClosestByClassName(moveEvent.target as HTMLElement, "dock__split") as HTMLElement ||
                        hasClosestByClassName(moveEvent.target as HTMLElement, "dock__item--space") as HTMLElement;
                    if (targetItem && selectItem && targetItem === selectItem) {
                        if (selectItem.classList.contains("dock__item--space") ||
                            selectItem.classList.contains("dock__split")) {
                            const selectRect = selectItem.getBoundingClientRect();
                            if (moveEvent.clientY > selectRect.top + selectRect.height / 2) {
                                if (selectItem.nextElementSibling && item === selectItem.nextElementSibling.firstElementChild) {
                                    moveItem.classList.add("fn__none");
                                } else {
                                    selectItem.nextElementSibling.insertAdjacentElement("afterbegin", moveItem);
                                    moveItem.classList.remove("fn__none");
                                }
                            } else {
                                if (selectItem.nextElementSibling && item === selectItem.previousElementSibling.lastElementChild) {
                                    moveItem.classList.add("fn__none");
                                } else {
                                    selectItem.previousElementSibling.insertAdjacentElement("beforeend", moveItem);
                                    moveItem.classList.remove("fn__none");
                                }
                            }
                        } else if (selectItem.classList.contains("dock__item")) {
                            const selectRect = selectItem.getBoundingClientRect();
                            if (selectRect.top + selectRect.height / 2 > moveEvent.clientY) {
                                if (item.nextElementSibling && item.nextElementSibling === selectItem) {
                                    moveItem.classList.add("fn__none");
                                } else {
                                    moveItem.classList.remove("fn__none");
                                    selectItem.before(moveItem);
                                }
                            } else {
                                if (item.previousElementSibling && item.previousElementSibling === selectItem) {
                                    moveItem.classList.add("fn__none");
                                } else {
                                    moveItem.classList.remove("fn__none");
                                    selectItem.after(moveItem);
                                }
                            }
                        }
                        return;
                    }
                    if (!targetItem || targetItem.style.position === "fixed" || (targetItem === item) || targetItem.id === "dockMoveItem") {
                        if (targetItem && targetItem === item) {
                            moveItem.classList.add("fn__none");
                        }
                        return;
                    }
                    selectItem = targetItem;
                };

                documentSelf.onmouseup = () => {
                    documentSelf.onmousemove = null;
                    documentSelf.onmouseup = null;
                    documentSelf.ondragstart = null;
                    documentSelf.onselectstart = null;
                    documentSelf.onselect = null;
                    ghostElement?.remove();
                    if (item.style.opacity !== "0.38") {
                        return;
                    }
                    document.querySelectorAll(".dock__split").forEach((item: HTMLElement) => {
                        item.style.display = "";
                    });
                    item.style.opacity = "";
                    if (!moveItem.classList.contains("fn__none")) {
                        let dock;
                        if (window.siyuan.layout.leftDock.elements[0].contains(moveItem) ||
                            window.siyuan.layout.leftDock.elements[1].contains(moveItem)) {
                            dock = window.siyuan.layout.leftDock;
                        } else if (window.siyuan.layout.rightDock.elements[0].contains(moveItem) ||
                            window.siyuan.layout.rightDock.elements[1].contains(moveItem)) {
                            dock = window.siyuan.layout.rightDock;
                        } else if (window.siyuan.layout.bottomDock.elements[0].contains(moveItem) ||
                            window.siyuan.layout.bottomDock.elements[1].contains(moveItem)) {
                            dock = window.siyuan.layout.bottomDock;
                        }
                        dock.add(dock.elements[0].contains(moveItem) ? 0 : 1,
                            item, moveItem.previousElementSibling?.getAttribute("data-type"));
                    }
                    moveItem.remove();
                };
            });
        }

        this.layout.element.addEventListener("mouseleave", (event: MouseEvent & { toElement: HTMLElement }) => {
            if (event.buttons !== 0 || this.pin || event.toElement?.classList.contains("b3-menu") ||
                event.toElement?.classList.contains("tooltip")) {
                return;
            }
            if (this.position === "Left" && event.clientX < 43) {
                return;
            }
            if (this.position === "Right" && event.clientX > window.innerWidth - 43) {
                return;
            }
            if (this.position === "Bottom" && event.clientY > window.innerHeight - 73) {
                return;
            }
            this.hideDock();
        });

        this.layout.element.querySelector(".layout__dockresize").addEventListener("mousedown", (event: MouseEvent) => {
            const documentSelf = document;
            const direction = this.position === "Bottom" ? "tb" : "lr";
            const x = event[direction === "lr" ? "clientX" : "clientY"];
            const currentSize = direction === "lr" ? this.layout.element.clientWidth : this.layout.element.clientHeight;
            documentSelf.onmousemove = (moveEvent: MouseEvent) => {
                moveEvent.preventDefault();
                moveEvent.stopPropagation();
                let currentNowSize;
                if (this.position === "Left") {
                    currentNowSize = (currentSize + (moveEvent.clientX - x));
                } else if (this.position === "Right") {
                    currentNowSize = (currentSize + (x - moveEvent.clientX));
                } else {
                    currentNowSize = (currentSize + (x - moveEvent.clientY));
                }
                let minSize = 232;
                Array.from(this.layout.element.querySelectorAll(".file-tree")).find((item) => {
                    if (item.classList.contains("sy__backlink") || item.classList.contains("sy__graph")
                        || item.classList.contains("sy__globalGraph") || item.classList.contains("sy__inbox")) {
                        if (!item.classList.contains("fn__none") && !hasClosestByClassName(item, "fn__none")) {
                            minSize = 320;
                            return true;
                        }
                    }
                });
                if (currentNowSize < minSize && direction === "lr") {
                    return;
                }
                if (currentNowSize < 64 && direction === "tb") {
                    return;
                }
                this.layout.element.style[direction === "lr" ? "width" : "height"] = currentNowSize + "px";
            };

            documentSelf.onmouseup = () => {
                documentSelf.onmousemove = null;
                documentSelf.onmouseup = null;
                documentSelf.ondragstart = null;
                documentSelf.onselectstart = null;
                documentSelf.onselect = null;
                this.setSize();
                [...this.elements[0].querySelectorAll(".dock__item--active"), ...this.elements[0].querySelectorAll(".dock__item--active")].forEach(item => {
                    const customModel = this.data[item.getAttribute("data-type") as TDock];
                    if (customModel && customModel instanceof Custom && customModel.resize) {
                        customModel.resize();
                    }
                });
            };
        });

        if (window.siyuan.config.uiLayout.hideDock) {
            this.elements[0].parentElement.classList.add("fn__none");
        }
        if (!this.pin) {
            setTimeout(() => {
                this.resetDockPosition(false);
                this.hideDock(true);
                this.layout.element.classList.add("layout--float");
                this.resizeElement.classList.add("fn__none");
            });   // 需等待所有 Dock 初始化完成后才有稳定布局，才可进行定位
        }
    }

    public togglePin() {
        this.pin = !this.pin;
        const hasActive = this.elements[0].querySelector(".dock__item--active") ||
            this.elements[1].querySelector(".dock__item--active");
        if (!this.pin) {
            this.resetDockPosition(hasActive ? true : false);
            this.resizeElement.classList.add("fn__none");
            if (hasActive) {
                this.showDock(true);
            } else {
                this.hideDock(true);
            }
        } else {
            this.layout.element.style.opacity = "";
            this.layout.element.style.transform = "";
            this.layout.element.style.zIndex = "";
            if (hasActive) {
                this.resizeElement.classList.remove("fn__none");
            }
        }
        this.layout.element.classList.toggle("layout--float");
        resizeTabs();
    }

    public resetDockPosition(show: boolean) {
        if (this.position === "Left") {
            this.layout.element.setAttribute("style", `width:${this.layout.element.clientWidth}px;opacity:${show ? 1 : 0};`);
        } else if (this.position === "Right") {
            this.layout.element.setAttribute("style", `width:${this.layout.element.clientWidth}px;opacity:${show ? 1 : 0};`);
        } else {
            this.layout.element.setAttribute("style", `height:${this.layout.element.clientHeight}px;opacity:${show ? 1 : 0};`);
        }
    }

    public showDock(reset = false) {
        if (!reset && (this.pin || this.layout.element.style.opacity === "1") ||
            (!this.elements[0].querySelector(".dock__item--active") && !this.elements[1].querySelector(".dock__item--active"))
        ) {
            return;
        }
        if (!reset && (this.position === "Left" || this.position === "Right") &&
            this.layout.element.clientWidth === 0 && this.layout.element.style.width.startsWith("0")) {
            return;
        }
        if (!reset && this.position === "Bottom" &&
            this.layout.element.clientHeight === 0 && this.layout.element.style.height.startsWith("0")) {
            return;
        }
        if ((
            document.querySelector(".b3-dialog") ||
            document.querySelector(".block__popover") ||
            document.querySelector("#commonMenu:not(.fn__none)")
        ) && (
            window.siyuan.layout.leftDock?.layout.element.style.opacity === "1" ||
            window.siyuan.layout.rightDock?.layout.element.style.opacity === "1" ||
            window.siyuan.layout.bottomDock?.layout.element.style.opacity === "1"
        )) {
            return;
        }

        if (!reset) {
            this.layout.element.style.opacity = "1";
        }
        this.layout.element.style.transform = "";
        this.layout.element.style.zIndex = (++window.siyuan.zIndex).toString();
        if (this.position === "Left") {
            this.layout.element.style.left = `${this.elements[0].clientWidth}px`;
        } else if (this.position === "Right") {
            this.layout.element.style.right = `${this.elements[0].clientWidth}px`;
        } else if (this.position === "Bottom") {
            this.layout.element.style.bottom = `${document.getElementById("status").offsetHeight}px`;
            this.layout.element.style.left = this.elements[0].clientWidth + "px";
            this.layout.element.style.right = this.elements[1].clientWidth + "px";
        }
    }

    public hideDock(reset = false) {
        if (!reset && (this.layout.element.style.opacity === "0" || this.pin)) {
            return;
        }
        // 关系图全屏不应该退出 & https://github.com/siyuan-note/siyuan/issues/11775
        const fullscreenElement = this.layout.element.querySelector(".fullscreen");
        if (fullscreenElement && fullscreenElement.clientHeight > 0) {
            return;
        }
        // https://github.com/siyuan-note/siyuan/issues/7504
        if (document.activeElement && this.layout.element.contains(document.activeElement) && document.activeElement.classList.contains("b3-text-field")) {
            return;
        }
        const dialogElement = document.querySelector(".b3-dialog") as HTMLElement;
        const blockElement = document.querySelector(".block__popover") as HTMLElement;
        const menuElement = document.querySelector("#commonMenu:not(.fn__none)") as HTMLElement;
        if ((dialogElement && dialogElement.style.zIndex > this.layout.element.style.zIndex) ||  // 文档树上修改 emoji 时
            (blockElement && blockElement.style.zIndex > this.layout.element.style.zIndex) ||  // 文档树上弹出悬浮层
            (menuElement && menuElement.style.zIndex > this.layout.element.style.zIndex)  // 面板上弹出菜单时
        ) {
            return;
        }
        if (this.position === "Left") {
            this.layout.element.style.transform = `translateX(-${this.layout.element.clientWidth + 8}px)`;
            this.layout.element.style.left = "";
        } else if (this.position === "Right") {
            this.layout.element.style.transform = `translateX(${this.layout.element.clientWidth + 8}px)`;
            this.layout.element.style.right = "";
        } else if (this.position === "Bottom") {
            this.layout.element.style.transform = `translateY(${this.layout.element.clientHeight + 8}px)`;
            this.layout.element.style.bottom = "";
        }
        if (reset) {
            return;
        }
        this.layout.element.style.opacity = "0";
        this.elements[0].querySelector(".dock__item--activefocus")?.classList.remove("dock__item--activefocus");
        this.elements[1].querySelector(".dock__item--activefocus")?.classList.remove("dock__item--activefocus");
        this.layout.element.querySelector(".layout__tab--active")?.classList.remove("layout__tab--active");
    }

    public toggleModel(type: TDock | string, show = false, close = false, removeDock = false, isSaveLayout = true) {
        if (!type) {
            return;
        }
        if (this.pin) {
            recordBeforeResizeTop();
        }
        const target = document.querySelector(`.dock__item[data-type="${type}"]`) as HTMLElement;
        if (show && target.classList.contains("dock__item--active")) {
            target.classList.remove("dock__item--active", "dock__item--activefocus");
        }
        const index = parseInt(target.getAttribute("data-index"));
        const wnd = this.layout.children[index] as Wnd;
        if (target.classList.contains("dock__item--active") || removeDock) {
            if (!close) {
                let needFocus = false;
                Array.from(wnd.element.querySelector(".layout-tab-container").children).find(item => {
                    if (item.getAttribute("data-id") === target.getAttribute("data-id")) {
                        if (!item.classList.contains("layout__tab--active")) {
                            setPanelFocus(item);
                            needFocus = true;
                        }
                        return true;
                    }
                });
                if (needFocus) {
                    if (document.activeElement) {
                        (document.activeElement as HTMLElement).blur();
                    }
                    clearBeforeResizeTop();
                    this.showDock();
                    return;
                }
            }

            target.classList.remove("dock__item--active", "dock__item--activefocus");
            // dock 隐藏
            if (!this.elements[0].querySelector(".dock__item--active") &&
                !this.elements[1].querySelector(".dock__item--active")) {
                if (this.position === "Left") {
                    this.layout.element.style.width = "0px";
                    this.layout.element.style.marginRight = "0px";
                } else if (this.position === "Right") {
                    this.layout.element.style.width = "0px";
                    this.layout.element.style.marginLeft = "0px";
                } else {
                    this.layout.element.style.height = "0px";
                    this.layout.element.style.marginTop = "0px";
                }
                this.resizeElement.classList.add("fn__none");
                clearTimeout(this.hideResizeTimeout);
                this.hideDock();
            }
            if ((type === "graph" || type === "globalGraph")) {
                if (this.layout.element.querySelector(".fullscreen")) {
                    document.getElementById("drag")?.classList.remove("fn__hidden");
                }
                const graph = this.data[type] as Graph;
                graph.destroy();
            }
            // 关闭 dock 后设置光标，初始化的时候不能设置，否则关闭文档树且多页签时会请求两次 getDoc
            if (isSaveLayout && !document.querySelector(".layout__center .layout__wnd--active")) {
                const currentElement = document.querySelector(".layout__center ul.layout-tab-bar .item--focus");
                if (currentElement) {
                    getAllTabs().find(item => {
                        if (item.id === currentElement.getAttribute("data-id")) {
                            item.parent.switchTab(item.headElement, false, true, false);
                            return true;
                        }
                    });
                }
            }
            if (isSaveLayout) {
                this.saveLocalPlugin(type, {show: false});
            }
        } else {
            this.elements[index].querySelectorAll(".dock__item--active").forEach(item => {
                item.classList.remove("dock__item--active", "dock__item--activefocus");
            });
            target.classList.add("dock__item--active", "dock__item--activefocus");
            if (!target.getAttribute("data-id")) {
                let editor: Protyle;
                const models = getAllModels();
                models.editor.find((item) => {
                    if (item.parent.headElement.classList.contains("item--focus") && item.editor?.protyle?.path) {
                        editor = item.editor;
                        return true;
                    }
                });
                let tab;
                switch (type) {
                    case "file":
                        tab = new Tab({
                            callback: (tab: Tab) => {
                                tab.addModel(new Files({tab, app: this.app}));
                            }
                        });
                        break;
                    case "bookmark":
                        tab = new Tab({
                            callback: (tab: Tab) => {
                                tab.addModel(new Bookmark(this.app, tab));
                            }
                        });
                        break;
                    case "tag":
                        tab = new Tab({
                            callback: (tab: Tab) => {
                                tab.addModel(new Tag(this.app, tab));
                            }
                        });
                        break;
                    case "outline":
                        tab = new Tab({
                            callback: (tab: Tab) => {
                                const outline = new Outline({
                                    app: this.app,
                                    type: "pin",
                                    tab,
                                    blockId: editor?.protyle?.block?.rootID,
                                    isPreview: editor?.protyle?.preview ? !editor.protyle.preview.element.classList.contains("fn__none") : false
                                });
                                if (editor?.protyle?.block?.rootID) {
                                    outline.updateDocTitle(editor?.protyle?.background?.ial);
                                }
                                tab.addModel(outline);
                            }
                        });
                        break;
                    case "graph":
                        tab = new Tab({
                            callback: (tab: Tab) => {
                                tab.addModel(new Graph({
                                    app: this.app,
                                    tab,
                                    blockId: editor?.protyle?.block?.rootID,
                                    type: "pin"
                                }));
                            }
                        });
                        break;
                    case "globalGraph":
                        tab = new Tab({
                            callback: (tab: Tab) => {
                                tab.addModel(new Graph({
                                    app: this.app,
                                    tab,
                                    type: "global"
                                }));
                            }
                        });
                        break;
                    case "backlink":
                        tab = new Tab({
                            callback: (tab: Tab) => {
                                tab.addModel(new Backlink({
                                    app: this.app,
                                    type: "pin",
                                    tab,
                                    blockId: editor?.protyle?.block?.rootID,
                                }));
                            }
                        });
                        break;
                    case "inbox":
                        tab = new Tab({
                            callback: (tab: Tab) => {
                                tab.addModel(new Inbox(this.app, tab));
                            }
                        });
                        break;
                    default:
                        tab = new Tab({
                            callback: (tab: Tab) => {
                                let customModel;
                                this.app.plugins.find((item: Plugin) => {
                                    if (item.docks[type]) {
                                        customModel = item.docks[type].model({tab});
                                        return true;
                                    }
                                });
                                if (customModel) {
                                    tab.addModel(customModel);
                                }
                            }
                        });
                        break;
                }
                wnd.addTab(tab, false, false);
                target.setAttribute("data-id", tab.id);
                this.data[type] = tab.model;
                setPanelFocus(tab.panelElement);
            } else {
                // tab 切换
                Array.from(wnd.element.querySelector(".layout-tab-container").children).forEach(item => {
                    if (item.getAttribute("data-id") === target.getAttribute("data-id")) {
                        item.classList.remove("fn__none");
                        setPanelFocus(item);
                    } else {
                        item.classList.add("fn__none");
                    }
                });
            }
            // dock 显示
            if (this.position === "Left") {
                this.layout.element.style.width = this.getMaxSize() + "px";
                this.layout.element.style.marginRight = "var(--b3-layout-space)";
            } else if (this.position === "Right") {
                this.layout.element.style.width = this.getMaxSize() + "px";
                this.layout.element.style.marginLeft = "var(--b3-layout-space)";
            } else {
                this.layout.element.style.height = this.getMaxSize() + "px";
                this.layout.element.style.marginTop = "var(--b3-layout-space)";
            }
            if ((type === "graph" || type === "globalGraph") && this.layout.element.querySelector(".fullscreen")) {
                document.getElementById("drag")?.classList.add("fn__hidden");
            }
            if (this.pin) {
                this.layout.element.style.opacity = "";
                this.hideResizeTimeout = window.setTimeout(() => {
                    this.resizeElement.classList.remove("fn__none");
                    adjustLayout();
                }, Constants.TIMEOUT_TRANSITION);    // 需等待动画完毕后再出现，否则会出现滚动条 https://ld246.com/article/1676596622064
            }
            if (document.activeElement) {
                (document.activeElement as HTMLElement).blur();
            }
            if (isSaveLayout) {
                this.saveLocalPlugin(type, {show: true});
            }
        }

        // dock 中两个面板的显示关系
        const anotherIndex = index === 0 ? 1 : 0;
        const anotherWnd = this.layout.children[anotherIndex] as Wnd;
        const anotherHasActive = this.elements[anotherIndex].querySelectorAll(".dock__item--active").length > 0;
        const hasActive = this.elements[index].querySelectorAll(".dock__item--active").length > 0;
        if (hasActive && anotherHasActive) {
            let lastWnd = wnd;
            if (anotherIndex === 0) {
                anotherWnd.element.nextElementSibling.classList.remove("fn__none");
            } else {
                lastWnd = anotherWnd;
                anotherWnd.element.previousElementSibling.classList.remove("fn__none");
            }
            const lastActiveElement = this.elements[1].querySelector(".dock__item--active");
            if (this.position === "Left" || this.position === "Right") {
                const dataHeight = parseInt(lastActiveElement.getAttribute("data-height"));
                if (dataHeight !== 0 && !isNaN(dataHeight)) {
                    lastWnd.element.style.height = dataHeight + "px";
                    lastWnd.element.classList.remove("fn__flex-1");
                }
            } else {
                const dataWidth = parseInt(lastActiveElement.getAttribute("data-width"));
                if (dataWidth !== 0 && !isNaN(dataWidth)) {
                    lastWnd.element.style.width = dataWidth + "px";
                    lastWnd.element.classList.remove("fn__flex-1");
                }
            }
        } else {
            if (anotherIndex === 0) {
                anotherWnd.element.nextElementSibling.classList.add("fn__none");
            } else {
                anotherWnd.element.previousElementSibling.classList.add("fn__none");
            }
        }
        if (!anotherHasActive) {
            anotherWnd.element.classList.add("fn__none");
        } else {
            anotherWnd.element.classList.remove("fn__none");
        }
        if (hasActive) {
            wnd.element.classList.remove("fn__none");
        } else {
            wnd.element.classList.add("fn__none");
        }
        if (hasActive && !anotherHasActive) {
            wnd.element.classList.add("fn__flex-1");
            wnd.element.style.height = "";
            wnd.element.style.width = "";
        } else if (!hasActive && anotherHasActive) {
            anotherWnd.element.classList.add("fn__flex-1");
            anotherWnd.element.style.height = "";
            anotherWnd.element.style.width = "";
        }
        resizeTabs(isSaveLayout);
        this.showDock();
        if (target.classList.contains("dock__item--active") && !removeDock && (type === "graph" || type === "globalGraph")) {
            const graph = this.data[type] as Graph;
            graph.onGraph(false);
        }
    }

    public add(index: number, sourceElement: Element, previousType?: string) {
        sourceElement.setAttribute("data-height", "");
        sourceElement.setAttribute("data-width", "");
        const type = sourceElement.getAttribute("data-type") as TDock;
        const sourceDock = getDockByType(type);
        if (sourceDock.elements[0].parentElement.querySelectorAll(".dock__item").length === 1) {
            sourceDock.elements[0].parentElement.classList.add("fn__none");
        }
        const sourceWnd = sourceDock.layout.children[parseInt(sourceElement.getAttribute("data-index"))] as Wnd;
        const sourceId = sourceElement.getAttribute("data-id");
        if (sourceId) {
            sourceWnd.removeTab(sourceElement.getAttribute("data-id"), false, true, false);
            sourceElement.removeAttribute("data-id");
        }
        const hasActive = sourceElement.classList.contains("dock__item--active");
        if (hasActive) {
            sourceDock.toggleModel(type, false, false, false, false);
        }
        delete sourceDock.data[type];
        // 目标处理
        sourceElement.setAttribute("data-index", index.toString());
        if (previousType) {
            this.elements[0].parentElement.querySelector(`[data-type="${previousType}"]`).after(sourceElement);
        } else {
            this.elements[index].insertAdjacentElement("afterbegin", sourceElement);
        }
        this.elements[0].parentElement.classList.remove("fn__none");
        resetFloatDockSize();
        this.data[type] = true;
        if (hasActive) {
            this.toggleModel(type, true, false, false, false);
        }
        // 保存布局需等待动画完毕 https://github.com/siyuan-note/siyuan/issues/13507
        setTimeout(() => {
            saveLayout();
        }, Constants.TIMEOUT_TRANSITION);
        let position: TPluginDockPosition;
        const leftDockElement = hasClosestByAttribute(sourceElement, "id", "dockLeft");
        const rightDockElement = hasClosestByAttribute(sourceElement, "id", "dockRight");
        if (leftDockElement) {
            if (leftDockElement.lastElementChild.contains(sourceElement)) {
                position = "BottomLeft";
            } else {
                position = "Left" + (index === 0 ? "Top" : "Bottom") as TPluginDockPosition;
            }
        } else if (rightDockElement) {
            if (rightDockElement.lastElementChild.contains(sourceElement)) {
                position = "BottomRight";
            } else {
                position = "Right" + (index === 0 ? "Top" : "Bottom") as TPluginDockPosition;
            }
        }
        let sortIndex = 0;
        let previousElement = sourceElement;
        while (previousElement.previousElementSibling) {
            sortIndex++;
            previousElement = previousElement.previousElementSibling;
        }
        this.saveLocalPlugin(type, {
            index: sortIndex,
            position,
            size: {
                height: null,
                width: null,
            }
        });
        adjustDockPadding();
        this.adjustSplit();
        sourceDock.adjustSplit();
    }

    public remove(key: TDock | string) {
        this.toggleModel(key, false, true, true);
        this.elements[0].parentElement.querySelector(`[data-type="${key}"]`).remove();
        const custom = this.data[key] as Custom;
        if (custom.parent) {
            custom.parent.parent.removeTab(custom.parent.id);
        }
        if (this.elements[0].parentElement.querySelectorAll(".dock__item").length === 1) {
            this.elements[0].parentElement.classList.add("fn__none");
            adjustDockPadding();
        }
        delete this.data[key];
        this.adjustSplit();
    }

    public setSize() {
        const activesElement = [...this.elements[0].querySelectorAll(".dock__item--active"),
            ...this.elements[1].querySelectorAll(".dock__item--active")];
        activesElement.forEach((item) => {
            if (this.position === "Left" || this.position === "Right") {
                if (item.getAttribute("data-index") === "1" && activesElement.length > 1) {
                    const dockElement = (this.data[item.getAttribute("data-type") as TDock] as Model).parent.parent.element;
                    item.setAttribute("data-height", dockElement.style.height ? dockElement.clientHeight.toString() : "");
                }
                item.setAttribute("data-width", this.layout.element.clientWidth.toString());
            } else {
                if (item.getAttribute("data-index") === "1" && activesElement.length > 1) {
                    const dockElement = (this.data[item.getAttribute("data-type") as TDock] as Model).parent.parent.element;
                    item.setAttribute("data-width", dockElement.style.width ? dockElement.clientWidth.toString() : "");
                }
                item.setAttribute("data-height", this.layout.element.clientHeight.toString());
            }
            this.saveLocalPlugin(item.getAttribute("data-type"), {
                size: {
                    width: parseInt(item.getAttribute("data-width")) || null,
                    height: parseInt(item.getAttribute("data-height")) || null
                }
            });
        });
    }

    private getMaxSize() {
        let max = 0;
        [...this.elements[0].querySelectorAll(".dock__item--active"), ...this.elements[1].querySelectorAll(".dock__item--active")].forEach((item) => {
            let size;
            if (this.position === "Left" || this.position === "Right") {
                size = parseInt(item.getAttribute("data-width")) || (["graph", "globalGraph", "backlink"].includes(item.getAttribute("data-type")) ? 320 : 232);
            } else {
                size = parseInt(item.getAttribute("data-height")) || 232;
            }
            if (size > max) {
                max = size;
            }
        });
        return max;
    }

    public genButton(data: Config.IUILayoutDockTab[], index: number, tabIndex?: number) {
        let html = "";
        data.forEach(item => {
            if (typeof tabIndex === "undefined" && !TYPES.includes(item.type)) {
                return;
            }
            // https://github.com/siyuan-note/siyuan/issues/7976 历史兼容 3.6.5->3.6.6
            if (item.type === "outline") {
                item.icon = "iconOutline";
            } else if (item.type === "bookmark") {
                item.icon = "iconBookmarks";
            }
            html += `<span data-height="${item.size.height}" data-width="${item.size.width}" data-type="${item.type}" data-index="${index}" data-hotkey="${item.hotkey || ""}" data-hotkeylangid="${item.hotkeyLangId || ""}" data-title="${item.title}" class="dock__item${item.show ? " dock__item--active" : ""} ariaLabel" aria-label="<span style='white-space:pre'>${item.title} ${item.hotkey ? updateHotkeyTip(item.hotkey) : ""}${window.siyuan.languages.dockTip}</span>">
    <svg><use xlink:href="#${item.icon}"></use></svg>
</span>`;
            this.data[item.type] = true;
        });
        if (typeof tabIndex === "number") {
            if (this.elements[index].children[tabIndex]) {
                this.elements[index].children[tabIndex].insertAdjacentHTML("beforebegin", html);
            } else {
                this.elements[index].insertAdjacentHTML("beforeend", html);
            }
        } else {
            this.elements[index].innerHTML = html;
        }
        // https://github.com/siyuan-note/siyuan/issues/8614
        if (!window.siyuan.config.uiLayout.hideDock) {
            this.elements[0].parentElement.classList.remove("fn__none");
        }
        // plugin
        if (typeof tabIndex === "number") {
            if (!window.siyuan.config.uiLayout.hideDock) {
                adjustDockPadding();
            }
            if (data[0].show) {
                this.toggleModel(data[0].type, true, false, false, false);
            }
        }
        this.adjustSplit();
    }

    private adjustSplit() {
        if (this.position !== "Bottom") {
            if (this.elements[0].innerHTML && this.elements[1].innerHTML) {
                this.elements[0].nextElementSibling.classList.remove("fn__none");
            } else {
                this.elements[0].nextElementSibling.classList.add("fn__none");
            }
        }
    }

    private saveLocalPlugin(dockType: TDock | string, options: {
        position?: TPluginDockPosition,
        size?: Config.IUILayoutDockPanelSize,
        index?: number,
        show?: boolean
    }) {
        this.app.plugins.find(pluginItem => {
            if (Object.keys(pluginItem.docks).includes(dockType)) {
                if (!window.siyuan.storage[Constants.LOCAL_PLUGIN_DOCKS][pluginItem.name][dockType]) {
                    window.siyuan.storage[Constants.LOCAL_PLUGIN_DOCKS][pluginItem.name][dockType] = pluginItem.docks[dockType].config;
                }
                Object.keys(options).forEach((item: "position") => {
                    window.siyuan.storage[Constants.LOCAL_PLUGIN_DOCKS][pluginItem.name][dockType][item] = options[item];
                });
                setStorageVal(Constants.LOCAL_PLUGIN_DOCKS, window.siyuan.storage[Constants.LOCAL_PLUGIN_DOCKS]);
                return true;
            }
        });
    }
}

import {updateHotkeyTip} from "../../protyle/util/compatibility";
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
import {setPanelFocus} from "../util";
import {getDockByType, resizeTabs} from "../tabUtil";
import {Inbox} from "./Inbox";
import {Protyle} from "../../protyle";
import {Backlink} from "./Backlink";
import {resetFloatDockSize} from "./util";
import {hasClosestByClassName} from "../../protyle/util/hasClosest";
import {App} from "../../index";
import {Plugin} from "../../plugin";
import {Custom} from "./Custom";

const TYPES = ["file", "outline", "inbox", "bookmark", "tag", "graph", "globalGraph", "backlink"];

export class Dock {
    public element: HTMLElement;
    public layout: Layout;
    private position: TDockPosition;
    private app: App;
    public resizeElement: HTMLElement;
    public pin = true;
    public data: { [key: string]: Model | boolean };

    constructor(options: {
        app: App,
        data: {
            pin: boolean,
            data: IDockTab[][]
        },
        position: TDockPosition
    }) {
        switch (options.position) {
            case "Left":
                this.layout = window.siyuan.layout.layout.children[0].children[0] as Layout;
                this.resizeElement = this.layout.element.nextElementSibling as HTMLElement;
                this.layout.element.classList.add("layout__dockl");
                this.layout.element.insertAdjacentHTML("beforeend", "<div class=\"layout__dockresize layout__dockresize--lr\"></div>");
                break;
            case "Right":
                this.layout = window.siyuan.layout.layout.children[0].children[2] as Layout;
                this.resizeElement = this.layout.element.previousElementSibling as HTMLElement;
                this.layout.element.classList.add("layout__dockr");
                this.layout.element.insertAdjacentHTML("beforeend", "<div class=\"layout__dockresize layout__dockresize--lr\"></div>");
                break;
            case "Bottom":
                this.layout = window.siyuan.layout.layout.children[1] as Layout;
                this.resizeElement = this.layout.element.previousElementSibling as HTMLElement;
                this.layout.element.classList.add("layout__dockb");
                this.layout.element.insertAdjacentHTML("beforeend", "<div class=\"layout__dockresize\"></div>");
                break;
        }
        this.app = options.app;
        this.element = document.getElementById("dock" + options.position);
        const dockClass = options.position === "Bottom" ? ' class="fn__flex"' : "";
        this.element.innerHTML = `<div${dockClass}></div><div class="fn__flex-1"></div><div${dockClass}></div>`;
        this.position = options.position;
        this.pin = options.data.pin;
        this.data = {};
        let showDock = false;
        if (options.data.data.length !== 0) {
            if (!showDock) {
                options.data.data[0].find(item => {
                    if (TYPES.includes(item.type)) {
                        showDock = true;
                        return true;
                    }
                });
            }
            if (!showDock && options.data.data[1]) {
                options.data.data[1].find(item => {
                    if (TYPES.includes(item.type)) {
                        showDock = true;
                        return true;
                    }
                });
            }
        }
        if (!showDock) {
            this.element.firstElementChild.innerHTML = `<span class="dock__item dock__item--pin b3-tooltips b3-tooltips__${this.getClassDirect(0)}" aria-label="${this.pin ? window.siyuan.languages.unpin : window.siyuan.languages.pin}">
    <svg><use xlink:href="#iconPin"></use></svg>
</span>`;
            this.element.classList.add("fn__none");
        } else {
            this.genButton(options.data.data[0], 0);
            if (options.data.data[1]) {
                this.genButton(options.data.data[1], 1);
            }
            this.element.classList.remove("fn__none");
        }
        const activeElements = this.element.querySelectorAll(".dock__item--active");

        // 初始化文件树
        this.element.querySelectorAll(".dock__item").forEach(item => {
            if (item.getAttribute("data-type") === "file" && !item.classList.contains("dock__item--active")) {
                this.toggleModel("file", true);
                this.toggleModel("file");
            }
        });

        if (activeElements.length === 0) {
            this.resizeElement.classList.add("fn__none");
        } else {
            activeElements.forEach(item => {
                this.toggleModel(item.getAttribute("data-type"), true);
            });
        }
        this.element.addEventListener("click", (event) => {
            let target = event.target as HTMLElement;
            while (target && !target.isEqualNode(this.element)) {
                const type = target.getAttribute("data-type");
                if (type) {
                    this.toggleModel(type, false, true);
                    event.preventDefault();
                    break;
                } else if (target.classList.contains("dock__item")) {
                    this.togglePin();
                    target.setAttribute("aria-label", this.pin ? window.siyuan.languages.unpin : window.siyuan.languages.pin);
                    event.preventDefault();
                    break;
                }
                target = target.parentElement;
            }
        });
        this.layout.element.addEventListener("mouseleave", (event: MouseEvent & { toElement: HTMLElement }) => {
            if (event.buttons !== 0 || this.pin || event.toElement?.classList.contains("b3-menu")) {
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
                let minSize = 227;
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
            };
        });

        if (window.siyuan.config.uiLayout.hideDock) {
            this.element.classList.add("fn__none");
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
        const hasActive = this.element.querySelector(".dock__item--active");
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
        if (!reset && (this.pin || !this.element.querySelector(".dock__item--active") || this.layout.element.style.opacity === "1")) {
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
        if (!reset) {
            this.layout.element.style.opacity = "1";
        }
        this.layout.element.style.transform = "";
        this.layout.element.style.zIndex = (++window.siyuan.zIndex).toString();
        if (this.position === "Left") {
            this.layout.element.style.left = `${this.element.clientWidth}px`;
        } else if (this.position === "Right") {
            this.layout.element.style.right = `${this.element.clientWidth}px`;
        } else if (this.position === "Bottom") {
            this.layout.element.style.bottom = `${this.element.offsetHeight + document.getElementById("status").offsetHeight}px`;
        }
    }

    public hideDock(reset = false) {
        if (!reset && (this.layout.element.style.opacity === "0" || this.pin) ||
            this.layout.element.querySelector(".fullscreen")    // 关系图全屏不应该退出
        ) {
            return;
        }
        // https://github.com/siyuan-note/siyuan/issues/7504
        if (document.activeElement && this.layout.element.contains(document.activeElement) && document.activeElement.classList.contains("b3-text-field")) {
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
        this.element.querySelector(".dock__item--activefocus")?.classList.remove("dock__item--activefocus");
        this.layout.element.querySelector(".layout__tab--active")?.classList.remove("layout__tab--active");
    }

    public toggleModel(type: string, show = false, close = false, hide = false) {
        if (!type) {
            return;
        }
        const target = this.element.querySelector(`[data-type="${type}"]`) as HTMLElement;
        if (show && target.classList.contains("dock__item--active")) {
            target.classList.remove("dock__item--active", "dock__item--activefocus");
        }
        const index = parseInt(target.getAttribute("data-index"));
        const wnd = this.layout.children[index] as Wnd;
        if (target.classList.contains("dock__item--active") || hide) {
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
                    this.showDock();
                    return;
                }
            }

            target.classList.remove("dock__item--active", "dock__item--activefocus");
            // dock 隐藏
            if (this.element.querySelectorAll(".dock__item--active").length === 0) {
                if (this.position === "Left" || this.position === "Right") {
                    this.layout.element.style.width = "0px";
                } else {
                    this.layout.element.style.height = "0px";
                }
                if (document.querySelector("body").classList.contains("body--win32")) {
                    document.getElementById("drag").classList.remove("fn__hidden");
                }
                this.resizeElement.classList.add("fn__none");
                this.hideDock();
            }
            // 关闭 dock 后设置光标
            if (!document.querySelector(".layout__center .layout__wnd--active")) {
                const currentElement = document.querySelector(".layout__center .layout-tab-bar .item--focus");
                if (currentElement) {
                    getAllTabs().find(item => {
                        if (item.id === currentElement.getAttribute("data-id")) {
                            item.parent.switchTab(item.headElement);
                            return true;
                        }
                    });
                }
            }
        } else {
            this.element.querySelectorAll(`.dock__item--active[data-index="${index}"]`).forEach(item => {
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
                                    isPreview: !editor?.protyle?.preview?.element.classList.contains("fn__none")
                                });
                                if (editor?.protyle?.title?.editElement) {
                                    outline.updateDocTitle(editor.protyle?.background?.ial);
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
                wnd.addTab(tab);
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
            if (this.position === "Left" || this.position === "Right") {
                this.layout.element.style.width = this.getMaxSize() + "px";
            } else {
                this.layout.element.style.height = this.getMaxSize() + "px";
            }
            if ((type === "graph" || type === "globalGraph") &&
                document.querySelector("body").classList.contains("body--win32") && this.layout.element.querySelector(".fullscreen")) {
                document.getElementById("drag").classList.add("fn__hidden");
            }
            if (this.pin) {
                this.layout.element.style.opacity = "";
                setTimeout(() => {
                    this.resizeElement.classList.remove("fn__none");
                }, 200);    // 需等待动画完毕后再出现，否则会出现滚动条 https://ld246.com/article/1676596622064
            }
            if (document.activeElement) {
                (document.activeElement as HTMLElement).blur();
            }
        }

        // dock 中两个面板的显示关系
        const anotherIndex = index === 0 ? 1 : 0;
        const anotherWnd = this.layout.children[anotherIndex] as Wnd;
        const anotherHasActive = this.element.querySelectorAll(`.dock__item--active[data-index="${anotherIndex}"]`).length > 0;
        const hasActive = this.element.querySelectorAll(`.dock__item--active[data-index="${index}"]`).length > 0;
        if (hasActive && anotherHasActive) {
            let lastWnd = wnd;
            if (anotherIndex === 0) {
                anotherWnd.element.nextElementSibling.classList.remove("fn__none");
            } else {
                lastWnd = anotherWnd;
                anotherWnd.element.previousElementSibling.classList.remove("fn__none");
            }
            const lastActiveElement = this.element.querySelector('.dock__item--active[data-index="1"]');
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
        resizeTabs();
        this.showDock();
    }

    public add(index: number, sourceElement: Element) {
        sourceElement.setAttribute("data-height", "");
        sourceElement.setAttribute("data-width", "");
        const type = sourceElement.getAttribute("data-type");
        const sourceDock = getDockByType(type);
        if (sourceDock.element.querySelectorAll(".dock__item").length === 2) {
            sourceDock.element.classList.add("fn__none");
        }
        const sourceWnd = sourceDock.layout.children[parseInt(sourceElement.getAttribute("data-index"))] as Wnd;
        const sourceId = sourceElement.getAttribute("data-id");
        if (sourceId) {
            sourceWnd.removeTab(sourceElement.getAttribute("data-id"));
            sourceElement.removeAttribute("data-id");
        }
        const hasActive = sourceElement.classList.contains("dock__item--active");
        if (hasActive) {
            sourceDock.toggleModel(type);
        }
        delete sourceDock.data[type];

        // 目标处理
        sourceElement.classList.remove("b3-tooltips__n", "b3-tooltips__ne", "b3-tooltips__nw", "b3-tooltips__s", "b3-tooltips__se", "b3-tooltips__sw", "b3-tooltips__e", "b3-tooltips__w");
        sourceElement.classList.add(`b3-tooltips__${this.getClassDirect(index)}`);
        sourceElement.setAttribute("data-index", index.toString());
        if (index === 0) {
            this.element.firstElementChild.insertAdjacentElement("afterbegin", sourceElement);
        } else {
            this.element.lastElementChild.insertAdjacentElement("afterbegin", sourceElement);
        }
        this.element.classList.remove("fn__none");
        resetFloatDockSize();
        this.data[type] = true;
        if (hasActive) {
            this.toggleModel(type, true);
        }
    }

    public remove(key: string) {
        this.toggleModel(key, false, true, true);
        this.element.querySelector(`[data-type="${key}"]`).remove();
        const custom = this.data[key] as Custom;
        if (custom.parent) {
            custom.parent.parent.removeTab(custom.parent.id);
        }
        delete this.data[key];
    }

    private getClassDirect(index: number) {
        let direct = "e";
        switch (this.position) {
            case "Right":
                direct = "w";
                break;
            case "Bottom":
                if (index === 0) {
                    direct = "ne";
                } else {
                    direct = "nw";
                }
                break;
        }
        return direct;
    }

    public setSize() {
        const activesElement = this.element.querySelectorAll(".dock__item--active");
        activesElement.forEach((item) => {
            if (this.position === "Left" || this.position === "Right") {
                if (item.getAttribute("data-index") === "1" && activesElement.length > 1) {
                    item.setAttribute("data-height", (this.data[item.getAttribute("data-type")] as Model).parent.parent.element.clientHeight.toString());
                }
                item.setAttribute("data-width", this.layout.element.clientWidth.toString());
            } else {
                if (item.getAttribute("data-index") === "1" && activesElement.length > 1) {
                    item.setAttribute("data-width", (this.data[item.getAttribute("data-type")] as Model).parent.parent.element.clientWidth.toString());
                }
                item.setAttribute("data-height", this.layout.element.clientHeight.toString());
            }
        });
    }

    private getMaxSize() {
        let max = 0;
        this.element.querySelectorAll(".dock__item--active").forEach((item) => {
            let size;
            if (this.position === "Left" || this.position === "Right") {
                size = parseInt(item.getAttribute("data-width")) || (["graph", "globalGraph", "backlink"].includes(item.getAttribute("data-type")) ? 320 : 227);
            } else {
                size = parseInt(item.getAttribute("data-height")) || 227;
            }
            if (size > max) {
                max = size;
            }
        });
        return max;
    }

    public genButton(data: IDockTab[], index: number, tabIndex?: number) {
        let html = "";
        data.forEach(item => {
            if (typeof tabIndex === "undefined" && !TYPES.includes(item.type)) {
                return;
            }
            html += `<span data-height="${item.size.height}" data-width="${item.size.width}" data-type="${item.type}" data-index="${index}" data-hotkey="${item.hotkey || ""}" data-hotkeyLangId="${item.hotkeyLangId || ""}" data-title="${item.title}" class="dock__item${item.show ? " dock__item--active" : ""} b3-tooltips b3-tooltips__${this.getClassDirect(index)}" aria-label="${item.title} ${item.hotkey ? updateHotkeyTip(item.hotkey) : ""}${window.siyuan.languages.dockTip}">
    <svg><use xlink:href="#${item.icon}"></use></svg>
</span>`;
            this.data[item.type] = true;
        });
        if (index === 0) {
            if (typeof tabIndex === "number") {
                if (this.element.firstElementChild.children[tabIndex]) {
                    this.element.firstElementChild.children[tabIndex].insertAdjacentHTML("beforebegin", html);
                } else {
                    this.element.firstElementChild.lastElementChild.insertAdjacentHTML("beforebegin", html);
                }
            } else {
                this.element.firstElementChild.innerHTML = `${html}<span class="dock__item dock__item--pin b3-tooltips b3-tooltips__${this.getClassDirect(index)}" aria-label="${this.pin ? window.siyuan.languages.unpin : window.siyuan.languages.pin}">
    <svg><use xlink:href="#iconPin"></use></svg>
</span>`;
            }
        } else {
            if (typeof tabIndex === "number") {
                if (this.element.lastElementChild.children[tabIndex]) {
                    this.element.lastElementChild.children[tabIndex].insertAdjacentHTML("beforebegin", html);
                } else {
                    this.element.lastElementChild.insertAdjacentHTML("beforeend", html);
                }
            } else {
                this.element.lastElementChild.innerHTML = html;
            }
        }

        if (typeof tabIndex === "number") {
            // https://github.com/siyuan-note/siyuan/issues/8614
            if (!window.siyuan.config.uiLayout.hideDock) {
                this.element.classList.remove("fn__none");
            }
            if (data[0].show) {
                this.toggleModel(data[0].type, true);
            }
        }
    }
}

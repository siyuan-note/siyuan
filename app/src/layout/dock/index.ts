import {updateHotkeyTip} from "../../protyle/util/compatibility";
import {Layout} from "../index";
import {Wnd} from "../Wnd";
import {Tab} from "../Tab";
import {Files} from "./Files";
import {Outline} from "./Outline";
import {getAllModels} from "../getAll";
import {Bookmark} from "./Bookmark";
import {Tag} from "./Tag";
import {Graph} from "./Graph";
import {Model} from "../Model";
import {getDockByType, resizeTabs, setPanelFocus} from "../util";
import {Inbox} from "./Inbox";
import {Protyle} from "../../protyle";
import {Backlink} from "./Backlink";
import {resetFloatDockSize} from "./util";

export class Dock {
    public element: HTMLElement;
    public layout: Layout;
    private position: TDockPosition;
    public resizeElement: HTMLElement;
    public pin = true;
    public data: { [key: string]: Model | boolean };

    constructor(options: { data: { pin: boolean, data: IDockTab[][] }, position: TDockPosition }) {
        switch (options.position) {
            case "Left":
                this.layout = window.siyuan.layout.layout.children[1].children[0] as Layout;
                this.resizeElement = this.layout.element.nextElementSibling as HTMLElement;
                this.layout.element.classList.add("layout--floatl");
                break;
            case "Right":
                this.layout = window.siyuan.layout.layout.children[1].children[2] as Layout;
                this.resizeElement = this.layout.element.previousElementSibling as HTMLElement;
                this.layout.element.classList.add("layout--floatr");
                break;
            case "Top":
                this.layout = window.siyuan.layout.layout.children[0] as Layout;
                this.resizeElement = this.layout.element.nextElementSibling as HTMLElement;
                this.layout.element.classList.add("layout--floatt");
                break;
            case "Bottom":
                this.layout = window.siyuan.layout.layout.children[2] as Layout;
                this.resizeElement = this.layout.element.previousElementSibling as HTMLElement;
                this.layout.element.classList.add("layout--floatb");
                break;
        }
        this.element = document.getElementById("dock" + options.position);
        const dockClass = (options.position === "Bottom" || options.position === "Top") ? ' class="fn__flex"' : "";
        this.element.innerHTML = `<div${dockClass}></div><div class="fn__flex-1"></div><div${dockClass}></div>`;
        this.position = options.position;
        this.pin = options.data.pin;
        this.data = {};
        if (options.data.data.length === 0) {
            this.element.classList.add("fn__none");
        } else {
            this.genButton(options.data.data[0], 0);
            if (options.data.data[1]) {
                this.genButton(options.data.data[1], 1);
            }
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
                this.toggleModel(item.getAttribute("data-type") as TDockType, true);
            });
        }
        this.element.addEventListener("click", (event) => {
            let target = event.target as HTMLElement;
            while (target && !target.isEqualNode(this.element)) {
                const type = target.getAttribute("data-type") as TDockType;
                if (type) {
                    this.toggleModel(type, false, true);
                    event.preventDefault();
                    break;
                }
                target = target.parentElement;
            }
        });
        this.layout.element.addEventListener("mouseleave", (event: MouseEvent & { toElement: HTMLElement }) => {
            if (this.pin || event.toElement?.classList.contains("b3-menu")) {
                return;
            }
            if (this.position === "Left" && event.clientX < 43) {
                return;
            }
            if (this.position === "Right" && event.clientX > window.innerWidth - 41) {
                return;
            }
            if (this.position === "Top" && event.clientY < 75) {
                return;
            }
            if (this.position === "Bottom" && event.clientY > window.innerHeight - 73) {
                return;
            }
            this.hideDock();
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

    public resetDockPosition(show: boolean) {
        if (this.position === "Left") {
            this.layout.element.setAttribute("style", `width:${this.layout.element.clientWidth}px;
opacity:${show ? 1 : 0};
top: 112px;bottom: 82px;left:0`);
        } else if (this.position === "Right") {
            this.layout.element.setAttribute("style", `width:${this.layout.element.clientWidth}px;
opacity:${show ? 1 : 0};
right:0;top: 112px;bottom: 82px;`);
        } else {
            this.layout.element.setAttribute("style", `height:${this.layout.element.clientHeight}px;
opacity:${show ? 1 : 0};
left:0;right:0;
${this.position === "Top" ? "top" : "bottom"}:0`);
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
        if (!reset && (this.position === "Top" || this.position === "Bottom") &&
            this.layout.element.clientHeight === 0 && this.layout.element.style.height.startsWith("0")) {
            return;
        }
        if (!reset) {
            this.layout.element.style.opacity = "1";
        }
        if (this.position === "Left") {
            this.layout.element.style.transform = `translateX(${this.element.clientWidth}px)`;
        } else if (this.position === "Right") {
            this.layout.element.style.transform = `translateX(-${this.element.clientWidth}px)`;
        } else if (this.position === "Top") {
            this.layout.element.style.transform = `translateY(${this.element.offsetHeight + document.getElementById("toolbar").offsetHeight}px)`;
        } else if (this.position === "Bottom") {
            this.layout.element.style.transform = `translateY(-${this.element.offsetHeight + document.getElementById("status").offsetHeight}px)`;
        }
    }

    public hideDock(reset = false) {
        if (!reset && (this.layout.element.style.opacity === "0" || this.pin) ||
            this.layout.element.querySelector(".fullscreen")    // 关系图全屏不应该退出
        ) {
            return;
        }
        if (this.position === "Left") {
            this.layout.element.style.transform = `translateX(-${this.layout.element.clientWidth + 8}px)`;
        } else if (this.position === "Right") {
            this.layout.element.style.transform = `translateX(${this.layout.element.clientWidth + 8}px)`;
        } else if (this.position === "Top") {
            this.layout.element.style.transform = `translateY(-${this.layout.element.clientHeight + 8}px)`;
        } else if (this.position === "Bottom") {
            this.layout.element.style.transform = `translateY(${this.layout.element.clientHeight + 8}px)`;
        }
        if (reset) {
            return;
        }
        this.layout.element.style.opacity = "0";
        this.element.querySelector(".dock__item--activefocus")?.classList.remove("dock__item--activefocus");
        this.layout.element.querySelector(".layout__tab--active")?.classList.remove("layout__tab--active");
    }

    public toggleModel(type: TDockType, show = false, close = false) {
        if (!type) {
            return;
        }
        const target = this.element.querySelector(`[data-type="${type}"]`) as HTMLElement;
        if (show && target.classList.contains("dock__item--active")) {
            target.classList.remove("dock__item--active", "dock__item--activefocus");
        }
        const index = parseInt(target.getAttribute("data-index"));
        const wnd = this.layout.children[index] as Wnd;
        if (target.classList.contains("dock__item--active")) {
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
                            callback(tab: Tab) {
                                tab.addModel(new Files({tab}));
                            }
                        });
                        break;
                    case "bookmark":
                        tab = new Tab({
                            callback(tab: Tab) {
                                tab.addModel(new Bookmark(tab));
                            }
                        });
                        break;
                    case "tag":
                        tab = new Tab({
                            callback(tab: Tab) {
                                tab.addModel(new Tag(tab));
                            }
                        });
                        break;
                    case "outline":
                        tab = new Tab({
                            callback(tab: Tab) {
                                const outline = new Outline({
                                    type: "pin",
                                    tab,
                                    blockId: editor?.protyle?.block?.rootID,
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
                            callback(tab: Tab) {
                                tab.addModel(new Graph({
                                    tab,
                                    blockId: editor?.protyle?.block?.rootID,
                                    type: "pin"
                                }));
                            }
                        });
                        break;
                    case "globalGraph":
                        tab = new Tab({
                            callback(tab: Tab) {
                                tab.addModel(new Graph({
                                    tab,
                                    type: "global"
                                }));
                            }
                        });
                        break;
                    case "backlink":
                        tab = new Tab({
                            callback(tab: Tab) {
                                tab.addModel(new Backlink({
                                    type: "pin",
                                    tab,
                                    blockId: editor?.protyle?.block?.rootID,
                                }));
                            }
                        });
                        break;
                    case "inbox":
                        tab = new Tab({
                            callback(tab: Tab) {
                                tab.addModel(new Inbox(tab));
                            }
                        });
                        break;
                }
                wnd.addTab(tab);
                target.setAttribute("data-id", tab.id);
                this.data[type] = tab.model;
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
        }

        // dock 中两个面板的显示关系
        const anotherIndex = index === 0 ? 1 : 0;
        const anotherWnd = this.layout.children[anotherIndex] as Wnd;
        const anotherHasActive = this.element.querySelectorAll(`.dock__item--active[data-index="${anotherIndex}"]`).length > 0;
        const hasActive = this.element.querySelectorAll(`.dock__item--active[data-index="${index}"]`).length > 0;
        if (hasActive && anotherHasActive) {
            let firstWnd = wnd;
            if (anotherIndex === 0) {
                firstWnd = anotherWnd;
                anotherWnd.element.nextElementSibling.classList.remove("fn__none");
            } else {
                anotherWnd.element.previousElementSibling.classList.remove("fn__none");
            }
            const firstActiveElement = this.element.querySelector('.dock__item--active[data-index="0"]');
            if (this.position === "Left" || this.position === "Right") {
                const dataHeight = parseInt(firstActiveElement.getAttribute("data-height"));
                if (dataHeight !== 0 && !isNaN(dataHeight)) {
                    firstWnd.element.style.height = dataHeight + "px";
                    firstWnd.element.classList.remove("fn__flex-1");
                }
            } else {
                const dataWidth = parseInt(firstActiveElement.getAttribute("data-width"));
                if (dataWidth !== 0 && !isNaN(dataWidth)) {
                    firstWnd.element.style.width = dataWidth + "px";
                    firstWnd.element.classList.remove("fn__flex-1");
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
        const type = sourceElement.getAttribute("data-type") as TDockType;
        const sourceDock = getDockByType(type);
        if (sourceDock.element.querySelectorAll(".dock__item").length === 1) {
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
            this.element.firstElementChild.insertAdjacentElement("beforeend", sourceElement);
        } else {
            this.element.lastElementChild.insertAdjacentElement("beforeend", sourceElement);
        }
        this.element.classList.remove("fn__none");
        resetFloatDockSize();
        this.data[type] = true;
        if (hasActive) {
            this.toggleModel(type, true);
        }
    }

    private getClassDirect(index: number) {
        let direct = "e";
        switch (this.position) {
            case "Right":
                direct = "w";
                break;
            case "Top":
                if (index === 0) {
                    direct = "se";
                } else {
                    direct = "sw";
                }
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
                if (item.getAttribute("data-index") === "0" && activesElement.length > 1) {
                    item.setAttribute("data-height", (this.data[item.getAttribute("data-type")] as Model).parent.parent.element.clientHeight.toString());
                }
                item.setAttribute("data-width", this.layout.element.clientWidth.toString());
            } else {
                if (item.getAttribute("data-index") === "0" && activesElement.length > 1) {
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
                size = parseInt(item.getAttribute("data-width")) || (["graph", "globalGraph", "backlink"].includes(item.getAttribute("data-type")) ? 320 : 220);
            } else {
                size = parseInt(item.getAttribute("data-height")) || 220;
            }
            if (size > max) {
                max = size;
            }
        });
        return max;
    }

    private genButton(data: IDockTab[], index: number) {
        let html = "";
        data.forEach(item => {
            html += `<span data-height="${item.size.height}" data-width="${item.size.width}" data-type="${item.type}" data-index="${index}" data-hotkeylangid="${item.hotkeyLangId}" class="dock__item${item.show ? " dock__item--active" : ""} b3-tooltips b3-tooltips__${this.getClassDirect(index)}" aria-label="${window.siyuan.languages[item.hotkeyLangId] + " " + updateHotkeyTip(window.siyuan.config.keymap.general[item.hotkeyLangId].custom)}${window.siyuan.languages.dockTip}">
    <svg><use xlink:href="#${item.icon}"></use></svg>
</span>`;
            this.data[item.type] = true;
        });
        if (index === 0) {
            this.element.firstElementChild.innerHTML = html;
        } else {
            this.element.lastElementChild.innerHTML = html;
        }
    }
}

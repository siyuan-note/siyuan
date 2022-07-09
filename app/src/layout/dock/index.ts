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
import {Backlinks} from "./Backlinks";
import {Model} from "../Model";
import {getDockByType, resizeTabs, setPanelFocus} from "../util";
import {Inbox} from "./Inbox";
import Protyle from "../../protyle";

export class Dock {
    public element: HTMLElement;
    public layout: Layout;
    private position: TDockPosition;
    public resizeElement: HTMLElement;
    public data: { [key: string]: Model | boolean };

    constructor(options: { data: IDockTab[][], position: TDockPosition }) {
        switch (options.position) {
            case "Left":
                this.layout = window.siyuan.layout.layout.children[1].children[0] as Layout;
                this.resizeElement = this.layout.element.nextElementSibling as HTMLElement;
                break;
            case "Right":
                this.layout = window.siyuan.layout.layout.children[1].children[2] as Layout;
                this.resizeElement = this.layout.element.previousElementSibling as HTMLElement;
                break;
            case "Top":
                this.layout = window.siyuan.layout.layout.children[0] as Layout;
                this.resizeElement = this.layout.element.nextElementSibling as HTMLElement;
                break;
            case "Bottom":
                this.layout = window.siyuan.layout.layout.children[2] as Layout;
                this.resizeElement = this.layout.element.previousElementSibling as HTMLElement;
                break;
        }
        this.element = document.getElementById("dock" + options.position);
        this.element.innerHTML = '<div></div><div class="fn__flex-1"></div><div></div>';
        this.position = options.position;
        this.data = {};
        if (options.data.length === 0) {
            this.element.classList.add("fn__none");
        } else {
            this.genButton(options.data[0], 0);
            if (options.data[1]) {
                this.genButton(options.data[1], 1);
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
        if (window.siyuan.config.uiLayout.hideDock) {
            this.element.classList.add("fn__none");
        }
    }

    public toggleModel(type: TDockType, show = false, close = false) {
        const target = this.element.querySelector(`[data-type="${type}"]`) as HTMLElement;
        if (show && target.classList.contains("dock__item--active")) {
            target.classList.remove("dock__item--active");
        }
        const index = parseInt(target.getAttribute("data-index"));
        const wnd = this.layout.children[index] as Wnd;
        if (target.classList.contains("dock__item--active")) {
            if (!close) {
                let needFocus = false;
                Array.from(wnd.element.querySelector(".layout-tab-container").children).find(item => {
                    if (item.getAttribute("data-id") === target.getAttribute("data-id")) {
                        if (!item.firstElementChild.classList.contains("block__icons--active")) {
                            setPanelFocus(item.firstElementChild);
                            needFocus = true;
                        }
                        return true;
                    }
                });
                if (needFocus) {
                    return;
                }
            }

            target.classList.remove("dock__item--active");
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
            }
        } else {
            this.element.querySelectorAll(`.dock__item--active[data-index="${index}"]`).forEach(item => {
                item.classList.remove("dock__item--active");
            });
            target.classList.add("dock__item--active");
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
                                tab.addModel(new Backlinks({
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
                        setPanelFocus(item.firstElementChild);
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
            this.resizeElement.classList.remove("fn__none");
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
            this.element.firstElementChild.insertAdjacentElement("afterbegin", sourceElement);
        } else {
            this.element.lastElementChild.insertAdjacentElement("afterbegin", sourceElement);
        }
        this.element.classList.remove("fn__none");
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
                    direct = "e";
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
                size = parseInt(item.getAttribute("data-width")) || 240; // 240 兼容历史数据
            } else {
                size = parseInt(item.getAttribute("data-height")) || 240;
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

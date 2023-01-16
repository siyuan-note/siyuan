import {Layout} from "./index";
import {Wnd} from "./Wnd";
import {mountHelp, newNotebook} from "../util/mount";
import {Tab} from "./Tab";
import {Model} from "./Model";
import {Graph} from "./dock/Graph";
import {Editor} from "../editor";
import {Files} from "./dock/Files";
import {setPadding} from "../protyle/ui/initUI";
import {newFile} from "../util/newFile";
import {Outline} from "./dock/Outline";
import {Bookmark} from "./dock/Bookmark";
import {updateHotkeyTip} from "../protyle/util/compatibility";
import {Tag} from "./dock/Tag";
import {getAllModels, getAllTabs} from "./getAll";
import {Asset} from "../asset";
import {Search} from "../search";
import {Dock} from "./dock";
import {focusByRange} from "../protyle/util/selection";
import {hideElements} from "../protyle/ui/hideElements";
import {fetchPost} from "../util/fetch";
import {hasClosestBlock} from "../protyle/util/hasClosest";
import {getContenteditableElement} from "../protyle/wysiwyg/getBlock";
import {Constants} from "../constants";
import {openSearch} from "../search/spread";
import {saveScroll} from "../protyle/scroll/saveScroll";
import {pdfResize} from "../asset/renderAssets";
import {Backlink} from "./dock/Backlink";
import {openFileById} from "../editor/util";
import {getSearch} from "../util/functions";

export const setPanelFocus = (element: Element) => {
    if (element.classList.contains("layout__tab--active") || element.classList.contains("layout__wnd--active")) {
        return;
    }
    document.querySelectorAll(".layout__tab--active").forEach(item => {
        item.classList.remove("layout__tab--active");
    });
    document.querySelectorAll(".dock__item--activefocus").forEach(item => {
        item.classList.remove("dock__item--activefocus");
    });
    document.querySelectorAll(".layout__wnd--active").forEach(item => {
        item.classList.remove("layout__wnd--active");
    });
    if (element.getAttribute("data-type") === "wnd") {
        element.classList.add("layout__wnd--active");
    } else {
        element.classList.add("layout__tab--active");
        ["file", "inbox", "backlink", "tag", "bookmark", "graph", "globalGraph", "outline"].find(item => {
            if (element.classList.contains("sy__" + item)) {
                document.querySelector(`.dock__item[data-type="${item}"]`).classList.add("dock__item--activefocus");
                return true;
            }
        });
        const blockElement = hasClosestBlock(document.activeElement);
        if (blockElement) {
            const editElement = getContenteditableElement(blockElement) as HTMLElement;
            if (editElement) {
                editElement.blur();
            }
        }
    }
};

export const getDockByType = (type: TDockType) => {
    if (!window.siyuan.layout.leftDock) {
        return undefined;
    }
    if (window.siyuan.layout.leftDock.data[type]) {
        return window.siyuan.layout.leftDock;
    }
    if (window.siyuan.layout.rightDock.data[type]) {
        return window.siyuan.layout.rightDock;
    }
    if (window.siyuan.layout.bottomDock.data[type]) {
        return window.siyuan.layout.bottomDock;
    }
    if (window.siyuan.layout.topDock.data[type]) {
        return window.siyuan.layout.topDock;
    }
};

export const switchWnd = (newWnd: Wnd, targetWnd: Wnd) => {
    newWnd.element.after(targetWnd.element);
    // 分割线
    newWnd.element.after(newWnd.element.previousElementSibling);
    newWnd.parent.children.find((item, index) => {
        if (item.id === newWnd.id) {
            const tempResize = newWnd.parent.children[index].resize;
            newWnd.parent.children[index].resize = newWnd.parent.children[index - 1].resize;
            newWnd.parent.children[index - 1].resize = tempResize;
            const temp = item;
            newWnd.parent.children[index] = newWnd.parent.children[index - 1];
            newWnd.parent.children[index - 1] = temp;
            return true;
        }
    });
};

export const getWndByLayout: (layout: Layout) => Wnd = (layout: Layout) => {
    for (let i = 0; i < layout.children.length; i++) {
        const item = layout.children[i];
        if (item instanceof Wnd) {
            return item;
        } else {
            return getWndByLayout(item);
        }
    }
};

const dockToJSON = (dock: Dock) => {
    const json = [];
    const subDockToJSON = (index: number) => {
        const data: IDockTab[] = [];
        dock.element.querySelectorAll(`span[data-index="${index}"]`).forEach(item => {
            data.push({
                type: item.getAttribute("data-type") as TDockType,
                size: {
                    height: parseInt(item.getAttribute("data-height")),
                    width: parseInt(item.getAttribute("data-width")),
                },
                show: item.classList.contains("dock__item--active"),
                icon: item.querySelector("use").getAttribute("xlink:href").substring(1),
                hotkeyLangId: item.getAttribute("data-hotkeylangid")
            });
        });
        return data;
    };
    const data0 = subDockToJSON(0);
    const data2 = subDockToJSON(1);
    if (data0.length > 0 || data2.length > 0) {
        // https://github.com/siyuan-note/siyuan/issues/5641
        json.push(data0);
    }
    if (data2.length > 0) {
        json.push(data2);
    }
    return json;
};

export const resetLayout = () => {
    fetchPost("/api/system/setUILayout", {layout: {}}, () => {
        window.location.reload();
    });
};

export const exportLayout = (reload: boolean, cb?: () => void) => {
    const useElement = document.querySelector("#barDock use");
    if (!useElement) {
        return;
    }
    const layoutJSON: any = {
        hideDock: useElement.getAttribute("xlink:href") === "#iconDock",
        layout: {},
        top: dockToJSON(window.siyuan.layout.topDock),
        bottom: dockToJSON(window.siyuan.layout.bottomDock),
        left: dockToJSON(window.siyuan.layout.leftDock),
        right: dockToJSON(window.siyuan.layout.rightDock),
    };
    layoutToJSON(window.siyuan.layout.layout, layoutJSON.layout);
    fetchPost("/api/system/setUILayout", {layout: layoutJSON, exit: typeof cb !== "undefined"}, () => {
        if (reload) {
            window.location.reload();
        } else if (cb) {
            cb();
        }
    });
};

const JSONToDock = (json: any) => {
    window.siyuan.layout.centerLayout = window.siyuan.layout.layout.children[1].children[1] as Layout;
    window.siyuan.layout.topDock = new Dock({position: "Top", data: json.top});
    window.siyuan.layout.leftDock = new Dock({position: "Left", data: json.left});
    window.siyuan.layout.rightDock = new Dock({position: "Right", data: json.right});
    window.siyuan.layout.bottomDock = new Dock({position: "Bottom", data: json.bottom});
};

const JSONToCenter = (json: any, layout?: Layout | Wnd | Tab | Model) => {
    let child: Layout | Wnd | Tab | Model;
    if (json.instance === "Layout") {
        if (!layout) {
            window.siyuan.layout.layout = new Layout({element: document.getElementById("layouts")});
        } else {
            child = new Layout({
                direction: json.direction,
                size: json.size,
                type: json.type,
                resize: json.resize
            });
            (layout as Layout).addLayout(child);
        }
    } else if (json.instance === "Wnd") {
        child = new Wnd(json.resize, (layout as Layout).type);
        (layout as Layout).addWnd(child);
        if (json.width) {
            child.element.classList.remove("fn__flex-1");
            child.element.style.width = json.width;
        }
        if (json.height) {
            child.element.classList.remove("fn__flex-1");
            child.element.style.height = json.height;
        }
    } else if (json.instance === "Tab") {
        if (!json.title) {
            child = newCenterEmptyTab();
        } else {
            let title = json.title;
            if (json.lang) {
                title = window.siyuan.languages[json.lang];
            }
            child = new Tab({
                icon: json.icon,
                docIcon: json.docIcon,
                title
            });
        }
        if (json.pin) {
            child.headElement.classList.add("item--pin");
            if (json.docIcon || json.icon) {
                child.headElement.querySelector(".item__text").classList.add("fn__none");
            }
        }
        if (json.active) {
            child.headElement.setAttribute("data-init-active", "true");
        }
        (layout as Wnd).addTab(child);
        (layout as Wnd).showHeading();
    } else if (json.instance === "Editor" && json.blockId) {
        if (window.siyuan.config.fileTree.openFilesUseCurrentTab) {
            (layout as Tab).headElement.classList.add("item--unupdate");
        }
        (layout as Tab).headElement.setAttribute("data-initdata", JSON.stringify(json));
    } else if (json.instance === "Asset") {
        (layout as Tab).addModel(new Asset({
            tab: (layout as Tab),
            path: json.path,
        }));
    } else if (json.instance === "Backlink") {
        (layout as Tab).addModel(new Backlink({
            tab: (layout as Tab),
            blockId: json.blockId,
            rootId: json.rootId,
            type: json.type,
        }));
    } else if (json.instance === "Bookmark") {
        (layout as Tab).addModel(new Bookmark((layout as Tab)));
    } else if (json.instance === "Files") {
        (layout as Tab).addModel(new Files({
            tab: (layout as Tab),
        }));
    } else if (json.instance === "Graph") {
        (layout as Tab).addModel(new Graph({
            tab: (layout as Tab),
            blockId: json.blockId,
            rootId: json.rootId,
            type: json.type
        }));
    } else if (json.instance === "Outline") {
        (layout as Tab).addModel(new Outline({
            tab: (layout as Tab),
            blockId: json.blockId,
            type: json.type
        }));
    } else if (json.instance === "Tag") {
        (layout as Tab).addModel(new Tag((layout as Tab)));
    } else if (json.instance === "Search") {
        (layout as Tab).addModel(new Search({
            tab: (layout as Tab),
            config: json.config
        }));
    }
    if (json.children) {
        if (Array.isArray(json.children)) {
            json.children.forEach((item: any, index: number) => {
                JSONToCenter(item, layout ? child : window.siyuan.layout.layout);
                if (item.instance === "Tab" && index === json.children.length - 1) {
                    const activeTabElement = (child as Wnd).headersElement.querySelector('[data-init-active="true"]') as HTMLElement;
                    if (activeTabElement) {
                        activeTabElement.removeAttribute("data-init-active");
                        (child as Wnd).switchTab(activeTabElement, false, false);
                    }
                }
            });
        } else {
            JSONToCenter(json.children, child);
        }
    }
};

export const JSONToLayout = (isStart: boolean) => {
    JSONToCenter(window.siyuan.config.uiLayout.layout);
    JSONToDock(window.siyuan.config.uiLayout);
    // 启动时不打开页签，需要移除没有钉住的页签
    if (window.siyuan.config.fileTree.closeTabsOnStart && isStart) {
        getAllTabs().forEach(item => {
            if (item.headElement && !item.headElement.classList.contains("item--pin")) {
                item.parent.removeTab(item.id);
            }
        });
    }
    // https://github.com/siyuan-note/siyuan/pull/7086
    const openId = getSearch("id", window.location.href);
    if (openId !== null) {
        openFileById({
            id: openId,
            action: [Constants.CB_GET_FOCUS, Constants.CB_GET_CONTEXT],
            zoomIn: getSearch("focus", window.location.href) === "1"
        });
    }
};

export const layoutToJSON = (layout: Layout | Wnd | Tab | Model, json: any) => {
    if (layout instanceof Layout) {
        json.direction = layout.direction;
        if (layout.parent) {
            if (layout.element.classList.contains("fn__flex-1")) {
                json.size = "auto";
            } else {
                json.size = (layout.parent.direction === "tb" ? layout.element.clientHeight : layout.element.clientWidth) + "px";
            }
        }
        json.resize = layout.resize;
        json.type = layout.type;
        json.instance = "Layout";
    } else if (layout instanceof Wnd) {
        json.resize = layout.resize;
        json.height = layout.element.style.height;
        json.width = layout.element.style.width;
        json.instance = "Wnd";
    } else if (layout instanceof Tab) {
        if (layout.headElement) {
            json.title = layout.title;
            json.icon = layout.icon;
            json.docIcon = layout.docIcon;
            json.pin = layout.headElement.classList.contains("item--pin");
            if (layout.model instanceof Files) {
                json.lang = "fileTree";
            } else if (layout.model instanceof Backlink && layout.model.type === "pin") {
                json.lang = "backlinks";
            } else if (layout.model instanceof Bookmark) {
                json.lang = "bookmark";
            } else if (layout.model instanceof Graph && layout.model.type !== "local") {
                json.lang = "graphView";
            } else if (layout.model instanceof Outline && layout.model.type !== "local") {
                json.lang = "outline";
            } else if (layout.model instanceof Tag) {
                json.lang = "tag";
            }
            if (layout.headElement.classList.contains("item--focus")) {
                json.active = true;
            }
        }
        json.instance = "Tab";
    } else if (layout instanceof Editor) {
        json.notebookId = layout.editor.protyle.notebookId;
        json.blockId = layout.editor.protyle.block.id;
        json.rootId = layout.editor.protyle.block.rootID;
        json.mode = layout.editor.protyle.preview.element.classList.contains("fn__none") ? "wysiwyg" : "preview";
        json.action = layout.editor.protyle.block.showAll ? Constants.CB_GET_ALL : "";
        json.instance = "Editor";
        json.scrollAttr = saveScroll(layout.editor.protyle, true);
    } else if (layout instanceof Asset) {
        json.path = layout.path;
        json.instance = "Asset";
    } else if (layout instanceof Backlink) {
        json.blockId = layout.blockId;
        json.rootId = layout.rootId;
        json.type = layout.type;
        json.instance = "Backlink";
    } else if (layout instanceof Bookmark) {
        json.instance = "Bookmark";
    } else if (layout instanceof Files) {
        json.instance = "Files";
    } else if (layout instanceof Graph) {
        json.blockId = layout.blockId;
        json.rootId = layout.rootId;
        json.type = layout.type;
        json.instance = "Graph";
    } else if (layout instanceof Outline) {
        json.blockId = layout.blockId;
        json.type = layout.type;
        json.instance = "Outline";
    } else if (layout instanceof Tag) {
        json.instance = "Tag";
    } else if (layout instanceof Search) {
        json.instance = "Search";
        json.config = layout.config;
    }

    if (layout instanceof Layout || layout instanceof Wnd) {
        if (layout instanceof Layout &&
            (layout.type === "top" || layout.type === "bottom" || layout.type === "left" || layout.type === "right")) {
            // 四周布局使用默认值，清空内容，重置时使用 dock 数据
            if (layout.type === "top" || layout.type === "bottom") {
                json.children = [{
                    "instance": "Wnd",
                    "children": []
                }, {
                    "instance": "Wnd",
                    "resize": "lr",
                    "children": []
                }];
            } else {
                json.children = [{
                    "instance": "Wnd",
                    "children": []
                }, {
                    "instance": "Wnd",
                    "resize": "tb",
                    "children": []
                }];
            }
        } else {
            json.children = [];
            layout.children.forEach((item: Layout | Wnd | Tab) => {
                const itemJSON = {};
                json.children.push(itemJSON);
                layoutToJSON(item, itemJSON);
            });
        }
    } else if (layout instanceof Tab) {
        if (layout.model) {
            json.children = {};
            layoutToJSON(layout.model, json.children);
        } else if (layout.headElement) {
            // 当前页签没有激活时编辑器没有初始化
            json.children = JSON.parse(layout.headElement.getAttribute("data-initdata") || "{}");
        } else {
            // 关闭所有页签
            json.children = {};
        }
    }
};

export const resizeDrag = () => {
    const dragElement = document.getElementById("drag");
    const width = dragElement.clientWidth;
    const dragRect = dragElement.getBoundingClientRect();
    const left = dragRect.left;
    const right = window.innerWidth - dragRect.right;
    if (left > right && left - right < width) {
        dragElement.style.paddingRight = (left - right) + "px";
    } else if (left < right && right - left < width) {
        dragElement.style.paddingLeft = (right - left) + "px";
    } else {
        dragElement.style.padding = "";
    }
};

let resizeTimeout: number;
export const resizeTabs = () => {
    clearTimeout(resizeTimeout);
    //  .layout .fn__flex-shrink {width .15s cubic-bezier(0, 0, .2, 1) 0ms} 时需要再次计算 padding
    // PDF 避免分屏多次调用后，页码跳转到1 https://github.com/siyuan-note/siyuan/issues/5646
    resizeTimeout = window.setTimeout(() => {
        const models = getAllModels();
        models.editor.forEach((item) => {
            if (item.editor && item.editor.protyle && item.element.parentElement) {
                hideElements(["gutter"], item.editor.protyle);
                setPadding(item.editor.protyle);
                if (typeof echarts !== "undefined") {
                    item.editor.protyle.wysiwyg.element.querySelectorAll('[data-subtype="echarts"], [data-subtype="mindmap"]').forEach((chartItem: HTMLElement) => {
                        const chartInstance = echarts.getInstanceById(chartItem.firstElementChild.nextElementSibling.getAttribute("_echarts_instance_"));
                        if (chartInstance) {
                            chartInstance.resize();
                        }
                    });
                }
                // 保持光标位置不变 https://ld246.com/article/1673704873983/comment/1673765814595#comments
                if (!item.element.classList.contains("fn__none") && item.editor.protyle.toolbar.range) {
                    const protyleRect = item.editor.protyle.element.getBoundingClientRect();
                    const rangeRect = item.editor.protyle.toolbar.range.getBoundingClientRect();
                    if (protyleRect.top + 30 > rangeRect.top || protyleRect.bottom < rangeRect.bottom) {
                        item.editor.protyle.toolbar.range.startContainer.parentElement.scrollIntoView(protyleRect.top > rangeRect.top);
                    }
                }
            }
        });
        // https://github.com/siyuan-note/siyuan/issues/6250
        models.backlink.forEach(item => {
            const mTreeElement = item.element.querySelector(".backlinkMList") as HTMLElement;
            if (mTreeElement.style.height && mTreeElement.style.height !== "0px" && item.element.clientHeight !== 0) {
                mTreeElement.style.height = (item.element.clientHeight - mTreeElement.previousElementSibling.clientHeight * 2) + "px";
            }
            item.editors.forEach(editorItem => {
                hideElements(["gutter"], editorItem.protyle);
            });
        });
        pdfResize();
    }, 200);
};

export const copyTab = (tab: Tab) => {
    return new Tab({
        icon: tab.icon,
        docIcon: tab.docIcon,
        title: tab.title,
        callback(newTab: Tab) {
            let model: Model;
            if (tab.model instanceof Editor) {
                model = new Editor({
                    tab: newTab,
                    blockId: tab.model.editor.protyle.block.rootID,
                    scrollAttr: saveScroll(tab.model.editor.protyle, true)
                });
            } else if (tab.model instanceof Asset) {
                model = new Asset({
                    tab: newTab,
                    path: tab.model.path
                });
            } else if (tab.model instanceof Graph) {
                model = new Graph({
                    tab: newTab,
                    blockId: tab.model.blockId,
                    rootId: tab.model.rootId,
                    type: tab.model.type,
                });
            } else if (tab.model instanceof Files) {
                model = new Files({
                    tab: newTab
                });
            } else if (tab.model instanceof Outline) {
                model = new Outline({
                    tab: newTab,
                    blockId: tab.model.blockId,
                    type: tab.model.type
                });
            } else if (tab.model instanceof Backlink) {
                model = new Backlink({
                    tab: newTab,
                    blockId: tab.model.blockId,
                    rootId: tab.model.rootId,
                    type: tab.model.type
                });
            } else if (tab.model instanceof Bookmark) {
                model = new Bookmark(newTab);
            } else if (tab.model instanceof Tag) {
                model = new Tag(newTab);
            } else if (tab.model instanceof Search) {
                model = new Search({
                    tab: newTab,
                    config: tab.model.config
                });
            } else if (!tab.model && tab.headElement) {
                const initData = JSON.parse(tab.headElement.getAttribute("data-initdata") || "{}");
                model = new Editor({
                    tab: newTab,
                    blockId: initData.rootId || initData.blockId,
                    mode: initData.mode,
                    action: typeof initData.action === "string" ? [initData.action] : initData.action,
                    scrollAttr: initData.scrollAttr,
                });
            }
            newTab.addModel(model);
        }
    });
};

export const getInstanceById = (id: string, layout = window.siyuan.layout.centerLayout) => {
    const _getInstanceById = (item: Layout | Wnd, id: string) => {
        if (item.id === id) {
            return item;
        }
        if (!item.children) {
            return;
        }
        let ret: Tab | Layout | Wnd;
        for (let i = 0; i < item.children.length; i++) {
            ret = _getInstanceById(item.children[i] as Layout, id) as Tab;
            if (ret) {
                return ret;
            }
        }
    };
    return _getInstanceById(layout, id);
};

export const addResize = (obj: Layout | Wnd) => {
    if (obj.resize) {
        const resizeWnd = (resizeElement: HTMLElement, direction: string) => {
            const setSize = (item: HTMLElement, direction: string) => {
                if (item.classList.contains("fn__flex-1")) {
                    if (direction === "lr") {
                        item.style.width = item.clientWidth + "px";
                    } else {
                        item.style.height = item.clientHeight + "px";
                    }
                    item.classList.remove("fn__flex-1");
                }
            };

            let range: Range;
            resizeElement.addEventListener("mousedown", (event: MouseEvent) => {
                getAllModels().editor.forEach((item) => {
                    if (item.editor && item.editor.protyle && item.element.parentElement) {
                        hideElements(["gutter"], item.editor.protyle);
                    }
                });

                if (getSelection().rangeCount > 0) {
                    range = getSelection().getRangeAt(0);
                }
                const documentSelf = document;
                const nextElement = resizeElement.nextElementSibling as HTMLElement;
                const previousElement = resizeElement.previousElementSibling as HTMLElement;
                nextElement.style.transition = "";
                nextElement.style.overflow = "auto"; // 拖动时 layout__resize 会出现 https://github.com/siyuan-note/siyuan/issues/6221
                previousElement.style.transition = "";
                previousElement.style.overflow = "auto";
                setSize(nextElement, direction);
                setSize(previousElement, direction);
                const x = event[direction === "lr" ? "clientX" : "clientY"];
                const previousSize = direction === "lr" ? previousElement.clientWidth : previousElement.clientHeight;
                const nextSize = direction === "lr" ? nextElement.clientWidth : nextElement.clientHeight;

                documentSelf.ondragstart = () => {
                    // 文件树拖拽会产生透明效果
                    document.querySelectorAll(".sy__file .b3-list-item").forEach((item: HTMLElement) => {
                        if (item.style.opacity === "0.1") {
                            item.style.opacity = "";
                        }
                    });
                    return false;
                };

                documentSelf.onmousemove = (moveEvent: MouseEvent) => {
                    moveEvent.preventDefault();
                    moveEvent.stopPropagation();
                    const previousNowSize = (previousSize + (moveEvent[direction === "lr" ? "clientX" : "clientY"] - x));
                    const nextNowSize = (nextSize - (moveEvent[direction === "lr" ? "clientX" : "clientY"] - x));
                    if (previousNowSize < 8 || nextNowSize < 8) {
                        return;
                    }
                    if (window.siyuan.layout.leftDock.layout.element.contains(previousElement) && previousNowSize < 188) {
                        return;
                    }
                    if (window.siyuan.layout.rightDock.layout.element.contains(nextElement) && nextNowSize < 188) {
                        return;
                    }
                    previousElement.style[direction === "lr" ? "width" : "height"] = previousNowSize + "px";
                    nextElement.style[direction === "lr" ? "width" : "height"] = nextNowSize + "px";
                };

                documentSelf.onmouseup = () => {
                    documentSelf.onmousemove = null;
                    documentSelf.onmouseup = null;
                    documentSelf.ondragstart = null;
                    documentSelf.onselectstart = null;
                    documentSelf.onselect = null;

                    if (!nextElement.nextElementSibling) {
                        if (!previousElement.previousElementSibling) {
                            nextElement.style[direction === "lr" ? "width" : "height"] = "";
                            nextElement.classList.add("fn__flex-1");
                        } else {
                            previousElement.style[direction === "lr" ? "width" : "height"] = "";
                            previousElement.classList.add("fn__flex-1");
                        }
                    } else if (nextElement.nextElementSibling?.nextElementSibling &&
                        nextElement.parentElement.lastElementChild.isSameNode(nextElement.nextElementSibling.nextElementSibling)) {
                        nextElement.style[direction === "lr" ? "width" : "height"] = "";
                        nextElement.classList.add("fn__flex-1");
                    }
                    resizeTabs();
                    window.siyuan.layout.leftDock.setSize();
                    window.siyuan.layout.topDock.setSize();
                    window.siyuan.layout.bottomDock.setSize();
                    window.siyuan.layout.rightDock.setSize();
                    if (range) {
                        focusByRange(range);
                    }
                    nextElement.style.transition = "var(--b3-width-transition)";
                    nextElement.style.overflow = "";
                    previousElement.style.transition = "var(--b3-width-transition)";
                    previousElement.style.overflow = "";
                };
            });
        };

        const resizeElement = document.createElement("div");
        if (obj.resize === "lr") {
            resizeElement.classList.add("layout__resize--lr");
        }
        resizeElement.classList.add("layout__resize");
        obj.element.insertAdjacentElement("beforebegin", resizeElement);
        obj.element.style.transition = "var(--b3-width-transition)";
        (resizeElement.previousElementSibling as HTMLElement).style.transition = "var(--b3-width-transition)";
        resizeWnd(resizeElement, obj.resize);
    }
};

export const newCenterEmptyTab = () => {
    return new Tab({
        panel: `<div class="layout__empty b3-list">
    <div class="${!window.siyuan.config.readonly ? " fn__none" : ""}">
        <div class="config-about__logo">
            <img src="/stage/icon.png">
            ${window.siyuan.languages.siyuanNote}
        </div>
        <div class="b3-label__text">${window.siyuan.languages.slogan}</div>
    </div>
    <h1>${window.siyuan.languages.noOpenFile}</h1>
    <div class="fn__hr"></div>
    <div class="fn__hr"></div>
    <div class="b3-list-item" id="editorEmptySearch"><svg class="b3-list-item__graphic"><use xlink:href="#iconSearch"></use></svg><span>${window.siyuan.languages.search}</span><span class="b3-list-item__meta">${updateHotkeyTip(window.siyuan.config.keymap.general.globalSearch.custom)}</span></div>
    <div class="b3-list-item${window.siyuan.config.readonly ? " fn__none" : ""}" id="editorEmptyFile"><svg class="b3-list-item__graphic"><use xlink:href="#iconFile"></use></svg><span>${window.siyuan.languages.newFile}</span><span class="b3-list-item__meta">${updateHotkeyTip(window.siyuan.config.keymap.general.newFile.custom)}</span></div>
    <div class="b3-list-item${window.siyuan.config.readonly ? " fn__none" : ""}" id="editorEmptyNewNotebook"><svg class="b3-list-item__graphic"><use xlink:href="#iconFilesRoot"></use></svg><span>${window.siyuan.languages.newNotebook}</span></div>
    <div class="b3-list-item" id="editorEmptyHelp"><svg class="b3-list-item__graphic"><use xlink:href="#iconHelp"></use></svg><span>${window.siyuan.languages.help}</span></div>
</div>`,
        callback(tab: Tab) {
            tab.panelElement.querySelector("#editorEmptyHelp").addEventListener("click", () => {
                mountHelp();
            });
            tab.panelElement.querySelector("#editorEmptySearch").addEventListener("click", () => {
                openSearch(window.siyuan.config.keymap.general.globalSearch.custom);
            });
            if (!window.siyuan.config.readonly) {
                tab.panelElement.querySelector("#editorEmptyNewNotebook").addEventListener("click", () => {
                    newNotebook();
                });
                tab.panelElement.querySelector("#editorEmptyFile").addEventListener("click", () => {
                    newFile(undefined, undefined, true);
                });
            }
        }
    });
};

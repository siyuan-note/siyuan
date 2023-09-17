import {Layout} from "./index";
import {Wnd} from "./Wnd";
import {mountHelp, newNotebook} from "../util/mount";
import {Tab} from "./Tab";
import {Model} from "./Model";
import {Graph} from "./dock/Graph";
import {Editor} from "../editor";
import {Files} from "./dock/Files";
import {newFile} from "../util/newFile";
import {Outline} from "./dock/Outline";
import {Bookmark} from "./dock/Bookmark";
import {updateHotkeyTip} from "../protyle/util/compatibility";
import {Tag} from "./dock/Tag";
import {getAllModels, getAllTabs} from "./getAll";
import {Asset} from "../asset";
import {Search} from "../search";
import {Dock} from "./dock";
import {focusByOffset, focusByRange, getSelectionOffset} from "../protyle/util/selection";
import {hideAllElements, hideElements} from "../protyle/ui/hideElements";
import {fetchPost} from "../util/fetch";
import {hasClosestBlock, hasClosestByClassName} from "../protyle/util/hasClosest";
import {getContenteditableElement} from "../protyle/wysiwyg/getBlock";
import {Constants} from "../constants";
import {openSearch} from "../search/spread";
import {saveScroll} from "../protyle/scroll/saveScroll";
import {pdfResize} from "../asset/renderAssets";
import {Backlink} from "./dock/Backlink";
import {openFileById} from "../editor/util";
import {isWindow} from "../util/functions";
/// #if !BROWSER
import {setTabPosition} from "../window/setHeader";
/// #endif
import {showMessage} from "../dialog/message";
import {getIdZoomInByPath} from "../util/pathName";
import {openHistory} from "../history/history";
import {Custom} from "./dock/Custom";
import {newCardModel} from "../card/newCardTab";
import {openRecentDocs} from "../business/openRecentDocs";
import {App} from "../index";
import {afterLoadPlugin} from "../plugin/loader";

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
        Array.from(element.classList).find(item => {
            if (item.startsWith("sy__")) {
                document.querySelector(`.dock__item[data-type="${item.substring(4)}"]`).classList.add("dock__item--activefocus");
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

export const getDockByType = (type: string) => {
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
};

export const switchWnd = (newWnd: Wnd, targetWnd: Wnd) => {
    // DOM 移动后 range 会变化
    const rangeDatas: {
        id: string,
        start: number,
        end: number
    }[] = [];
    targetWnd.children.forEach((item) => {
        if (item.model instanceof Editor && item.model.editor.protyle.toolbar.range) {
            const blockElement = hasClosestBlock(item.model.editor.protyle.toolbar.range.startContainer);
            if (blockElement) {
                const startEnd = getSelectionOffset(blockElement, undefined, item.model.editor.protyle.toolbar.range);
                rangeDatas.push({
                    id: blockElement.getAttribute("data-node-id"),
                    start: startEnd.start,
                    end: startEnd.end
                });
            }
        }
    });
    newWnd.element.after(targetWnd.element);
    targetWnd.children.forEach((item) => {
        if (item.model instanceof Editor) {
            const rangeData = rangeDatas.splice(0, 1)[0];
            if (!rangeData) {
                return;
            }
            const range = focusByOffset(item.model.editor.protyle.wysiwyg.element.querySelector(`[data-node-id="${rangeData.id}"]`), rangeData.start, rangeData.end);
            if (range) {
                item.model.editor.protyle.toolbar.range = range;
            }
        }
    });
    // 分隔线
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
    /// #if !BROWSER
    setTabPosition();
    /// #endif
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
                type: item.getAttribute("data-type"),
                size: {
                    height: parseInt(item.getAttribute("data-height")),
                    width: parseInt(item.getAttribute("data-width")),
                },
                title: item.getAttribute("data-title"),
                show: item.classList.contains("dock__item--active"),
                icon: item.querySelector("use").getAttribute("xlink:href").substring(1),
                hotkey: item.getAttribute("data-hotkey") || "",
                hotkeyLangId: item.getAttribute("data-hotkeyLangId") || ""
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
    return {
        pin: dock.pin,
        data: json
    };
};

export const resetLayout = () => {
    fetchPost("/api/system/setUILayout", {layout: {}}, () => {
        window.location.reload();
    });
};

export const exportLayout = (options: {
    reload: boolean,
    cb?: () => void,
    onlyData: boolean,
    errorExit: boolean,
    dropEditScroll?: boolean
}) => {
    if (isWindow()) {
        const layoutJSON: any = {
            layout: {},
        };
        layoutToJSON(window.siyuan.layout.layout, layoutJSON.layout, !!options.dropEditScroll);
        if (options.onlyData) {
            return layoutJSON;
        }
        sessionStorage.setItem("layout", JSON.stringify(layoutJSON));
        if (options.reload) {
            window.location.reload();
        } else if (options.cb) {
            options.cb();
        }
        return;
    }
    const useElement = document.querySelector("#barDock use");
    if (!useElement) {
        return;
    }
    const layoutJSON: any = {
        hideDock: useElement.getAttribute("xlink:href") === "#iconDock",
        layout: {},
        bottom: dockToJSON(window.siyuan.layout.bottomDock),
        left: dockToJSON(window.siyuan.layout.leftDock),
        right: dockToJSON(window.siyuan.layout.rightDock),
    };
    layoutToJSON(window.siyuan.layout.layout, layoutJSON.layout, !!options.dropEditScroll);
    if (options.onlyData) {
        return layoutJSON;
    }
    fetchPost("/api/system/setUILayout", {
        layout: layoutJSON,
        errorExit: options.errorExit    // 后台不接受该参数，用于请求发生错误时退出程序
    }, () => {
        if (options.reload) {
            window.location.reload();
        } else if (options.cb) {
            options.cb();
        }
    });
};

const initInternalDock = (dockItem: IDockTab[]) => {
    dockItem.forEach((existSubItem) => {
        if (existSubItem.hotkeyLangId) {
            existSubItem.title = window.siyuan.languages[existSubItem.hotkeyLangId];
            existSubItem.hotkey = window.siyuan.config.keymap.general[existSubItem.hotkeyLangId].custom;
        }
    });
};

const JSONToDock = (json: any, app: App) => {
    json.left.data.forEach((existItem: IDockTab[]) => {
        initInternalDock(existItem);
    });
    json.right.data.forEach((existItem: IDockTab[]) => {
        initInternalDock(existItem);
    });
    json.bottom.data.forEach((existItem: IDockTab[]) => {
        initInternalDock(existItem);
    });
    window.siyuan.layout.centerLayout = window.siyuan.layout.layout.children[0].children[1] as Layout;
    window.siyuan.layout.leftDock = new Dock({position: "Left", data: json.left, app});
    window.siyuan.layout.rightDock = new Dock({position: "Right", data: json.right, app});
    window.siyuan.layout.bottomDock = new Dock({position: "Bottom", data: json.bottom, app});
};

export const JSONToCenter = (app: App, json: ILayoutJSON, layout?: Layout | Wnd | Tab | Model) => {
    let child: Layout | Wnd | Tab | Model;
    if (json.instance === "Layout") {
        if (!layout) {
            window.siyuan.layout.layout = new Layout({
                element: document.getElementById("layouts"),
                direction: json.direction,
                size: json.size,
                type: json.type,
                resize: json.resize
            });
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
        child = new Wnd(app, json.resize, (layout as Layout).type);
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
            child = newCenterEmptyTab(app);
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
        if (json.scrollAttr) {
            // 历史数据兼容
            json.scrollAttr.rootId = json.rootId;
        }
        (layout as Tab).headElement.setAttribute("data-initdata", JSON.stringify(json));
    } else if (json.instance === "Asset") {
        (layout as Tab).addModel(new Asset({
            app,
            tab: (layout as Tab),
            path: json.path,
            page: json.page,
        }));
    } else if (json.instance === "Backlink") {
        (layout as Tab).addModel(new Backlink({
            app,
            tab: (layout as Tab),
            blockId: json.blockId,
            rootId: json.rootId,
            type: json.type as "pin" | "local",
        }));
    } else if (json.instance === "Bookmark") {
        (layout as Tab).addModel(new Bookmark(app, (layout as Tab)));
    } else if (json.instance === "Files") {
        (layout as Tab).addModel(new Files({
            app,
            tab: (layout as Tab),
        }));
    } else if (json.instance === "Graph") {
        (layout as Tab).addModel(new Graph({
            app,
            tab: (layout as Tab),
            blockId: json.blockId,
            rootId: json.rootId,
            type: json.type as "pin" | "local" | "global",
        }));
    } else if (json.instance === "Outline") {
        (layout as Tab).addModel(new Outline({
            app,
            tab: (layout as Tab),
            blockId: json.blockId,
            type: json.type as "pin" | "local",
            isPreview: json.isPreview,
        }));
    } else if (json.instance === "Tag") {
        (layout as Tab).addModel(new Tag(app, (layout as Tab)));
    } else if (json.instance === "Search") {
        (layout as Tab).addModel(new Search({
            app,
            tab: (layout as Tab),
            config: json.config
        }));
    } else if (json.instance === "Custom") {
        if (window.siyuan.config.fileTree.openFilesUseCurrentTab) {
            (layout as Tab).headElement.classList.add("item--unupdate");
        }
        (layout as Tab).headElement.setAttribute("data-initdata", JSON.stringify(json));
    }
    if (json.children) {
        if (Array.isArray(json.children)) {
            json.children.forEach((item: any) => {
                JSONToCenter(app, item, layout ? child : window.siyuan.layout.layout);
            });
        } else {
            JSONToCenter(app, json.children, child);
        }
    }
};

export const JSONToLayout = (app: App, isStart: boolean) => {
    JSONToCenter(app, window.siyuan.config.uiLayout.layout, undefined);
    JSONToDock(window.siyuan.config.uiLayout, app);
    // 启动时不打开页签，需要移除没有钉住的页签
    if (window.siyuan.config.fileTree.closeTabsOnStart && isStart) {
        getAllTabs().forEach(item => {
            if (item.headElement && !item.headElement.classList.contains("item--pin")) {
                item.parent.removeTab(item.id, false, false, false);
            }
        });
    }
    app.plugins.forEach(item => {
        afterLoadPlugin(item);
    });
    // 移除没有插件的 tab
    document.querySelectorAll('li[data-type="tab-header"]').forEach((item: HTMLElement) => {
        const initData = item.getAttribute("data-initdata");
        if (initData) {
            const initDataObj = JSON.parse(initData);
            if (initDataObj.instance === "Custom" && initDataObj.customModelType !== "siyuan-card") {
                let hasPlugin = false;
                app.plugins.find(plugin => {
                    if (Object.keys(plugin.models).includes(initDataObj.customModelType)) {
                        hasPlugin = true;
                        return true;
                    }
                });
                if (!hasPlugin) {
                    const tabId = item.getAttribute("data-id");
                    const tab = getInstanceById(tabId) as Tab;
                    if (tab) {
                        tab.parent.removeTab(tabId, false, false, false);
                    }
                }
            }
        }
    });
    const idZoomIn = getIdZoomInByPath();
    if (idZoomIn.id) {
        openFileById({
            app,
            id: idZoomIn.id,
            action: idZoomIn.isZoomIn ? [Constants.CB_GET_ALL, Constants.CB_GET_FOCUS] : [Constants.CB_GET_FOCUS, Constants.CB_GET_CONTEXT, Constants.CB_GET_ROOTSCROLL],
            zoomIn: idZoomIn.isZoomIn
        });
    } else {
        document.querySelectorAll('li[data-type="tab-header"][data-init-active="true"]').forEach((item: HTMLElement) => {
            item.removeAttribute("data-init-active");
            const tab = getInstanceById(item.getAttribute("data-id")) as Tab;
            tab.parent.switchTab(item, false, false);
        });
    }
    resizeTopbar();
};

export const layoutToJSON = (layout: Layout | Wnd | Tab | Model, json: any, dropEditScroll = false) => {
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
        if (!dropEditScroll) {
            json.scrollAttr = saveScroll(layout.editor.protyle, true);
        }
    } else if (layout instanceof Asset) {
        json.path = layout.path;
        if (layout.pdfObject) {
            json.page = layout.pdfObject.page;
        }
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
        json.isPreview = layout.isPreview;
        json.instance = "Outline";
    } else if (layout instanceof Tag) {
        json.instance = "Tag";
    } else if (layout instanceof Search) {
        json.instance = "Search";
        json.config = layout.config;
    } else if (layout instanceof Custom) {
        json.instance = "Custom";
        json.customModelType = layout.type;
        json.customModelData = layout.data;
    }

    if (layout instanceof Layout || layout instanceof Wnd) {
        if (layout instanceof Layout &&
            (layout.type === "bottom" || layout.type === "left" || layout.type === "right")) {
            // 四周布局使用默认值，清空内容，重置时使用 dock 数据
            if (layout.type === "bottom") {
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
                layoutToJSON(item, itemJSON, dropEditScroll);
            });
        }
    } else if (layout instanceof Tab) {
        if (layout.model) {
            json.children = {};
            layoutToJSON(layout.model, json.children, dropEditScroll);
        } else if (layout.headElement) {
            // 当前页签没有激活时编辑器没有初始化
            json.children = JSON.parse(layout.headElement.getAttribute("data-initdata") || "{}");
        } else {
            // 关闭所有页签
            json.children = {};
        }
    }
};

export const resizeTopbar = () => {
    const toolbarElement = document.querySelector("#toolbar");
    if (!toolbarElement) {
        return;
    }
    const dragElement = toolbarElement.querySelector("#drag") as HTMLElement;

    dragElement.style.padding = "";
    const barMoreElement = toolbarElement.querySelector("#barMore");
    barMoreElement.classList.remove("fn__none");
    barMoreElement.removeAttribute("data-hideids");

    Array.from(toolbarElement.querySelectorAll('[data-hide="true"]')).forEach((item) => {
        item.classList.remove("fn__none");
        item.removeAttribute("data-hide");
    });

    let afterDragElement = dragElement.nextElementSibling;
    const hideIds: string[] = [];
    while (toolbarElement.scrollWidth > toolbarElement.clientWidth + 2) {
        hideIds.push(afterDragElement.id);
        afterDragElement.classList.add("fn__none");
        afterDragElement.setAttribute("data-hide", "true");
        afterDragElement = afterDragElement.nextElementSibling;
        if (afterDragElement.id === "barMore") {
            break;
        }
    }

    let beforeDragElement = dragElement.previousElementSibling;
    while (toolbarElement.scrollWidth > toolbarElement.clientWidth + 2) {
        hideIds.push(beforeDragElement.id);
        beforeDragElement.classList.add("fn__none");
        beforeDragElement.setAttribute("data-hide", "true");
        beforeDragElement = beforeDragElement.previousElementSibling;
        if (beforeDragElement.id === "barWorkspace") {
            break;
        }
    }
    if (hideIds.length > 0) {
        barMoreElement.classList.remove("fn__none");
    } else {
        barMoreElement.classList.add("fn__none");
    }
    barMoreElement.setAttribute("data-hideids", hideIds.join(","));

    const width = dragElement.clientWidth;
    const dragRect = dragElement.getBoundingClientRect();
    const left = dragRect.left;
    const right = window.innerWidth - dragRect.right;
    if (left > right && left - right < width / 3) {
        dragElement.style.paddingRight = (left - right) + "px";
    } else if (left < right && right - left < width / 3) {
        dragElement.style.paddingLeft = (right - left) + "px";
    }
    window.siyuan.storage[Constants.LOCAL_PLUGINTOPUNPIN].forEach((id: string) => {
        toolbarElement.querySelector("#" + id)?.classList.add("fn__none");
    });
};

let resizeTimeout: number;
export const resizeTabs = () => {
    clearTimeout(resizeTimeout);
    //  .layout .fn__flex-shrink {width .15s cubic-bezier(0, 0, .2, 1) 0ms} 时需要再次计算 padding
    // PDF 避免分屏多次调用后，页码跳转到1 https://github.com/siyuan-note/siyuan/issues/5646
    resizeTimeout = window.setTimeout(() => {
        const models = getAllModels();
        models.editor.forEach((item) => {
            if (item.editor && item.editor.protyle &&
                item.element.parentElement && !item.element.classList.contains("fn__none")) {
                item.editor.resize();
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
                editorItem.resize();
            });
        });
        models.search.forEach(item => {
            item.edit.resize();
        });
        models.custom.forEach(item => {
            if (item.resize) {
                item.resize();
            }
        });
        pdfResize();
        hideAllElements(["gutter"]);
    }, 200);
};

export const copyTab = (app: App, tab: Tab) => {
    return new Tab({
        icon: tab.icon,
        docIcon: tab.docIcon,
        title: tab.title,
        callback(newTab: Tab) {
            let model: Model;
            if (tab.model instanceof Editor) {
                model = new Editor({
                    app,
                    tab: newTab,
                    blockId: tab.model.editor.protyle.block.id,
                    scrollAttr: saveScroll(tab.model.editor.protyle, true)
                });
            } else if (tab.model instanceof Asset) {
                model = new Asset({
                    app,
                    tab: newTab,
                    path: tab.model.path
                });
            } else if (tab.model instanceof Graph) {
                model = new Graph({
                    app,
                    tab: newTab,
                    blockId: tab.model.blockId,
                    rootId: tab.model.rootId,
                    type: tab.model.type,
                });
            } else if (tab.model instanceof Files) {
                model = new Files({
                    app,
                    tab: newTab
                });
            } else if (tab.model instanceof Outline) {
                model = new Outline({
                    app,
                    tab: newTab,
                    blockId: tab.model.blockId,
                    type: tab.model.type,
                    isPreview: tab.model.isPreview
                });
            } else if (tab.model instanceof Backlink) {
                model = new Backlink({
                    app,
                    tab: newTab,
                    blockId: tab.model.blockId,
                    rootId: tab.model.rootId,
                    type: tab.model.type
                });
            } else if (tab.model instanceof Bookmark) {
                model = new Bookmark(app, newTab);
            } else if (tab.model instanceof Tag) {
                model = new Tag(app, newTab);
            } else if (tab.model instanceof Search) {
                model = new Search({
                    app,
                    tab: newTab,
                    config: tab.model.config
                });
            } else if (tab.model instanceof Custom) {
                const custom = tab.model as Custom;
                if (custom.type === "siyuan-card") {
                    model = newCardModel({
                        app,
                        tab: newTab,
                        data: custom.data
                    });
                } else {
                    app.plugins.find(item => {
                        if (item.models[custom.type]) {
                            model = item.models[custom.type]({
                                tab: newTab,
                                data: custom.data
                            });
                            return true;
                        }
                    });
                }
            } else if (!tab.model && tab.headElement) {
                const initData = JSON.parse(tab.headElement.getAttribute("data-initdata") || "{}");
                if (initData) {
                    // 历史数据兼容 2023-05-24
                    if (initData.scrollAttr) {
                        initData.scrollAttr.rootId = initData.rootId;
                    }
                    model = newModelByInitData(app, newTab, initData);
                }
            }
            newTab.addModel(model);
        }
    });
};

export const newModelByInitData = (app: App, tab: Tab, json: any) => {
    let model: Model;
    if (json.instance === "Custom") {
        if (json.customModelType === "siyuan-card") {
            model = newCardModel({
                app,
                tab: tab,
                data: json.customModelData
            });
        } else {
            app.plugins.find(item => {
                if (item.models[json.customModelType]) {
                    model = item.models[json.customModelType]({
                        tab: tab,
                        data: json.customModelData
                    });
                    return true;
                }
            });
        }
    } else if (json.instance === "Editor") {
        model = new Editor({
            app,
            tab,
            blockId: json.blockId,
            mode: json.mode,
            action: typeof json.action === "string" ? [json.action] : json.action,
            scrollAttr: json.scrollAttr,
        });
    }
    return model;
};

export const pdfIsLoading = (element: HTMLElement) => {
    const isLoading = element.querySelector('.layout-tab-container > [data-loading="true"]') ? true : false;
    if (isLoading) {
        showMessage(window.siyuan.languages.pdfIsLoading);
    }
    return isLoading;
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
    if (!obj.resize) {
        return;
    }

    const getMinSize = (element: HTMLElement) => {
        let minSize = 227;
        Array.from(element.querySelectorAll(".file-tree")).find((item) => {
            if (item.classList.contains("sy__backlink") || item.classList.contains("sy__graph")
                || item.classList.contains("sy__globalGraph") || item.classList.contains("sy__inbox")) {
                if (!item.classList.contains("fn__none") && !hasClosestByClassName(item, "fn__none")) {
                    minSize = 320;
                    return true;
                }
            }
        });
        return minSize;
    };
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
            nextElement.style.overflow = "auto"; // 拖动时 layout__resize 会出现 https://github.com/siyuan-note/siyuan/issues/6221
            previousElement.style.overflow = "auto";
            if (!nextElement.nextElementSibling || nextElement.nextElementSibling.classList.contains("layout__dockresize")) {
                setSize(nextElement, direction);
            } else {
                setSize(previousElement, direction);
            }
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
                if (window.siyuan.layout.leftDock?.layout.element.isSameNode(previousElement) &&
                    previousNowSize < getMinSize(previousElement)) {
                    return;
                }
                if (window.siyuan.layout.rightDock?.layout.element.isSameNode(nextElement) &&
                    nextNowSize < getMinSize(nextElement)) {
                    return;
                }
                if (window.siyuan.layout.bottomDock?.layout.element.isSameNode(nextElement) &&
                    nextNowSize < 64) {
                    return;
                }
                if (!previousElement.classList.contains("fn__flex-1")) {
                    previousElement.style[direction === "lr" ? "width" : "height"] = previousNowSize + "px";
                }
                if (!nextElement.classList.contains("fn__flex-1")) {
                    nextElement.style[direction === "lr" ? "width" : "height"] = nextNowSize + "px";
                }
            };

            documentSelf.onmouseup = () => {
                documentSelf.onmousemove = null;
                documentSelf.onmouseup = null;
                documentSelf.ondragstart = null;
                documentSelf.onselectstart = null;
                documentSelf.onselect = null;
                resizeTabs();
                if (!isWindow()) {
                    window.siyuan.layout.leftDock.setSize();
                    window.siyuan.layout.bottomDock.setSize();
                    window.siyuan.layout.rightDock.setSize();
                }
                if (range) {
                    focusByRange(range);
                }
                nextElement.style.overflow = "";
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
    resizeWnd(resizeElement, obj.resize);
};

export const newCenterEmptyTab = (app: App) => {
    return new Tab({
        panel: `<div class="layout__empty b3-list">
    <div class="${!window.siyuan.config.readonly ? " fn__none" : ""}">
        <div class="config-about__logo">
            <img src="/stage/icon.png">
            ${window.siyuan.languages.siyuanNote}
        </div>
        <div class="b3-label__text">${window.siyuan.languages.slogan}</div>
    </div>
    <div class="fn__hr"></div>
    <div class="b3-list-item" id="editorEmptySearch">
        <svg class="b3-list-item__graphic"><use xlink:href="#iconSearch"></use></svg>
        <span>${window.siyuan.languages.search}</span>
        <span class="b3-list-item__meta">${updateHotkeyTip(window.siyuan.config.keymap.general.globalSearch.custom)}</span>
    </div>
    <div id="editorEmptyRecent" class="b3-list-item">
        <svg class="b3-list-item__graphic"><use xlink:href="#iconList"></use></svg>
        <span>${window.siyuan.languages.recentDocs}</span>
        <span class="b3-list-item__meta">${updateHotkeyTip(window.siyuan.config.keymap.general.recentDocs.custom)}</span>
    </div>
    <div id="editorEmptyHistory" class="b3-list-item${window.siyuan.config.readonly ? " fn__none" : ""}">
        <svg class="b3-list-item__graphic"><use xlink:href="#iconHistory"></use></svg>
        <span>${window.siyuan.languages.dataHistory}</span>
        <span class="b3-list-item__meta">${updateHotkeyTip(window.siyuan.config.keymap.general.dataHistory.custom)}</span>
    </div>
    <div class="b3-list-item${window.siyuan.config.readonly ? " fn__none" : ""}" id="editorEmptyFile">
        <svg class="b3-list-item__graphic"><use xlink:href="#iconFile"></use></svg>
        <span>${window.siyuan.languages.newFile}</span>
        <span class="b3-list-item__meta">${updateHotkeyTip(window.siyuan.config.keymap.general.newFile.custom)}</span>
    </div>
    <div class="b3-list-item${window.siyuan.config.readonly ? " fn__none" : ""}" id="editorEmptyNewNotebook">
        <svg class="b3-list-item__graphic"><use xlink:href="#iconFilesRoot"></use></svg>
        <span>${window.siyuan.languages.newNotebook}</span>
    </div>
    <div class="b3-list-item" id="editorEmptyHelp">
        <svg class="b3-list-item__graphic"><use xlink:href="#iconHelp"></use></svg>
        <span>${window.siyuan.languages.help}</span>
    </div>
</div>`,
        callback(tab: Tab) {
            tab.panelElement.addEventListener("click", (event) => {
                let target = event.target as HTMLElement;
                while (target && !target.isEqualNode(tab.panelElement)) {
                    if (target.id === "editorEmptySearch") {
                        openSearch({
                            app,
                            hotkey: window.siyuan.config.keymap.general.globalSearch.custom,
                        });
                        event.stopPropagation();
                        event.preventDefault();
                        break;
                    } else if (target.id === "editorEmptyRecent") {
                        const openRecentDocsDialog = window.siyuan.dialogs.find(item => {
                            if (item.element.getAttribute("data-key") === window.siyuan.config.keymap.general.recentDocs.custom) {
                                return true;
                            }
                        });
                        if (openRecentDocsDialog) {
                            hideElements(["dialog"]);
                            return;
                        }
                        openRecentDocs();
                        event.stopPropagation();
                        event.preventDefault();
                        break;
                    } else if (target.id === "editorEmptyHistory") {
                        openHistory(app);
                        event.stopPropagation();
                        event.preventDefault();
                        break;
                    } else if (target.id === "editorEmptyFile") {
                        newFile(app, undefined, undefined, undefined, true);
                        event.stopPropagation();
                        event.preventDefault();
                        break;
                    } else if (target.id === "editorEmptyNewNotebook") {
                        newNotebook();
                        event.stopPropagation();
                        event.preventDefault();
                        break;
                    } else if (target.id === "editorEmptyHelp") {
                        mountHelp();
                        event.stopPropagation();
                        event.preventDefault();
                        break;
                    }
                    target = target.parentElement;
                }
            });
        }
    });
};

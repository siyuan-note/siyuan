import {getAllModels} from "../getAll";
import {Tab} from "../Tab";
import {Graph} from "./Graph";
import {Outline} from "./Outline";
import {getInstanceById, getWndByLayout, saveLayout, switchWnd} from "../util";
import {resizeTabs} from "../tabUtil";
import {Backlink} from "./Backlink";
import {App} from "../../index";
import {Wnd} from "../Wnd";
import {fetchSyncPost} from "../../util/fetch";

export const openBacklink = async (options: {
    app: App,
    blockId: string,
    rootId?: string,
    title?: string,
    useBlockId?: boolean,
}) => {
    const backlink = getAllModels().backlink.find(item => {
        if (item.blockId === options.blockId && item.type === "local") {
            item.parent.parent.removeTab(item.parent.id);
            return true;
        }
    });
    if (backlink) {
        return;
    }
    let wnd: Wnd = undefined;
    const element = document.querySelector(".layout__wnd--active");
    if (element) {
        wnd = getInstanceById(element.getAttribute("data-id")) as Wnd;
    }
    if (!wnd) {
        wnd = getWndByLayout(window.siyuan.layout.centerLayout);
    }
    if (!options.rootId) {
        const response = await fetchSyncPost("api/block/getDocInfo", {id: options.blockId});
        if (response.code === -1) {
            return;
        }
        options.rootId = response.data.rootID;
        options.useBlockId = response.data.rootID !== response.data.id;
        options.title = response.data.name || window.siyuan.languages.untitled;
    } else if (!options.title) {
        const response = await fetchSyncPost("api/block/getDocInfo", {id: options.blockId});
        if (response.code === -1) {
            return;
        }
        options.title = response.data.name || window.siyuan.languages.untitled;
    }
    const newWnd = wnd.split("lr");
    newWnd.addTab(new Tab({
        icon: "iconLink",
        title: options.title,
        callback(tab: Tab) {
            tab.addModel(new Backlink({
                app: options.app,
                type: "local",
                tab,
                // 通过搜索打开的包含上下文，但不是缩放，因此需要传 rootID https://ld246.com/article/1666786639708
                blockId: options.useBlockId ? options.blockId : options.rootId,
                rootId: options.rootId,
            }));
        }
    }));
};

export const openGraph = async (options: {
    app: App,
    blockId: string,
    rootId?: string,
    title?: string,
    useBlockId?: boolean,
}) => {
    const graph = getAllModels().graph.find(item => {
        if (item.blockId === options.blockId && item.type === "local") {
            item.parent.parent.removeTab(item.parent.id);
            return true;
        }
    });
    if (graph) {
        return;
    }
    let wnd: Wnd = undefined;
    const element = document.querySelector(".layout__wnd--active");
    if (element) {
        wnd = getInstanceById(element.getAttribute("data-id")) as Wnd;
    }
    if (!wnd) {
        wnd = getWndByLayout(window.siyuan.layout.centerLayout);
    }
    if (!options.rootId) {
        const response = await fetchSyncPost("api/block/getDocInfo", {id: options.blockId});
        if (response.code === -1) {
            return;
        }
        options.rootId = response.data.rootID;
        options.useBlockId = response.data.rootID !== response.data.id;
        options.title = response.data.name || window.siyuan.languages.untitled;
    } else if (!options.title) {
        const response = await fetchSyncPost("api/block/getDocInfo", {id: options.blockId});
        if (response.code === -1) {
            return;
        }
        options.title = response.data.name || window.siyuan.languages.untitled;
    }
    const newWnd = wnd.split("lr");
    newWnd.addTab(new Tab({
        icon: "iconGraph",
        title: options.title,
        callback(tab: Tab) {
            tab.addModel(new Graph({
                app: options.app,
                type: "local",
                tab,
                blockId: options.blockId,
                rootId: options.rootId,
            }));
        }
    }));
};

export const openOutline = async (protyle: IProtyle) => {
    const outlinePanel = getAllModels().outline.find(item => {
        if (item.blockId === protyle.block.rootID && item.type === "local") {
            item.parent.parent.removeTab(item.parent.id);
            return true;
        }
    });
    if (outlinePanel) {
        return;
    }
    let wnd: Wnd = undefined;
    const element = document.querySelector(".layout__wnd--active");
    if (element) {
        wnd = getInstanceById(element.getAttribute("data-id")) as Wnd;
    }
    if (!wnd) {
        wnd = getWndByLayout(window.siyuan.layout.centerLayout);
    }
    const newWnd = wnd.split("lr");
    let title = "";
    if (!protyle.title) {
        const response = await fetchSyncPost("api/block/getDocInfo", {id: protyle.block.rootID});
        title = response.data.name || window.siyuan.languages.untitled;
    } else {
        title = protyle.title.editElement.textContent || window.siyuan.languages.untitled;
    }
    newWnd.addTab(new Tab({
        icon: "iconAlignCenter",
        title,
        callback(tab: Tab) {
            tab.addModel(new Outline({
                app: protyle.app,
                type: "local",
                tab,
                blockId: protyle.block.rootID,
                isPreview: !protyle.preview.element.classList.contains("fn__none")
            }));
        }
    }), false, false);
    switchWnd(newWnd, wnd);
    // https://github.com/siyuan-note/siyuan/issues/10500
    wnd.element.classList.remove("fn__flex-1");
    wnd.element.style.width = wnd.element.parentElement.clientWidth - 200 + "px";
    saveLayout();
};

export const resetFloatDockSize = () => {
    if (!window.siyuan.layout.leftDock.pin && window.siyuan.layout.leftDock.layout.element.style.opacity === "1") {
        window.siyuan.layout.leftDock.showDock(true);
    }
    if (!window.siyuan.layout.rightDock.pin && window.siyuan.layout.rightDock.layout.element.style.opacity === "1") {
        window.siyuan.layout.rightDock.showDock(true);
    }
    if (!window.siyuan.layout.bottomDock.pin && window.siyuan.layout.bottomDock.layout.element.style.opacity === "1") {
        window.siyuan.layout.bottomDock.showDock(true);
    }
};

export const toggleDockBar = (useElement: Element) => {
    const dockIsShow = useElement.getAttribute("xlink:href") === "#iconHideDock";
    if (dockIsShow) {
        useElement.setAttribute("xlink:href", "#iconDock");
    } else {
        useElement.setAttribute("xlink:href", "#iconHideDock");
    }
    window.siyuan.config.uiLayout.hideDock = dockIsShow;
    document.querySelectorAll(".dock").forEach(item => {
        if (dockIsShow) {
            item.classList.add("fn__none");
        } else if (item.querySelectorAll(".dock__item").length > 1) {
            item.classList.remove("fn__none");
        }
    });
    resizeTabs();
    resetFloatDockSize();
};

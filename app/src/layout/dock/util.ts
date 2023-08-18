import {getAllModels} from "../getAll";
import {Tab} from "../Tab";
import {Graph} from "./Graph";
import {Outline} from "./Outline";
import {resizeTabs, switchWnd} from "../util";
import {Backlink} from "./Backlink";

export const openBacklink = (protyle: IProtyle) => {
    const backlink = getAllModels().backlink.find(item => {
        if (item.blockId === protyle.block.id && item.type === "local") {
            item.parent.parent.removeTab(item.parent.id);
            return true;
        }
    });
    if (backlink) {
        return;
    }
    const newWnd = protyle.model.parent.parent.split("lr");
    const tab = new Tab({
        icon: "iconLink",
        title: protyle.title.editElement.textContent || "Untitled",
        callback(tab: Tab) {
            tab.addModel(new Backlink({
                app: protyle.app,
                type: "local",
                tab,
                // 通过搜索打开的包含上下文，但不是缩放，因此需要传 rootID https://ld246.com/article/1666786639708
                blockId: protyle.block.showAll ? protyle.block.id : protyle.block.rootID,
                rootId: protyle.block.rootID,
            }));
        }
    });
    newWnd.addTab(tab);
};

export const openGraph = (protyle: IProtyle) => {
    const graph = getAllModels().graph.find(item => {
        if (item.blockId === protyle.block.id && item.type === "local") {
            item.parent.parent.removeTab(item.parent.id);
            return true;
        }
    });
    if (graph) {
        return;
    }
    const wnd = protyle.model.parent.parent.split("lr");
    const tab = new Tab({
        icon: "iconGraph",
        title: protyle.title.editElement.textContent || "Untitled",
        callback(tab: Tab) {
            tab.addModel(new Graph({
                app: protyle.app,
                type: "local",
                tab,
                blockId: protyle.block.id,
                rootId: protyle.block.rootID,
            }));
        }
    });
    wnd.addTab(tab);
};

export const openOutline = (protyle: IProtyle) => {
    const outlinePanel = getAllModels().outline.find(item => {
        if (item.blockId === protyle.block.rootID && item.type === "local") {
            item.parent.parent.removeTab(item.parent.id);
            return true;
        }
    });
    if (outlinePanel) {
        return;
    }
    const newWnd = protyle.model.parent.parent.split("lr");
    const tab = new Tab({
        icon: "iconAlignCenter",
        title: protyle.title.editElement.textContent || "Untitled",
        callback(tab: Tab) {
            tab.addModel(new Outline({
                app: protyle.app,
                type: "local",
                tab,
                blockId: protyle.block.rootID,
                isPreview: !protyle.preview.element.classList.contains("fn__none")
            }));
        }
    });
    newWnd.addTab(tab);
    newWnd.element.classList.remove("fn__flex-1");
    newWnd.element.style.width = "200px";
    switchWnd(newWnd, protyle.model.parent.parent);
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

export const toggleDockBar = (useElement:Element)=> {
    const dockIsShow = useElement.getAttribute("xlink:href") === "#iconHideDock";
    if (dockIsShow) {
        useElement.setAttribute("xlink:href", "#iconDock");
    } else {
        useElement.setAttribute("xlink:href", "#iconHideDock");
    }
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

import {getAllModels} from "../getAll";
import {Tab} from "../Tab";
import {Backlinks} from "./Backlinks";
import {Graph} from "./Graph";
import {Outline} from "./Outline";
import {switchWnd} from "../util";

export const openBacklink = (protyle: IProtyle) => {
    const backlink = getAllModels().backlinks.find(item => {
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
        title: protyle.title.editElement.textContent,
        callback(tab: Tab) {
            tab.addModel(new Backlinks({
                type: "local",
                tab,
                blockId: protyle.block.id,
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
        title: protyle.title.editElement.textContent,
        callback(tab: Tab) {
            tab.addModel(new Graph({
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
        title: protyle.title.editElement.textContent,
        callback(tab: Tab) {
            tab.addModel(new Outline({
                type: "local",
                tab,
                blockId: protyle.block.rootID,
            }));
        }
    });
    newWnd.addTab(tab);
    newWnd.element.classList.remove("fn__flex-1");
    newWnd.element.style.width = "200px";
    switchWnd(newWnd, protyle.model.parent.parent);
};

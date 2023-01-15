import {getAllModels} from "../getAll";
import {Tab} from "../Tab";
import {Graph} from "./Graph";
import {Outline} from "./Outline";
import {switchWnd} from "../util";
import {Backlink} from "./Backlink";
import {Dialog} from "../../dialog";
import {fetchPost} from "../../util/fetch";

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
        title: protyle.title.editElement.textContent,
        callback(tab: Tab) {
            tab.addModel(new Backlink({
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

export const renameTag = (labelName: string) => {
    const dialog = new Dialog({
        title: window.siyuan.languages.rename,
        content: `<div class="b3-dialog__content"><input class="b3-text-field fn__block" value="${labelName}"></div>
<div class="b3-dialog__action">
    <button class="b3-button b3-button--cancel">${window.siyuan.languages.cancel}</button><div class="fn__space"></div>
    <button class="b3-button b3-button--text">${window.siyuan.languages.confirm}</button>
</div>`,
        width: "520px",
    });
    const btnsElement = dialog.element.querySelectorAll(".b3-button");
    btnsElement[0].addEventListener("click", () => {
        dialog.destroy();
    });
    const inputElement = dialog.element.querySelector("input");
    dialog.bindInput(inputElement, () => {
        (btnsElement[1] as HTMLButtonElement).click();
    });
    inputElement.focus();
    inputElement.select();
    btnsElement[1].addEventListener("click", () => {
        fetchPost("/api/tag/renameTag", {oldLabel: labelName, newLabel: inputElement.value});
    });
}

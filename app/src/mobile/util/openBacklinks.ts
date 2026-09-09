import {Constants} from "../../constants";
import {fetchPost} from "../../util/fetch";
import {isEncryptedBox} from "../../util/pathName";
import {Tree} from "../../util/Tree";
import {openMobileFileById} from "../editor";
import {activeBlur} from "./keyboardToolbar";

export const openMobileBacklinks = (protyle: IProtyle, blockId: string) => {
    activeBlur();
    const menu = window.siyuan.menus.menu;
    menu.remove();
    const element = document.createElement("div");
    const titleElement = document.createElement("div");
    titleElement.className = "b3-menu__item b3-menu__item--readonly";
    titleElement.textContent = window.siyuan.languages.backlinks;
    const listElement = document.createElement("div");
    element.append(titleElement, listElement);
    menu.append(element);
    menu.fullscreen("bottom");
    const param: IObject = {id: blockId, beforeLen: 10, k: "", mk: "", includeMentions: false};
    if (isEncryptedBox(protyle.notebookId)) {
        param.notebook = protyle.notebookId;
    }
    fetchPost("/api/ref/getBacklink", param, response => {
        if (!element.isConnected || menu.element.classList.contains("fn__none")) {
            return;
        }
        const tree = new Tree({
            element: listElement,
            data: response.data.backlinks,
            click(target) {
                menu.remove();
                openMobileFileById(protyle.app, target.getAttribute("data-node-id"),
                    [Constants.CB_GET_HL, Constants.CB_GET_CONTEXT, Constants.CB_GET_ROOTSCROLL]);
            }
        });
        tree.expandAll();
    });
};

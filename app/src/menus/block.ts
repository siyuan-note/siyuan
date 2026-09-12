import {MenuItem} from "./Menu";
import {openInputDialog} from "../dialog/inputDialog";
import {fetchPost} from "../util/fetch";
import {Constants} from "../constants";

export const transferBlockRef = (id: string) => {
    window.siyuan.menus.menu.append(new MenuItem({
        id: "transferBlockRef",
        label: window.siyuan.languages.transferBlockRef,
        icon: "iconScrollHoriz",
        click() {
            const renameDialog = openInputDialog({
                title: window.siyuan.languages.transferBlockRef,
                value: "",
                placeholder: window.siyuan.languages.targetBlockID,
                description: window.siyuan.languages.transferBlockRefTip,
                onConfirm: (value, dialog) => {
                    fetchPost("/api/block/transferBlockRef", {
                        fromID: id,
                        toID: value,
                    });
                    dialog.destroy();
                },
            });
            renameDialog.element.setAttribute("data-key", Constants.DIALOG_TRANSFERBLOCKREF);
        }
    }).element);
};

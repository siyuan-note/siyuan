import {MenuItem} from "./Menu";
import {mobileInputDialog as openInputDialog} from "../dialog/mobileInputDialog";
import {fetchPost, fetchSyncPost} from "../util/fetch";
import {isMobile} from "../util/functions";
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
                awaitConfirm: true,
                onConfirm: async (value, dialog) => {
                    if (!isMobile()) {
                        fetchPost("/api/block/transferBlockRef", {fromID: id, toID: value});
                        dialog.destroy();
                        return true;
                    }
                    const response = await fetchSyncPost("/api/block/transferBlockRef", {
                        fromID: id,
                        toID: value,
                    });
                    if (response.code !== 0) return false;
                    dialog.destroy();
                    return true;
                },
            });
            renameDialog.element.setAttribute("data-key", Constants.DIALOG_TRANSFERBLOCKREF);
        }
    }).element);
};

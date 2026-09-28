import {movePathTo} from "../../../util/pathName";
import {fetchSyncPost} from "../../../util/fetch";
import {showMessage} from "../../../dialog/message";
import {transaction} from "../../wysiwyg/transaction";
import {getAVBindingOperations} from "./binding";

export const openAVBindDocument = (protyle: IProtyle, blockElement: HTMLElement, itemID: string) => {
    const canEdit = () => blockElement.isConnected && !protyle.disabled && !window.siyuan.isPublish &&
        !protyle.options.history?.created && !protyle.options.history?.snapshot;
    if (!itemID || !canEdit()) {
        return;
    }
    const avID = blockElement.dataset.avId;
    const blockID = blockElement.dataset.nodeId;
    const bind = async (nextID: string) => {
        // 确认选址后读取当前绑定，保留条目身份及可撤销的原绑定。
        const response = await fetchSyncPost("/api/av/getAttributeViewKeys", {id: itemID, avID, itemID});
        if (response.code !== 0 || !canEdit()) {
            return;
        }
        const table = response.data.find(item => item.avID === avID);
        const value = table?.keyValues.find(item => item.key.type === "block")?.values.find(item => item.blockID === itemID);
        if (!value || !value.isDetached && value.block?.id === nextID) {
            return;
        }
        const operations = getAVBindingOperations(avID, itemID, nextID, blockID, value, {protyleID: protyle.id});
        transaction(protyle, operations.doOperations, operations.undoOperations);
    };
    movePathTo({
        title: window.siyuan.languages.bindDocument,
        flashcard: false,
        validate(paths) {
            if (paths.length !== 1 || !paths[0].endsWith(".sy")) {
                showMessage(window.siyuan.languages.selectOneDocument);
                return false;
            }
            return true;
        },
        cb(paths) {
            const path = paths[0];
            void bind(path.substring(path.lastIndexOf("/") + 1, path.length - 3));
        },
    });
};

import {fetchSyncPost} from "../../../util/fetch";
import {transaction} from "../../wysiwyg/transaction";
import {getAVBindingOperations} from "./binding";

// 在绑定前为本次新建的文档设置条目图标，未设置图标时保留文档创建流程的默认值。
export const bindCreatedAVDocument = async (protyle: IProtyle, options: {
    avID: string;
    itemID: string;
    documentID: string;
    blockID: string;
    previousValue: IAVCellValue;
    isValid: () => boolean;
}) => {
    const canBind = () => options.isValid() && !protyle.disabled && !window.siyuan.config.readonly &&
        !window.siyuan.isPublish && !protyle.options.history?.created && !protyle.options.history?.snapshot;
    if (!canBind()) {
        return false;
    }
    const icon = options.previousValue.block?.icon;
    if (icon) {
        const response = await fetchSyncPost("/api/attr/setBlockAttrs", {id: options.documentID, attrs: {icon}});
        if (response.code !== 0 || !canBind()) {
            return false;
        }
    }
    const operations = getAVBindingOperations(options.avID, options.itemID, options.documentID,
        options.blockID, options.previousValue, {protyleID: protyle.id});
    transaction(protyle, operations.doOperations, operations.undoOperations);
    return true;
};

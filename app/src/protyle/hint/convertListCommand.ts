import {getListCommandType, getSlashListContext} from "./listCommands";
import {hasClosestBlock} from "../util/hasClosest";
import {removeListStructure, turnsOneInto, updateTransaction} from "../wysiwyg/transaction";
import {getUndoFocusContext} from "../util/selection";

export const convertListCommand = async (protyle: IProtyle, value: string, range: Range,
                                         undoContext?: Record<string, string>) => {
    const context = getSlashListContext(protyle, range);
    const type = context && getListCommandType(context.subtype, value);
    if (!type) {
        return;
    }
    const node = hasClosestBlock(range.startContainer);
    if (!node) {
        return;
    }
    const id = node.getAttribute("data-node-id");
    const html = node.outerHTML;
    range.deleteContents();
    range.insertNode(document.createElement("wbr"));
    if (type === "CancelList") {
        const focusContext = getUndoFocusContext(protyle.wysiwyg.element, range, true);
        // 先保存命令清理，再由内核读取完整列表并校验属性和数据库关联。
        updateTransaction(protyle, node, html, undoContext);
        await removeListStructure(protyle, [context.listElement], false, focusContext);
        return;
    }
    // 命令清理与列表转换共用一个事务，撤销同时恢复命令文本及原光标位置。
    await turnsOneInto({
        protyle,
        nodeElement: context.listElement,
        id: context.listElement.dataset.nodeId,
        type,
        undoElement: {id, html},
        undoContext,
    });
};

import {onTransaction} from "../wysiwyg/transaction";
import {preventScroll} from "../scroll/preventScroll";
import {Constants} from "../../constants";
import {hideElements} from "../ui/hideElements";
import {scrollCenter} from "../../util/highlightById";
import {matchHotKey} from "../util/hotKey";
import {fetchSyncPost} from "../../util/fetch";
import {ipcRenderer} from "electron";
import {markMirror, refreshUndoButtons, requestRedo, requestUndo} from "./globalUndo";

// 撤销权威栈已下沉到 kernel（GlobalUndoLog），前端按 rootID 共享。
// 本类仅保留发起窗口本地乐观应用的渲染逻辑（renderLocal，走 isUndo=true 分支，
// 保住光标恢复/折叠/zoom 兜底），以及按钮态刷新。
export class Undo {
    public undo(protyle: IProtyle) {
        if (protyle.disabled) {
            return;
        }
        // 转发到全局 Manager，由 kernel 弹栈 + 广播，发起窗口本地乐观应用
        requestUndo(protyle);
    }

    public redo(protyle: IProtyle) {
        if (protyle.disabled) {
            return;
        }
        requestRedo(protyle);
    }


    // 重放 insert 操作前检查块 ID 是否已被占用(例如剪切后粘贴到其他编辑器时保留了原 ID,
    // 此时撤销剪切会插入重复 ID 的块),冲突时在两个栈中统一替换为新 ID
    private async resolveDuplicateIds(operations: IOperation[]) {
        const ids = new Set<string>();
        operations.forEach(op => {
            if (op.action === "insert" && typeof op.data === "string") {
                if (op.id) {
                    ids.add(op.id);
                }
                op.data.match(/data-node-id="[^"]+"/g)?.forEach((match: string) => {
                    ids.add(match.substring(14, match.length - 1));
                });
            }
        });
        if (ids.size === 0) {
            return;
        }
        let existResponse: IWebSocketData;
        try {
            existResponse = await fetchSyncPost("/api/block/checkBlocksExist", {ids: Array.from(ids)});
        } catch (e) {
            return;
        }
        if (!existResponse?.data) {
            return;
        }
        const replacements: [string, string][] = [];
        ids.forEach(id => {
            if (existResponse.data[id] === true) {
                replacements.push([id, Lute.NewNodeID()]);
            }
        });
        if (replacements.length === 0) {
            return;
        }
        [this.undoStack, this.redoStack].forEach(stack => {
            stack.forEach(item => {
                [item.doOperations, item.undoOperations].forEach(ops => {
                    ops.forEach(op => {
                        replacements.forEach(([oldId, newId]) => {
                            if (op.id === oldId) {
                                op.id = newId;
                            }
                            if (op.parentID === oldId) {
                                op.parentID = newId;
                            }
                            if (op.previousID === oldId) {
                                op.previousID = newId;
                            }
                            if (op.nextID === oldId) {
                                op.nextID = newId;
                            }
                            if (typeof op.data === "string") {
                                op.data = op.data.split(`data-node-id="${oldId}"`).join(`data-node-id="${newId}"`);
                            }
                        });
                    });
                });
            });
        });
    }

    private async render(protyle: IProtyle, state: IOperations, redo: boolean) {
        hideElements(["hint", "gutter"], protyle);
        protyle.wysiwyg.lastHTMLs = {};
        await this.resolveDuplicateIds(redo ? state.doOperations : state.undoOperations);
        if (!redo) {
            for (let i = state.undoOperations.length - 1; i >= 0; i--) {
                if (state.undoOperations[i].action === "insert") {
                    if (state.undoOperations[i].context) {
                        state.undoOperations[i].context.setRange = "true";
                    } else {
                        state.undoOperations[i].context = {setRange: "true"};
                    }
                    break;
                }
            }
            onTransaction(protyle, state.undoOperations, true);
            transaction(protyle, state.undoOperations, undefined, {skipSync: true});
        } else {
            for (let i = state.doOperations.length - 1; i >= 0; i--) {
                if (state.doOperations[i].action === "insert") {
                    if (state.doOperations[i].context) {
                        state.doOperations[i].context.setRange = "true";
                    } else {
                        state.doOperations[i].context = {setRange: "true"};
                    }
                    break;

    // renderLocal 仅在发起窗口本地应用操作（isUndo=true），不 POST 到 kernel
    // （kernel 的 undo/redo 接口已执行事务并广播）。保留光标恢复/折叠/zoom/lastHTMLs 行为。
    public renderLocal(protyle: IProtyle, operations: IOperation[], isRedo: boolean) {
        hideElements(["hint", "gutter"], protyle);
        protyle.wysiwyg.lastHTMLs = {};
        for (let i = operations.length - 1; i >= 0; i--) {
            if (operations[i].action === "insert") {
                if (operations[i].context) {
                    operations[i].context.setRange = "true";
                } else {
                    operations[i].context = {setRange: "true"};

                }
                break;
            }
        }
        onTransaction(protyle, operations, true);
        document.querySelector(".av__panel")?.remove();
        preventScroll(protyle);
        scrollCenter(protyle);
    }

    // add 降级为：不压栈（kernel 已在 commit 后 Record），仅置位本地镜像 + 刷新按钮态。
    // 保留签名以兼容 transaction.ts 的调用点。
    public add(doOperations: IOperation[], undoOperations: IOperation[], protyle: IProtyle) {
        if (protyle.block?.rootID) {
            markMirror(protyle.block.rootID, {canUndo: true});
        }
        refreshUndoButtons(protyle);
    }

    public clear() {
        // kernel 全局栈不随前端编辑器销毁/重载而清空（跨窗口共享）。
        // 本地仅刷新按钮态，镜像条目保留供重开校准。
    }
}

export const electronUndo = (event: KeyboardEvent) => {
    /// #if !BROWSER
    if (matchHotKey(window.siyuan.config.keymap.editor.general.undo.custom, event)) {
        ipcRenderer.send(Constants.SIYUAN_CMD, "undo");
        event.preventDefault();
        event.stopPropagation();
        return true;
    }
    if (matchHotKey(window.siyuan.config.keymap.editor.general.redo.custom, event)) {
        ipcRenderer.send(Constants.SIYUAN_CMD, "redo");
        event.preventDefault();
        event.stopPropagation();
        return true;
    }
    /// #endif
    return false;
};

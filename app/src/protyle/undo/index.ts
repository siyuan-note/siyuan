import {onTransaction} from "../wysiwyg/transaction";
import {preventScroll} from "../scroll/preventScroll";
import {Constants} from "../../constants";
import {hideElements} from "../ui/hideElements";
import {matchHotKey} from "../util/hotKey";
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

    // renderLocal 仅在发起窗口本地应用操作（isUndo=true），不 POST 到 kernel
    // （kernel 的 undo/redo 接口已执行事务并广播）。保留光标恢复/折叠/zoom/lastHTMLs 行为。
    public renderLocal(protyle: IProtyle, operations: IOperation[]) {
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
        // 同步 toolbar range，避免 undo/redo 替换 DOM 后 range 变为 detached，
        // 导致后续异步操作（如 F3 创建子文档）读到无效 range 而报错 https://github.com/siyuan-note/siyuan/issues/17896
        if (getSelection().rangeCount > 0) {
            protyle.toolbar.range = getSelection().getRangeAt(0);
        }
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

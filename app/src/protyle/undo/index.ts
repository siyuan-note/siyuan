import {onTransaction, transaction} from "../wysiwyg/transaction";
import {preventScroll} from "../scroll/preventScroll";
import {Constants} from "../../constants";
import {hideElements} from "../ui/hideElements";
import {matchHotKey} from "../util/hotKey";
import {restoreUndoFocus} from "../util/selection";
import {ipcRenderer} from "electron";
import {markMirror, refreshUndoButtons, requestRedo, requestUndo} from "./globalUndo";
import {scrollCenter} from "../../util/highlightById";

// 撤销/重做统一契约：kernel 模式由 Undo 实现（转发 kernel），lite 模式由 LocalUndo 实现（前端操作日志）。
export interface IUndo {
    undo(protyle: IProtyle): void;

    redo(protyle: IProtyle): void;

    add(doOperations: IOperation[], undoOperations: IOperation[], protyle: IProtyle): void;

    clear(): void;

    // kernel 模式独有：发起窗口本地乐观应用操作（lite 模式的 LocalUndo 不需要）。
    renderLocal?(protyle: IProtyle, operations: IOperation[]): void;
}

interface IOperations {
    doOperations: IOperation[];
    undoOperations: IOperation[];
}

const syncToolbarRange = (protyle: IProtyle) => {
    if (getSelection().rangeCount > 0) {
        protyle.toolbar.range = getSelection().getRangeAt(0);
    }
};

// 撤销权威栈已下沉到 kernel（GlobalUndoLog），前端按 rootID 共享。
// 本类仅保留发起窗口本地乐观应用的渲染逻辑（renderLocal，走 isUndo=true 分支，
// 保住光标恢复/折叠/zoom 兜底），以及按钮态刷新。
export class Undo implements IUndo {
    public undo(protyle: IProtyle) {
        if (protyle.disabled) {
            return;
        }
        protyle.wysiwyg.flushPendingInput();
        // 转发到全局 Manager，由 kernel 弹栈 + 广播，发起窗口本地乐观应用
        requestUndo(protyle);
    }

    public redo(protyle: IProtyle) {
        if (protyle.disabled) {
            return;
        }
        protyle.wysiwyg.flushPendingInput();
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
        if (restoreUndoFocus(protyle, operations)) {
            scrollCenter(protyle);
        }
        document.querySelector(".av__panel")?.remove();
        preventScroll(protyle);
        // 同步 toolbar range，避免 undo/redo 替换 DOM 后 range 变为 detached，
        // 导致后续异步操作（如 F3 创建子文档）读到无效 range 而报错 https://github.com/siyuan-note/siyuan/issues/17896
        syncToolbarRange(protyle);
    }

    // add 降级为：不压栈（kernel 已在 commit 后 Record），仅置位本地镜像 + 刷新按钮态。
    // 保留签名以兼容 transaction.ts 的调用点。
    public add(doOperations: IOperation[], undoOperations: IOperation[], protyle: IProtyle) {
        if (protyle.block?.rootID) {
            markMirror(protyle.block.rootID, {canUndo: true, canRedo: false});
        }
        refreshUndoButtons(protyle);
    }

    public clear() {
        // kernel 全局栈不随前端编辑器销毁/重载而清空（跨窗口共享）。
        // 本地仅刷新按钮态，镜像条目保留供重开校准。
    }
}

// lite 模式的前端撤销：不落盘、无 rootID，无法用 kernel 的 GlobalUndoLog，
// 故在前端以 IOperation 操作日志维护撤销/重做。回放时用 onTransaction(ops, true) 本地应用 DOM。
export class LocalUndo implements IUndo {
    private hasUndo = false;
    public redoStack: IOperations[];
    public undoStack: IOperations[];

    constructor() {
        this.redoStack = [];
        this.undoStack = [];
    }

    public undo(protyle: IProtyle) {
        if (protyle.disabled) {
            return;
        }
        protyle.wysiwyg.flushPendingInput();
        if (this.undoStack.length === 0) {
            return;
        }
        const state = this.undoStack.pop();
        this.render(protyle, state, false);
        this.hasUndo = true;
        this.redoStack.push(state);
        if (protyle.breadcrumb) {
            const undoElement = protyle.breadcrumb.element.parentElement.querySelector('[data-type="undo"]');
            if (undoElement) {
                if (this.undoStack.length === 0) {
                    undoElement.setAttribute("disabled", "true");
                }
                protyle.breadcrumb.element.parentElement.querySelector('[data-type="redo"]').removeAttribute("disabled");
            }
        }
    }

    public redo(protyle: IProtyle) {
        if (protyle.disabled) {
            return;
        }
        protyle.wysiwyg.flushPendingInput();
        if (this.redoStack.length === 0) {
            return;
        }
        const state = this.redoStack.pop();
        this.render(protyle, state, true);
        this.undoStack.push(state);
        if (protyle.breadcrumb) {
            const redoElement = protyle.breadcrumb.element.parentElement.querySelector('[data-type="redo"]');
            if (redoElement) {
                protyle.breadcrumb.element.parentElement.querySelector('[data-type="undo"]').removeAttribute("disabled");
                if (this.redoStack.length === 0) {
                    redoElement.setAttribute("disabled", "true");
                }
            }
        }
    }

    private render(protyle: IProtyle, state: IOperations, redo: boolean) {
        hideElements(["hint", "gutter"], protyle);
        protyle.wysiwyg.lastHTMLs = {};
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
            restoreUndoFocus(protyle, state.undoOperations);
        } else {
            for (let i = state.doOperations.length - 1; i >= 0; i--) {
                if (state.doOperations[i].action === "insert") {
                    if (state.doOperations[i].context) {
                        state.doOperations[i].context.setRange = "true";
                    } else {
                        state.doOperations[i].context = {setRange: "true"};
                    }
                    break;
                }
            }
            onTransaction(protyle, state.doOperations, true);
            transaction(protyle, state.doOperations, undefined, {skipSync: true});
        }
        syncToolbarRange(protyle);
        document.querySelector(".av__panel")?.remove();
        preventScroll(protyle);
        scrollCenter(protyle);
    }

    public replace(doOperations: IOperation[], protyle: IProtyle) {
        // undo 引发 replace 导致 stack 错误 https://github.com/siyuan-note/siyuan/issues/9178
        if (this.hasUndo && this.redoStack.length > 0) {
            this.undoStack.push(this.redoStack.pop());
            this.redoStack = [];
            this.hasUndo = false;
            if (protyle.breadcrumb) {
                const redoElement = protyle.breadcrumb.element.parentElement.querySelector('[data-type="redo"]');
                if (redoElement) {
                    redoElement.setAttribute("disabled", "true");
                }
            }
        }
        if (this.undoStack.length > 0) {
            this.undoStack[this.undoStack.length - 1].doOperations = doOperations;
        }
    }

    public add(doOperations: IOperation[], undoOperations: IOperation[], protyle: IProtyle) {
        this.undoStack.push({undoOperations, doOperations});
        if (this.undoStack.length > Constants.SIZE_UNDO) {
            this.undoStack.shift();
        }
        if (this.hasUndo) {
            this.redoStack = [];
            this.hasUndo = false;
        }
        if (protyle.breadcrumb) {
            const undoElement = protyle.breadcrumb.element.parentElement.querySelector('[data-type="undo"]');
            if (undoElement) {
                undoElement.removeAttribute("disabled");
            }
        }
    }

    public clear() {
        this.undoStack = [];
        this.redoStack = [];
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

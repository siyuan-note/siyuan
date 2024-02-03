import {onTransaction, transaction} from "../wysiwyg/transaction";
import {preventScroll} from "../scroll/preventScroll";
import {Constants} from "../../constants";
import {hideElements} from "../ui/hideElements";
import {scrollCenter} from "../../util/highlightById";
import {matchHotKey} from "../util/hotKey";
import {ipcRenderer} from "electron";

interface IOperations {
    doOperations: IOperation[],
    undoOperations: IOperation[]
}

export class Undo {
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
            state.undoOperations.forEach(item => {
                onTransaction(protyle, item, true);
            });
            transaction(protyle, state.undoOperations);
        } else {
            state.doOperations.forEach(item => {
                onTransaction(protyle, item, true);
            });
            transaction(protyle, state.doOperations);
        }
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

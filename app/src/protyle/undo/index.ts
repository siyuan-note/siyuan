import {onTransaction, transaction} from "../wysiwyg/transaction";
import {preventScroll} from "../scroll/preventScroll";
import {Constants} from "../../constants";
import {hideElements} from "../ui/hideElements";
import {scrollCenter} from "../../util/highlightById";
import {matchHotKey} from "../util/hotKey";
import {fetchSyncPost} from "../../util/fetch";
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
                }
            }
            onTransaction(protyle, state.doOperations, true);
            transaction(protyle, state.doOperations, undefined, {skipSync: true});
        }
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

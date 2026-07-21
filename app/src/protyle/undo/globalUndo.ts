import {Constants} from "../../constants";
import {fetchPost} from "../../util/fetch";
import {confirmDialog} from "../../dialog/confirmDialog";
import {showMessage} from "../../dialog/message";
import {waitForPendingTransactions} from "../util/transactionQueue";
/// #if !MOBILE
import {getActiveTab} from "../../layout/tabUtil";
/// #endif
/// #if MOBILE
import {getCurrentEditor} from "../../mobile/editor";
/// #endif

// 本地镜像：按 rootID 缓存 {canUndo, canRedo}，按钮态零 fetch 读取。
// 在编辑（add 落点）、撤销/重做响应、WS 广播（context.undoState）时更新。
interface IUndoStateMirror {
    canUndo: boolean;
    canRedo: boolean;
}

const undoStateMirror = new Map<string, IUndoStateMirror>();
let isUndoing = false; // 防重入：撤销/重做进行中忽略后续触发

export const markMirror = (rootID: string, state: Partial<IUndoStateMirror>) => {
    const cur = undoStateMirror.get(rootID) || {canUndo: false, canRedo: false};
    undoStateMirror.set(rootID, {...cur, ...state});
};

export const getMirror = (rootID: string): IUndoStateMirror => {
    return undoStateMirror.get(rootID) || {canUndo: false, canRedo: false};
};

// 从 WS 广播 context.undoState 批量更新镜像（多窗口/多端同步）
export const syncMirrorFromBroadcast = (undoState: { [rootID: string]: { canUndo: boolean; canRedo: boolean } }) => {
    if (!undoState) {
        return;
    }
    Object.entries(undoState).forEach(([rootID, state]) => {
        undoStateMirror.set(rootID, {canUndo: !!state.canUndo, canRedo: !!state.canRedo});
    });
};

// 文档打开时主动初始化镜像（低频，不在 selectionchange 热路径）
export const initMirror = (rootID: string) => {
    if (!rootID) {
        return;
    }
    fetchPost("/api/transactions/undoState", {rootID}, (response) => {
        const data = response.data;
        if (data) {
            undoStateMirror.set(rootID, {canUndo: !!data.canUndo, canRedo: !!data.canRedo});
        }
    });
};

// 刷新指定 protyle 的撤销/重做按钮态（读镜像，零 fetch）
export const refreshUndoButtons = (protyle: IProtyle) => {
    if (!protyle.block?.rootID) {
        return;
    }
    const state = getMirror(protyle.block.rootID);
    if (protyle.breadcrumb) {
        const parent = protyle.breadcrumb.element.parentElement;
        const undoElement = parent.querySelector('[data-type="undo"]') as HTMLElement;
        const redoElement = parent.querySelector('[data-type="redo"]') as HTMLElement;
        if (undoElement) {
            if (state.canUndo) {
                undoElement.removeAttribute("disabled");
            } else {
                undoElement.setAttribute("disabled", "disabled");
            }
        }
        if (redoElement) {
            if (state.canRedo) {
                redoElement.removeAttribute("disabled");
            } else {
                redoElement.setAttribute("disabled", "disabled");
            }
        }
    }
};

export const getActiveProtyle = (): IProtyle => {
    /// #if MOBILE
    const editor = getCurrentEditor();
    return editor?.protyle;
    /// #else
    const activeTab = getActiveTab();
    const model = activeTab?.model;
    if (model && (model as any).editor?.protyle) {
        return (model as any).editor.protyle;
    }
    // 兜底：搜索/反链/自定义编辑器中聚焦的那个
    /// #if !MOBILE
    const allProtyle = (window as any).siyuan?.blockPanels || [];
    for (const panel of allProtyle) {
        if (panel.element && document.activeElement && panel.element.contains(document.activeElement)) {
            return panel.editor?.protyle;
        }
    }
    /// #endif
    return undefined;
    /// #endif
};

// 解析 rootID 列表为文档名，用于跨文档撤销确认提示
const resolveRootNames = async (rootIDs: string[]): Promise<string[]> => {
    const names: string[] = [];
    for (const id of rootIDs) {
        await new Promise<void>((resolve) => {
            fetchPost("/api/filetree/getHPathByID", {id}, (response: IWebSocketData) => {
                if (response.code === 0 && response.data) {
                    names.push(response.data as string);
                } else {
                    names.push(id);
                }
                resolve();
            });
        });
    }
    return names;
};

const focusRootIDs = (rootIDs: string[], focusBlockId?: string) => {
    // 只滚动发起窗口的焦点 protyle 到变更块；其它文档不强制重开（撤销物理结果在发起文档）
    const protyle = getActiveProtyle();
    if (protyle && rootIDs.includes(protyle.block?.rootID) && focusBlockId) {
        const target = protyle.wysiwyg.element.querySelector(`[data-node-id="${focusBlockId}"]`);
        if (target) {
            const rect = target.getBoundingClientRect();
            // 仅在变更块不在视口内时才滚动，避免打断用户当前的滚动位置
            if (rect.bottom < 0 || rect.top > window.innerHeight) {
                target.scrollIntoView({behavior: "smooth", block: "center"});
            }
        }
    }
};

// 请求撤销：读镜像判可撤销 → 跨文档提示 → 调 kernel undo → 本地乐观应用 + 更新镜像
export const requestUndo = async (protyle: IProtyle) => {
    if (!protyle || isUndoing) {
        return;
    }
    const rootID = protyle.block?.rootID;
    if (!rootID) {
        return;
    }

    const state = getMirror(rootID);
    if (!state.canUndo) {
        return; // 语义 B：栈空不做事
    }

    // 尽早置锁，阻止确认对话框期间触发新的撤销/重做（含 peek 与确认阶段）
    isUndoing = true;
    await waitForPendingTransactions(protyle);

    // 跨文档提示（标准①）：先 peek 栈顶的 mutatedRootIDs
    let peekMutatedRootIDs: string[] = [];
    await new Promise<void>((resolve) => {
        fetchPost("/api/transactions/undoState", {rootID}, (response) => {
            if (response.data?.peekMutatedRootIDs) {
                peekMutatedRootIDs = response.data.peekMutatedRootIDs;
            }
            resolve();
        });
    });

    if (peekMutatedRootIDs.length > 1) {
        const names = await resolveRootNames(peekMutatedRootIDs);
        // 确认期间拦截当前编辑器的键盘输入（遮罩只挡鼠标点击，不挡键盘冒泡）
        const blockInput = (e: Event) => {
            e.stopImmediatePropagation();
            e.preventDefault();
        };
        protyle.wysiwyg.element.addEventListener("keydown", blockInput, true);
        protyle.wysiwyg.element.addEventListener("beforeinput", blockInput, true);
        const confirmed = await new Promise<boolean>((resolve) => {
            confirmDialog(`⚠️ ${window.siyuan.languages.undo}`,
                `${window.siyuan.languages.undoCrossDocConfirm}<div style="margin-top: 8px;">${names.map(n => `• ${n}`).join("<br>")}</div>`,
                () => resolve(true),
                () => resolve(false));
        });
        protyle.wysiwyg.element.removeEventListener("keydown", blockInput, true);
        protyle.wysiwyg.element.removeEventListener("beforeinput", blockInput, true);
        if (!confirmed) {
            isUndoing = false; // 拒绝，复位锁，栈与镜像不动
            return;
        }
    }

    fetchPost("/api/transactions/undo", {
        rootID,
        app: Constants.SIYUAN_APPID,
        session: protyle.id,
    }, (response) => {
        isUndoing = false;
        const data = response.data;
        if (!data) {
            return;
        }
        if (data.failed) {
            // 撤销执行失败：kernel 已 Unpop 栈，镜像不动，提示用户
            if (data.msg) {
                showMessage(data.msg);
            }
            return;
        }
        if (!data.undoOperations || data.undoOperations.length === 0) {
            // 栈空或无可撤销
            markMirror(rootID, {canUndo: !!data.canUndo, canRedo: !!data.canRedo});
            refreshUndoButtons(protyle);
            return;
        }
        markMirror(rootID, {canUndo: !!data.canUndo, canRedo: !!data.canRedo});
        const mutatedRootIDs: string[] = data.mutatedRootIDs || [];
        if (mutatedRootIDs.length > 1) {
            // 跨文档撤销：doOperations 的锚点分散在多个文档，当前 protyle 无法本地乐观应用。
            // 改为靠 kernel 广播（含发起方）刷新所有涉及文档的 DOM。
            // 这里不调 renderLocal，避免在错误 protyle 上应用跨文档 move 导致前后端不一致。
            refreshUndoButtons(protyle);
            // 广播会到达当前窗口（/undo 对跨文档用 PushModeBroadcast），触发 onTransaction 刷新 DOM
        } else {
            // 单文档撤销：发起窗口本地乐观应用 doOperations（kernel 实际执行的操作，如 insert 恢复块）
            protyle.undo.renderLocal(protyle, data.doOperations);
            refreshUndoButtons(protyle);
            const focusBlockId = data.doOperations?.find((op: IOperation) => op.id)?.id;
            focusRootIDs(mutatedRootIDs, focusBlockId);
        }
    });
};

// 请求重做：对称，redo 不提示（其逆已在 undo 中确认）
export const requestRedo = async (protyle: IProtyle) => {
    if (!protyle || isUndoing) {
        return;
    }
    const rootID = protyle.block?.rootID;
    if (!rootID) {
        return;
    }

    const state = getMirror(rootID);
    if (!state.canRedo) {
        return;
    }

    isUndoing = true;
    await waitForPendingTransactions(protyle);
    fetchPost("/api/transactions/redo", {
        rootID,
        app: Constants.SIYUAN_APPID,
        session: protyle.id,
    }, (response) => {
        isUndoing = false;
        const data = response.data;
        if (!data) {
            return;
        }
        if (data.failed) {
            // 重做执行失败：kernel 已回滚栈，镜像不动，提示用户
            if (data.msg) {
                showMessage(data.msg);
            }
            return;
        }
        if (!data.doOperations || data.doOperations.length === 0) {
            markMirror(rootID, {canUndo: !!data.canUndo, canRedo: !!data.canRedo});
            refreshUndoButtons(protyle);
            return;
        }
        markMirror(rootID, {canUndo: !!data.canUndo, canRedo: !!data.canRedo});
        const mutatedRootIDs: string[] = data.mutatedRootIDs || [];
        if (mutatedRootIDs.length > 1) {
            // 跨文档重做：锚点分散在多个文档，靠 kernel 广播（含发起方）刷新
            refreshUndoButtons(protyle);
        } else {
            protyle.undo.renderLocal(protyle, data.doOperations);
            refreshUndoButtons(protyle);
            const focusBlockId = data.doOperations?.find((op: IOperation) => op.id)?.id;
            focusRootIDs(mutatedRootIDs, focusBlockId);
        }
    });
};

import {confirmDialog} from "../dialog/confirmDialog";
import {showMessage} from "../dialog/message";
import {progressLoading} from "../dialog/progress";
import {waitForPendingTransactions} from "../protyle/util/transactionQueue";
import {fetchSyncPost} from "./fetch";

export interface IBlockRefCheckOptions {
    scope: "blocks" | "documents" | "notebook";
    ids?: string[];
    exactIDs?: string[];
    deletedIDs?: string[];
    paths?: string[];
    notebook?: string;
}

interface IBlockRefCheckBatch {
    controller: AbortController;
    cancelled: Promise<undefined>;
    progressTimeout: number;
    pending: number;
    previousFocus?: HTMLElement;
}

const pendingChecks = new WeakSet<IProtyle>();
let activeBatch: IBlockRefCheckBatch | undefined;
const progressID = "checkBlockRefProgress";

const startCheckBatch = (): IBlockRefCheckBatch => {
    const controller = new AbortController();
    const batch: IBlockRefCheckBatch = {
        controller,
        cancelled: new Promise(resolve => {
            controller.signal.addEventListener("abort", () => resolve(undefined), {once: true});
        }),
        progressTimeout: 0,
        pending: 0,
    };
    // 检查持续一段时间后再显示遮罩，避免快速删除或剪切时闪屏。
    batch.progressTimeout = window.setTimeout(() => {
        if (document.activeElement instanceof HTMLElement) {
            batch.previousFocus = document.activeElement;
        }
        progressLoading({code: 1, msg: window.siyuan.languages.checkBlockRefProgress}, progressID, {
            label: window.siyuan.languages.cancel,
            callback: () => controller.abort(),
        });
    }, 300);
    return batch;
};

const requestBlockRefCheck = async (options: IBlockRefCheckOptions, protyle: IProtyle | undefined, signal: AbortSignal) => {
    if (protyle) {
        await waitForPendingTransactions(protyle);
    }
    if (signal.aborted) {
        return;
    }
    // 请求错误由检查流程统一提示。
    return fetchSyncPost("/api/block/checkBlockRef", options, undefined, false, signal);
};

export const checkBlockRef = async (options: IBlockRefCheckOptions, protyle?: IProtyle) => {
    if (window.siyuan.config.editor.checkBlockRef === false) {
        return false;
    }
    const batch = activeBatch ??= startCheckBatch();
    const {signal} = batch.controller;
    batch.pending++;
    try {
        // 取消检查时立即结束等待，已排队的编辑仍由事务队列提交。
        const response = await Promise.race([requestBlockRefCheck(options, protyle, signal), batch.cancelled]);
        if (!response || signal.aborted) {
            return;
        }
        if (response.code !== 0) {
            // 检查失败时给出内核原因（例如加密笔记本已锁定）；字段校验类报错属于调用方参数问题，不打扰用户
            if (response.msg && !response.msg.startsWith("Field [")) {
                showMessage(response.msg, 6000, "error");
            }
            return;
        }
        return response.data === true;
    } catch (error) {
        if (!signal.aborted) {
            console.warn("Check block ref failed:", error);
            showMessage(error instanceof Error ? error.message : String(error), 7000, "error");
        }
    } finally {
        batch.pending--;
        if (batch.pending === 0) {
            activeBatch = undefined;
            window.clearTimeout(batch.progressTimeout);
            const restoreFocus = batch.previousFocus?.isConnected &&
                document.getElementById(progressID)?.contains(document.activeElement);
            progressLoading({code: 2, msg: ""}, progressID);
            if (restoreFocus) {
                batch.previousFocus.focus({preventScroll: true});
            }
        }
    }
};

export const confirmBlockRef = async (options: IBlockRefCheckOptions, protyle?: IProtyle) => {
    if (protyle?.lite) {
        return true;
    }
    if (protyle && pendingChecks.has(protyle)) {
        return false;
    }
    if (protyle) {
        pendingChecks.add(protyle);
    }
    try {
        const hasRef = await checkBlockRef(options, protyle);
        if (hasRef === undefined) {
            return false;
        }
        if (!hasRef) {
            return true;
        }
        return await new Promise<boolean>((resolve) => {
            confirmDialog({
                title: window.siyuan.languages.deleteOpConfirm,
                text: window.siyuan.languages.deleteRefConfirm,
                confirm: () => resolve(true),
                cancel: () => resolve(false),
                isDelete: true,
            });
        });
    } finally {
        if (protyle) {
            pendingChecks.delete(protyle);
        }
    }
};

export const getBlockRefWarningHTML = () => {
    return `<div class="fn__hr"></div>
<div class="ft__smaller ft__on-surface">${window.siyuan.languages.deleteRefConfirm}</div>`;
};

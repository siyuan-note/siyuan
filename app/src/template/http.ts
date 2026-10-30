import {Constants} from "../constants";
import {genUUID} from "../util/genID";
import {fetchWithAppId} from "../util/fetchWithAppId";
import type {Dialog} from "../dialog";
import type {TemplateHTTPCancelRequestInput, TemplateHTTPReplyRequestInput} from "../types/api";

interface HTTPExecution {
    id: string;
    app: string;
    session: string;
    controller: AbortController;
    owners?: Element[];
    isCurrent: () => boolean;
    confirmation?: string;
    confirmations: Set<string>;
    networkDone?: boolean;
    dialog?: Dialog;
    cleanup: () => void;
}

const executions = new Map<string, HTTPExecution>();
const signalValidity = new WeakMap<AbortSignal, () => boolean>();
const signalOwners = new WeakMap<AbortSignal, Element>();
let watchingPage = false;

const sendControl = (...[url, data]: ["/api/template/respondHTTP", TemplateHTTPReplyRequestInput] |
    ["/api/template/cancelHTTP", TemplateHTTPCancelRequestInput]) => {
    // 控制请求直接走传输层，避免为确认和终止动作创建新的模板执行。
    void fetchWithAppId(url, {method: "POST", body: JSON.stringify(data), keepalive: true}).catch(() => {});
};

const closeConfirmation = (execution: HTTPExecution) => {
    execution.confirmation = undefined;
    const dialog = execution.dialog;
    execution.dialog = undefined;
    dialog?.destroy();
};

const cleanExecutionUI = (execution: HTTPExecution) => {
    closeConfirmation(execution);
    const {hideMessage}: typeof import("../dialog/message") = require("../dialog/message");
    hideMessage(`template-http-${execution.id}`);
};

export const cancelTemplateHTTPExecutions = () => {
    executions.forEach(execution => execution.controller.abort());
};

export const cancelTemplateHTTPForElement = (element: Element) => {
    executions.forEach(execution => {
        if (execution.owners?.includes(element)) {
            execution.controller.abort();
        }
    });
};

// 仅在待处理请求期间检查宿主，关闭预览、切换文档或回收数据库时终止内核等待。
export const guardTemplateHTTPRequest = (isCurrent: () => boolean, owner?: Element) => {
    const controller = new AbortController();
    signalValidity.set(controller.signal, isCurrent);
    if (owner) {
        signalOwners.set(controller.signal, owner);
    }
    const timer = setInterval(() => {
        if (!isCurrent()) {
            controller.abort();
            clearInterval(timer);
        }
    }, 200);
    return {signal: controller.signal, cancel: () => controller.abort(), dispose: () => {
        clearInterval(timer);
        signalValidity.delete(controller.signal);
        signalOwners.delete(controller.signal);
    }};
};

export const beginTemplateHTTPRequest = (url: string, data: {id?: string; blockID?: string},
                                         headers?: Record<string, string>, signal?: AbortSignal) => {
    if (!["/api/template/render", "/api/av/renderAttributeView", "/api/filetree/createDailyNote"].includes(url) ||
        window.siyuan.isPublish || signal?.aborted) {
        return undefined;
    }
    const socket = window.siyuan.ws?.ws;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
        return undefined;
    }
    const socketURL = new URL(socket.url);
    const session = socketURL.searchParams.get("id");
    if (!session || socketURL.searchParams.get("type") !== "main") {
        return undefined;
    }
    const controller = new AbortController();
    const id = genUUID();
    let ownerGuard: ReturnType<typeof guardTemplateHTTPRequest>;
    let owners: Element[];
    if (url === "/api/av/renderAttributeView") {
        const selector = data.blockID ? `[data-node-id="${CSS.escape(data.blockID)}"]` :
            `[data-av-id="${CSS.escape(data.id || "")}"]`;
        const owner = signalOwners.get(signal);
        owners = owner ? [owner] : Array.from(document.querySelectorAll(selector));
        // 没有实际界面载体的计算请求使用无交互路径。
        if (!owners.length) {
            return undefined;
        }
        ownerGuard = guardTemplateHTTPRequest(() => owners.some(owner => owner.isConnected && !owner.closest(".fn__none")));
    }
    const abort = () => controller.abort();
    signal?.addEventListener("abort", abort, {once: true});
    ownerGuard?.signal.addEventListener("abort", abort, {once: true});
    let finished = false;
    const execution: HTTPExecution = {
        id, app: Constants.SIYUAN_APPID, session, controller, owners, confirmations: new Set(),
        isCurrent: () => !signal?.aborted && (signalValidity.get(signal)?.() ?? true) &&
            (!owners || owners.some(owner => owner.isConnected && !owner.closest(".fn__none"))),
        cleanup: () => {
            if (finished) {
                return;
            }
            finished = true;
            signal?.removeEventListener("abort", abort);
            ownerGuard?.signal.removeEventListener("abort", abort);
            controller.signal.removeEventListener("abort", abortExecution);
            ownerGuard?.dispose();
            executions.delete(id);
            cleanExecutionUI(execution);
        },
    };
    executions.set(id, execution);
    const abortExecution = () => {
        sendControl("/api/template/cancelHTTP", {executionID: id, app: execution.app, session});
        execution.cleanup();
    };
    controller.signal.addEventListener("abort", abortExecution, {once: true});
    if (!watchingPage) {
        watchingPage = true;
        window.addEventListener("pagehide", cancelTemplateHTTPExecutions);
    }
    return {
        signal: controller.signal,
        headers: {...headers, "X-Siyuan-Template-Execution": id,
            "X-Siyuan-Template-App": execution.app, "X-Siyuan-Template-Session": session},
        isCurrent: () => {
            if (!execution.isCurrent()) {
                controller.abort();
            }
            return !controller.signal.aborted;
        },
        finish: execution.cleanup,
    };
};

interface HTTPEvent {
    executionID: string;
    confirmID?: string;
    method?: string;
    url?: string;
    headerNames?: string[];
    state?: "waiting" | "requesting" | "done" | "error";
    errorCode?: string;
}

export const processTemplateHTTPEvent = (cmd: string, data: HTTPEvent) => {
    const execution = executions.get(data?.executionID);
    if (!execution || execution.networkDone || execution.controller.signal.aborted) {
        return;
    }
    if (!execution.isCurrent()) {
        execution.controller.abort();
        return;
    }
    const {showMessage}: typeof import("../dialog/message") = require("../dialog/message");
    const lang = window.siyuan.languages;
    if (cmd === "templateHTTPStatus") {
        if (data.state === "done") {
            execution.networkDone = true;
            cleanExecutionUI(execution);
        } else if (data.state === "error") {
            cleanExecutionUI(execution);
            const errorKey = data.errorCode === "denied" ? "templateHTTPDenied" :
                ["confirmation_timeout", "timeout"].includes(data.errorCode) ? "templateHTTPTimeout" :
                    ["budget_exceeded", "response_too_large", "redirect_limit"].includes(data.errorCode) ? "templateHTTPLimit" :
                        ["invalid_target", "unsafe_target", "invalid_options"].includes(data.errorCode) ? "templateHTTPInvalid" :
                            data.errorCode === "interaction_required" ? "templateHTTPPermission" : "templateHTTPFailed";
            if (data.errorCode !== "execution_ended") {
                showMessage(lang[errorKey], 7000, "error", `template-http-error-${execution.id}`);
            }
        } else if (data.state === "waiting" || data.state === "requesting") {
            showMessage(data.state === "waiting" ? lang.templateHTTPWaiting : lang.templateHTTPRequesting,
                0, "info", `template-http-${execution.id}`);
        }
        return;
    }
    if (!data.confirmID || execution.confirmations.has(data.confirmID)) {
        return;
    }
    execution.confirmations.add(data.confirmID);
    closeConfirmation(execution);
    execution.confirmation = data.confirmID;
    const respond = (approved: boolean) => {
        if (!execution.isCurrent()) {
            execution.controller.abort();
            return;
        }
        if (executions.get(execution.id) !== execution || execution.confirmation !== data.confirmID ||
            execution.controller.signal.aborted) {
            return;
        }
        execution.confirmation = undefined;
        execution.dialog = undefined;
        sendControl("/api/template/respondHTTP", {executionID: execution.id, confirmID: data.confirmID,
            approved, app: execution.app, session: execution.session});
    };
    const escape = (value: string) => value.replace(/[&<>"']/g, character =>
        ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"})[character]);
    const {confirmDialog}: typeof import("../dialog/confirmDialog") = require("../dialog/confirmDialog");
    execution.dialog = confirmDialog(lang.templateHTTPConfirm,
        `${escape(lang.templateHTTPWarning)}<br><br><code>${escape(data.method || "GET")} ${escape(data.url || "")}</code>` +
        (data.headerNames?.length ? `<br><code>${escape(data.headerNames.join(", "))}</code>` : ""),
        () => respond(true), () => respond(false));
};

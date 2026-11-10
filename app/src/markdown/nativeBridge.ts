import type {MarkdownAppearance, MarkdownBootstrap, MarkdownBridge, MarkdownCommand, MarkdownPreferences} from "./bridge";
import {createMarkdownInstanceId} from "./identity";

interface NativeReply {
    id: string;
    result?: unknown;
    error?: unknown;
}

interface NativeEnvironment {
    siyuanMarkdown?: MarkdownBridge;
    siyuanMarkdownNative?: {postMessage(message: string): void; onmessage?: (event: {data: string}) => void};
    webkit?: {messageHandlers?: {siyuanMarkdown?: {postMessage(message: unknown): void}}};
    __siyuanMarkdownResponse?: (reply: NativeReply) => void;
    __siyuanMarkdownCommand?: (command: MarkdownCommand) => void;
}

// 原生宿主负责检查页面来源、主 frame 和授权句柄；页面只封装确定的操作集合。
export const createNativeMarkdownBridge = (target: NativeEnvironment | Window): MarkdownBridge | undefined => {
    const environment = target as NativeEnvironment;
    if (environment.siyuanMarkdown) return environment.siyuanMarkdown;
    const android = environment.siyuanMarkdownNative;
    const ios = environment.webkit?.messageHandlers?.siyuanMarkdown;
    if (!android && !ios) return;
    const instanceId = createMarkdownInstanceId();
    let sequence = 0;
    const pending = new Map<string, {resolve(value: unknown): void; reject(error: Error): void; timer?: ReturnType<typeof setTimeout>}>();
    const listeners = new Set<(command: MarkdownCommand) => void>();
    const earlyCommands: MarkdownCommand[] = [];
    let preferences: MarkdownPreferences;
    let supportsFonts = false;
    let supportsWorkspaceAppearance = false;
    const appearance = (): MarkdownAppearance => {
        const independent = {theme: preferences.theme ?? "system", fontSize: preferences.fontSize ?? 16,
            fonts: preferences.fonts ?? {global: [], editor: [], code: []}};
        return {...independent, independent, sources: {theme: "independent", fontSize: "independent", fonts: "independent"},
            workspaces: [], customFonts: []};
    };
    const receive = (reply: NativeReply) => {
        if (!reply || typeof reply.id !== "string") return;
        const task = pending.get(reply.id);
        if (!task) return;
        pending.delete(reply.id);
        clearTimeout(task.timer);
        if (reply.error !== undefined && reply.error !== null) {
            // Native hosts may return a structured failure. Never acknowledge a
            // failed draft/transaction as a successful void response.
            task.reject(new Error(typeof reply.error === "string" ? reply.error : "Markdown host request failed"));
        } else task.resolve(reply.result);
    };
    const command = (value: MarkdownCommand) => {
        if (!value || typeof value.id !== "string" ||
            !["close", "prepare-quit", "cancel-quit", "external-change", "theme", "background", "tree-change", "keymap"].includes(value.type)) return;
        if (!listeners.size) {
            // 退出可在离线编辑器初始化完成前到达；初始化完成后仍必须回执。
            if (earlyCommands.length < 32) earlyCommands.push(value);
            return;
        }
        listeners.forEach(listener => listener(value));
    };
    environment.__siyuanMarkdownResponse = receive;
    environment.__siyuanMarkdownCommand = command;
    if (android) android.onmessage = event => {
        try {
            const message = JSON.parse(event.data);
            if (message.type === "reply") receive(message);
            if (message.type === "command") command(message.command);
        } catch { /* 非协议消息不能影响正在等待的文件事务。 */ }
    };
    const invoke = <T>(action: string, payload?: unknown): Promise<T> => new Promise((resolve, reject) => {
        const id = `${instanceId}:${++sequence}`;
        // 只读枚举、初始化快照与幂等绑定确认设超时；普通文件写入仍须等待宿主给出明确结果。
        const timeout = action === "tree-commit-open" ? 5000 : ["bootstrap", "system-fonts"].includes(action) ? 30000 : 0;
        const timer = timeout ? setTimeout(() => {
            if (pending.delete(id)) reject(new Error("Markdown host acknowledgement timed out"));
        }, timeout) : undefined;
        pending.set(id, {resolve, reject, timer});
        try {
            const request = {id, action, payload};
            if (android) android.postMessage(JSON.stringify(request));
            else ios.postMessage(request);
        } catch (error) {
            pending.delete(id);
            clearTimeout(timer);
            reject(error);
        }
    });
    const bridge: MarkdownBridge = {
        tree: {
            state: () => invoke("tree-state"),
            list: request => invoke("tree-list", request),
            chooseRoot: () => invoke("tree-choose-root"),
            saveView: request => invoke("tree-save-view", request),
            prepareOpen: request => invoke("tree-prepare-open", request),
            commitOpen: ticket => invoke("tree-commit-open", ticket),
            cancelOpen: ticket => invoke("tree-cancel-open", ticket),
        },
        host: {
            read: request => invoke("host:read", request),
            write: request => invoke("host:write", request),
            reconcileWrite: request => invoke("host:reconcileWrite", request),
            reserveSaveAs: request => invoke("host:reserveSaveAs", request),
            prepareSaveAs: request => invoke("host:prepareSaveAs", request),
            commitSaveAs: request => invoke("host:commitSaveAs", request),
            releaseSaveAs: request => invoke("host:releaseSaveAs", request),
            putDraft: request => invoke("host:putDraft", request),
            clearDraft: request => invoke("host:clearDraft", request),
            releaseSession: request => invoke("host:releaseSession", request),
        },
        bootstrap: async () => {
            const bootstrap = await invoke<MarkdownBootstrap>("bootstrap");
            const workspaceAppearance = bootstrap.capabilities?.workspaceAppearance === true;
            if (workspaceAppearance && !bootstrap.appearance) throw new Error("Workspace appearance unavailable");
            preferences = bootstrap.preferences;
            supportsFonts = bootstrap.capabilities?.systemFonts === true;
            supportsWorkspaceAppearance = workspaceAppearance;
            if (supportsWorkspaceAppearance) return bootstrap;
            return supportsFonts ? {...bootstrap, appearance: appearance()} : bootstrap;
        },
        newDocument: () => invoke("new"),
        openDocument: () => invoke("open"),
        chooseSaveAs: format => invoke("save-as", format),
        cancelSaveAs: handle => invoke("cancel-save-as", handle),
        authorizeResources: () => invoke("authorize-resources"),
        insertImage: () => invoke("insert-image"),
        resolveResource: reference => invoke("resource", reference),
        openLink: url => invoke("link", url),
        preferences: async patch => {
            preferences = await invoke("preferences", patch);
            return preferences;
        },
        systemFonts: () => supportsFonts ? invoke("system-fonts") : Promise.reject(new Error("System fonts unavailable")),
        appearance: async patch => {
            if (supportsWorkspaceAppearance) return invoke("appearance", patch ?? null);
            if (!supportsFonts) throw new Error("Independent appearance unavailable");
            if (patch?.sources && Object.values(patch.sources).some(source => source !== "independent")) {
                throw new Error("Workspace appearance unavailable");
            }
            if (patch?.independent) preferences = await invoke("preferences", patch.independent);
            return appearance();
        },
        confirm: action => invoke("confirm", action),
        confirmClose: () => invoke("confirm-close"),
        recoveries: () => invoke("recoveries"),
        recover: id => invoke("recover", id),
        discardRecovery: id => invoke("discard-recovery", id),
        state: state => invoke("state", state),
        respond: (id, accepted) => invoke("response", {id, accepted}),
        onCommand(listener) {
            listeners.add(listener);
            earlyCommands.splice(0).forEach(listener);
            return () => { listeners.delete(listener); };
        },
    };
    Object.freeze(bridge.host);
    Object.freeze(bridge.tree);
    environment.siyuanMarkdown = Object.freeze(bridge);
    return environment.siyuanMarkdown;
};

import {AV_MAP_PROTOCOL_VERSION, AVMapTheme, isAVMapIdentifier, isAVMapRevision} from "./protocol";

interface DesktopMapUnplacedIPC {
    invoke: (channel: string, value: unknown) => Promise<unknown>;
    send: (channel: string, value: unknown) => void;
    on: (channel: string, callback: (event: unknown, value: unknown) => void) => unknown;
    removeListener: (channel: string, callback: (event: unknown, value: unknown) => void) => unknown;
}

export interface DesktopMapUnplacedState {
    requestID: number;
    query: string;
    rows: Array<{id: string; title: string}>;
    total: number;
    page: number;
    loading: boolean;
    error: boolean;
    labels: {title: string; search: string; empty: string; loading: string; more: string;
        previous: string; retry: string; close: string};
}

export interface DesktopMapUnplacedAction {
    action: "editing" | "search" | "more" | "previous" | "retry" | "select";
    requestID: number;
    query?: string;
    page?: number;
    id?: string;
}

export interface DesktopMapUnplacedHandle {
    update: (state: DesktopMapUnplacedState) => void;
    close: () => void;
}

interface DesktopMapUnplacedHost {
    ipc: DesktopMapUnplacedIPC;
    envelope: () => {version: 1; instanceID: string};
    available: () => boolean;
    theme: () => AVMapTheme;
}

interface Registration extends DesktopMapUnplacedHost { close?: () => void; }
const hosts = new WeakMap<HTMLElement, Registration>();
const CHANNEL = "siyuan-map-unplaced-";
const isSession = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{48}$/.test(value);
const failures = new Set(["operation-failed", "document-mismatch", "renderer-failed", "ready-timeout", "load-failed", "setup-failed", "resource-failed"]);

export const registerDesktopMapUnplacedHost = (canvas: HTMLElement, host: DesktopMapUnplacedHost) => {
    hosts.get(canvas)?.close?.();
    const registration: Registration = {...host};
    hosts.set(canvas, registration);
    return () => {
        registration.close?.();
        if (hosts.get(canvas) === registration) hosts.delete(canvas);
    };
};

// 完整记录与数据库上下文始终留在 owner；独立菜单只收到当前页的 ID 和纯文本标题。
export const openDesktopMapUnplaced = (canvas: HTMLElement, anchor: HTMLElement,
                                      initial: DesktopMapUnplacedState,
                                      onAction: (action: DesktopMapUnplacedAction) => void,
                                      onClose: (failed: boolean) => void, available: () => boolean): DesktopMapUnplacedHandle | undefined => {
    const host = hosts.get(canvas);
    const scope = anchor.ownerDocument?.defaultView;
    if (!host?.available() || !scope || !available()) return;
    host.close?.();
    const envelope = host.envelope();
    let closed = false, sessionID = "", revision = 0, latestRequestID = initial.requestID;
    let frame = 0, timeout = 0, lastAnchor = "", lastTheme = "";
    let state = initial;
    const pendingClosed = new Map<string, {restore: boolean; failed: boolean}>();
    const active = () => !closed && hosts.get(canvas) === host && host.available() && available() &&
        canvas.isConnected && anchor.isConnected && !anchor.ownerDocument.hidden;
    const theme = () => ({mode: host.theme(),
        fontSize: Math.max(12, Math.min(32, Math.round(Number.parseFloat(
            scope.getComputedStyle(anchor.ownerDocument.documentElement).getPropertyValue("--b3-font-size")) || 14)))});
    const wireState = () => ({...state, revision, theme: theme(),
        rows: state.rows.map(row => ({id: row.id, title: row.title})), labels: {...state.labels}});
    const position = () => {
        if (!active()) return;
        const rect = anchor.getBoundingClientRect();
        let left = Math.max(0, rect.left), top = Math.max(0, rect.top);
        let right = Math.min(scope.innerWidth, rect.right), bottom = Math.min(scope.innerHeight, rect.bottom);
        if (right <= left || bottom <= top) return;
        // 裁剪祖先变化后，按钮不能在滚动区域外继续成为原生菜单的锚点。
        for (let parent = anchor; parent; parent = parent.parentElement) {
            const style = scope.getComputedStyle(parent);
            if (style.display === "none" || style.visibility !== "visible" || Number.parseFloat(style.opacity) === 0 ||
                style.getPropertyValue?.("content-visibility") === "hidden") return;
            if (/(auto|scroll|hidden|clip)/.test(style.overflowX + " " + style.overflowY)) {
                const bounds = parent.getBoundingClientRect();
                if (/(auto|scroll|hidden|clip)/.test(style.overflowX)) {
                    left = Math.max(left, bounds.left);
                    right = Math.min(right, bounds.right);
                }
                if (/(auto|scroll|hidden|clip)/.test(style.overflowY)) {
                    top = Math.max(top, bounds.top);
                    bottom = Math.min(bottom, bounds.bottom);
                }
            }
        }
        if (right <= left || bottom <= top || left > rect.left || top > rect.top || right < rect.right || bottom < rect.bottom) return;
        const hit = anchor.ownerDocument.elementFromPoint((left + right) / 2, (top + bottom) / 2);
        if (!hit || !anchor.contains(hit)) return;
        return {x: left, y: top, width: right - left, height: bottom - top};
    };
    const send = (type: string, value: Record<string, unknown> = {}) => {
        if (sessionID) host.ipc.send(CHANNEL + type, {...envelope, sessionID, ...value});
    };
    const finish = (restore = false, failed = false) => {
        if (closed) return;
        closed = true;
        scope.clearTimeout(timeout);
        scope.cancelAnimationFrame(frame);
        scope.removeEventListener("scroll", geometry, true);
        scope.removeEventListener("resize", geometry);
        scope.removeEventListener("pagehide", close);
        anchor.ownerDocument.removeEventListener("pointerdown", outside, true);
        anchor.ownerDocument.removeEventListener("keydown", keydown, true);
        anchor.ownerDocument.removeEventListener("visibilitychange", geometry);
        host.ipc.removeListener(CHANNEL + "reply", reply);
        if (host.close === close) host.close = undefined;
        state = {...state, rows: []};
        pendingClosed.clear();
        onClose(failed);
        if (restore && anchor.isConnected && available()) anchor.focus();
    };
    const close = () => {
        send("close", {reason: "anchor-hidden"});
        finish();
    };
    const fail = () => {
        send("close", {reason: "anchor-hidden"});
        finish(false, true);
    };
    const geometry = () => {
        if (closed) return;
        const next = position();
        if (!next) { close(); return; }
        const key = JSON.stringify(next);
        if (key !== lastAnchor) {
            lastAnchor = key;
            send("anchor", {anchor: next});
        }
    };
    const outside = (event: PointerEvent) => {
        if (!anchor.contains(event.target as Node)) {
            send("close", {reason: "outside"});
            finish();
        }
    };
    const keydown = (event: KeyboardEvent) => {
        if (event.key === "Escape") {
            event.preventDefault();
            send("close", {reason: "button"});
            finish(true);
        }
    };
    const reply = (_event: unknown, value: unknown) => {
        const input = value as Record<string, unknown>;
        if (closed || !input || input.version !== AV_MAP_PROTOCOL_VERSION || input.instanceID !== envelope.instanceID) return;
        if (!sessionID && input.type === "closed" && isSession(input.sessionID) && pendingClosed.size < 4) {
            pendingClosed.set(input.sessionID, {restore: input.restore === true, failed: failures.has(input.reason as string)});
            return;
        }
        if (input.sessionID !== sessionID || !sessionID) return;
        if (input.type === "closed") { finish(input.restore === true, failures.has(input.reason as string)); return; }
        if (!active()) { close(); return; }
        if (input.type !== "action" || !isAVMapRevision(input.revision) || input.revision > revision || !isAVMapRevision(input.requestID)) return;
        if (input.action === "select") {
            if (input.revision !== revision || input.requestID !== latestRequestID || state.loading || state.error || !isAVMapIdentifier(input.id) ||
                !state.rows.some(row => row.id === input.id)) return;
            onAction({action: "select", requestID: input.requestID, id: input.id});
            finish();
            return;
        }
        if (!["editing", "search", "more", "previous", "retry"].includes(input.action as string) ||
            input.requestID <= latestRequestID) return;
        // 主进程已按其接受的版本校验意图；交错到达的 API 回包不能阻止新搜索取消旧请求。
        // 只有编辑和翻页可跨越尚未被主进程接受的数据版本，选择始终严格匹配当前版本与成员。
        if (input.action !== "editing" && (typeof input.query !== "string" || input.query.length > 256 ||
            input.query.includes("\0") || !isAVMapRevision(input.page) || input.page < 1)) return;
        latestRequestID = input.requestID;
        onAction({action: input.action as DesktopMapUnplacedAction["action"], requestID: input.requestID,
            query: input.query as string, page: input.page as number});
    };
    const tick = () => {
        geometry();
        if (closed) return;
        const nextTheme = JSON.stringify(theme());
        if (nextTheme !== lastTheme) {
            lastTheme = nextTheme;
            send("theme", {theme: theme()});
        }
        frame = scope.requestAnimationFrame(tick);
    };
    const firstAnchor = position();
    if (!firstAnchor) return;
    lastAnchor = JSON.stringify(firstAnchor);
    lastTheme = JSON.stringify(theme());
    host.close = close;
    host.ipc.on(CHANNEL + "reply", reply);
    scope.addEventListener("scroll", geometry, true);
    scope.addEventListener("resize", geometry);
    scope.addEventListener("pagehide", close);
    anchor.ownerDocument.addEventListener("pointerdown", outside, true);
    anchor.ownerDocument.addEventListener("keydown", keydown, true);
    anchor.ownerDocument.addEventListener("visibilitychange", geometry);
    timeout = scope.setTimeout(fail, 8000);
    frame = scope.requestAnimationFrame(tick);
    void host.ipc.invoke(CHANNEL + "open", {...envelope, state: wireState(), anchor: firstAnchor}).then(value => {
        const result = value as {version?: unknown; instanceID?: unknown; sessionID?: unknown};
        if (result?.version !== AV_MAP_PROTOCOL_VERSION || result.instanceID !== envelope.instanceID || !isSession(result.sessionID)) {
            fail();
            return;
        }
        sessionID = result.sessionID;
        if (closed || !active()) {
            send("close", {reason: "anchor-hidden"});
            finish();
            return;
        }
        const ended = pendingClosed.get(sessionID);
        if (ended) { finish(ended.restore, ended.failed); return; }
        pendingClosed.clear();
        scope.clearTimeout(timeout);
        if (revision > 0) send("update", {state: wireState()});
        send("theme", {theme: theme()});
        lastAnchor = "";
        geometry();
    }).catch(fail);
    return {update: next => {
        if (!active()) { close(); return; }
        state = next;
        revision++;
        send("update", {state: wireState()});
    }, close};
};

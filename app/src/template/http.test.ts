import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";

const loadHTTP = () => {
    const requests: Array<{url: string; data: Record<string, unknown>}> = [];
    const messages: unknown[][] = [];
    const hidden: string[] = [];
    const dialogs: Array<{text: string; approve: () => void; reject: () => void; always?: () => void; destroyed: boolean}> = [];
    const timers = new Set<() => void>();
    const listeners = new Map<string, () => void>();
    const owner = {isConnected: true, closest: (): Element => null};
    const siyuan = {isPublish: false, ws: {ws: {url: "ws://localhost/ws?app=app&id=main-session&type=main", readyState: 1}},
        languages: {templateHTTPConfirm: "HTTP?", templateHTTPWarning: "Warning", templateHTTPTemplateWarning: "Multiple targets", templateHTTPWaiting: "Waiting",
            templateHTTPRequesting: "Requesting", templateHTTPTimeout: "Timed out", templateHTTPFailed: "Failed"}};
    let id = 0;
    let invalidations = 0;
    const exports: Record<string, (...args: any[]) => any> = {};
    runInNewContext(transpileModule(readFileSync("src/template/http.ts", "utf8"), {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2022},
    }).outputText, {
        exports, URL, AbortController, WebSocket: {OPEN: 1}, CSS: {escape: (value: string) => value},
        document: {querySelectorAll: () => [owner]},
        window: {siyuan, addEventListener: (name: string, callback: () => void) => listeners.set(name, callback)},
        setInterval: (callback: () => void) => {timers.add(callback); return callback;},
        clearInterval: (callback: () => void) => timers.delete(callback),
        require: (name: string) => {
            switch (name) {
                case "../constants": return {Constants: {SIYUAN_APPID: "app"}};
                case "./httpConfirmHandoff": return {clearTemplateHTTPConfirmations: () => {invalidations++;}};
                case "../util/genID": return {genUUID: () => `execution-${++id}`};
                case "../util/fetchWithAppId": return {fetchWithAppId: async (url: string, init: RequestInit) => {
                    requests.push({url, data: JSON.parse(init.body as string)});
                }};
                case "../dialog/message": return {
                    showMessage: (...args: unknown[]) => messages.push(args),
                    hideMessage: (value: string) => hidden.push(value),
                };
                case "../dialog/confirmDialog": return {confirmDialog: (_title: string, text: string,
                                                                          approve: () => void, reject: () => void, _delete: boolean,
                                                                          extra?: {callback: () => void}) => {
                    const dialog = {text, approve, reject, always: extra?.callback, destroyed: false};
                    dialogs.push(dialog);
                    return {element: {querySelector: (): Element => null}, destroy: () => {dialog.destroyed = true; reject();}};
                }};
                default: throw new Error(name);
            }
        },
    });
    const begin = (url = "/api/template/render", signal?: AbortSignal) =>
        exports.beginTemplateHTTPRequest(url, {id: "doc", blockID: "block"}, {custom: "header"}, signal);
    const event = (cmd: string, fields: Record<string, unknown> = {}) =>
        exports.processTemplateHTTPEvent(cmd, {executionID: "execution-1", ...fields});
    return {exports, begin, event, requests, messages, hidden, dialogs, timers, owner, siyuan, listeners,
        invalidations: () => invalidations};
};

test("template requests bind one execution to the exact main socket", () => {
    const state = loadHTTP();
    const request = state.begin();
    assert.equal(request.headers["X-Siyuan-Template-App"], "app");
    assert.equal(request.headers["X-Siyuan-Template-Session"], "main-session");
    assert.equal(request.headers.custom, "header");
    assert.equal(state.requests.length, 0);
    request.finish();
});

test("background, publish and disconnected requests do not opt into interaction", () => {
    const state = loadHTTP();
    assert.equal(state.begin("/api/template/renderSprig"), undefined);
    assert.equal(state.begin("/api/transactions"), undefined);
    state.siyuan.isPublish = true;
    assert.equal(state.begin(), undefined);
    state.siyuan.isPublish = false;
    state.siyuan.ws.ws.readyState = 3;
    assert.equal(state.begin(), undefined);
});

test("confirmation is escaped, scoped, and each confirmation can be answered only once", () => {
    const state = loadHTTP();
    const request = state.begin();
    state.event("templateHTTPConfirm", {confirmID: "first", method: "GET", url: "https://example.com/<script>?a=1&b=2",
        headerNames: ["<Authorization>"]});
    assert.equal(state.requests.length, 0);
    assert.match(state.dialogs[0].text, /&lt;script&gt;/);
    assert.match(state.dialogs[0].text, /&lt;Authorization&gt;/);
    state.dialogs[0].approve();
    state.dialogs[0].approve();
    state.dialogs[0].reject();
    state.event("templateHTTPConfirm", {confirmID: "first"});
    assert.equal(state.dialogs.length, 1);
    assert.equal(state.requests.length, 1);
    assert.deepEqual(state.requests[0], {url: "/api/template/respondHTTP", data: {
        executionID: "execution-1", confirmID: "first", approved: true, scope: "once", app: "app", session: "main-session",
    }});
    state.event("templateHTTPConfirm", {confirmID: "redirect", url: "https://other.example/"});
    assert.equal(state.dialogs.length, 2);
    state.dialogs[1].reject();
    assert.equal(state.requests[1].data.approved, false);
    request.finish();
});

test("obsolete and completed executions cannot reopen a confirmation", () => {
    const state = loadHTTP();
    const request = state.begin();
    state.event("templateHTTPConfirm", {executionID: "other", confirmID: "unknown"});
    assert.equal(state.dialogs.length, 0);
    state.event("templateHTTPConfirm", {confirmID: "pending"});
    state.event("templateHTTPStatus", {state: "done"});
    assert.equal(state.dialogs[0].destroyed, true);
    state.dialogs[0].approve();
    state.event("templateHTTPConfirm", {confirmID: "late"});
    assert.equal(state.dialogs.length, 1);
    assert.equal(state.requests.length, 0);
    request.finish();
});

test("execution status uses its own message and completion clears it", () => {
    const state = loadHTTP();
    state.begin();
    state.event("templateHTTPStatus", {state: "waiting"});
    state.event("templateHTTPStatus", {state: "requesting"});
    assert.equal(state.messages[0][0], "Waiting");
    assert.equal(state.messages[1][0], "Requesting");
    assert.equal(state.messages[1][3], "template-http-execution-1");
    state.event("templateHTTPStatus", {state: "done"});
    assert.ok(state.hidden.includes("template-http-execution-1"));
});

test("done clears progress but keeps the transport lifecycle until the HTTP response finishes", () => {
    const state = loadHTTP();
    const request = state.begin("/api/av/renderAttributeView");
    state.event("templateHTTPStatus", {state: "done"});
    assert.equal(state.timers.size, 1);
    state.owner.isConnected = false;
    [...state.timers].forEach(callback => callback());
    assert.equal(request.signal.aborted, true);
    assert.equal(state.timers.size, 0);
});

test("response-time validity closes the done-navigation-response race without waiting for a timer", () => {
    const state = loadHTTP();
    const request = state.begin("/api/av/renderAttributeView");
    state.event("templateHTTPStatus", {state: "done"});
    state.owner.isConnected = false;
    assert.equal(request.isCurrent(), false);
    assert.equal(request.signal.aborted, true);
    assert.equal(state.requests[0].url, "/api/template/cancelHTTP");
});

test("errors use translated categories and remain visible after progress is cleared", () => {
    const state = loadHTTP();
    const request = state.begin();
    state.event("templateHTTPStatus", {state: "error", errorCode: "timeout"});
    assert.equal(state.messages[0][0], "Timed out");
    assert.equal(state.messages[0][3], "template-http-error-execution-1");
    state.event("templateHTTPStatus", {state: "done"});
    request.finish();
    assert.equal(state.hidden.includes("template-http-error-execution-1"), false);
});

test("an owner removed immediately before approval cannot grant permission", () => {
    const state = loadHTTP();
    state.begin("/api/av/renderAttributeView");
    state.event("templateHTTPConfirm", {confirmID: "pending"});
    state.owner.isConnected = false;
    state.dialogs[0].approve();
    assert.equal(state.requests.length, 1);
    assert.equal(state.requests[0].url, "/api/template/cancelHTTP");
});

test("two editors rendering the same database retain independent request owners", () => {
    const state = loadHTTP();
    const other = {isConnected: true, closest: (): Element => null};
    const firstGuard = state.exports.guardTemplateHTTPRequest(() => true, state.owner);
    const secondGuard = state.exports.guardTemplateHTTPRequest(() => true, other);
    const first = state.begin("/api/av/renderAttributeView", firstGuard.signal);
    const second = state.begin("/api/av/renderAttributeView", secondGuard.signal);
    state.exports.cancelTemplateHTTPForElement(state.owner);
    assert.equal(first.signal.aborted, true);
    assert.equal(second.signal.aborted, false);
    assert.equal(second.isCurrent(), true);
    second.finish();
    firstGuard.dispose();
    secondGuard.dispose();
});

test("a completed fetch releases abort listeners and daily notes opt into the same execution protocol", () => {
    const state = loadHTTP();
    const controller = new AbortController();
    const request = state.begin("/api/filetree/createDailyNote", controller.signal);
    assert.equal(request.headers["X-Siyuan-Template-Execution"], "execution-1");
    request.finish();
    controller.abort();
    assert.equal(state.requests.length, 0);
});

test("unused preview grants are revoked with their captured window identity, without replaying rendering", () => {
    const state = loadHTTP();
    const owner = state.exports.getTemplateHTTPWindow();
    assert.equal(owner.app, "app");
    assert.equal(owner.session, "main-session");
    state.exports.revokeTemplateHTTPConfirmation("preview-token", owner);
    assert.deepEqual(state.requests, [{url: "/api/template/cancelHTTP", data: {
        executionID: "", httpConfirmToken: "preview-token", app: "app", session: "main-session",
    }}]);
    state.exports.cancelTemplateHTTPExecutions();
    assert.equal(state.invalidations(), 1);
});

test("preview signal abort terminates transport, closes confirmation, and ignores late replies", () => {
    const state = loadHTTP();
    const controller = new AbortController();
    const request = state.begin(undefined, controller.signal);
    state.event("templateHTTPConfirm", {confirmID: "pending"});
    controller.abort();
    assert.equal(request.signal.aborted, true);
    assert.equal(state.dialogs[0].destroyed, true);
    state.dialogs[0].approve();
    assert.equal(state.requests.length, 1);
    assert.equal(state.requests[0].url, "/api/template/cancelHTTP");
    request.finish();
});

for (const kind of ["disconnect", "pagehide", "owner-removed", "superseded"]) {
    test(`${kind} terminates pending database executions and releases lifecycle checks`, () => {
        const state = loadHTTP();
        const request = state.begin("/api/av/renderAttributeView");
        assert.equal(state.timers.size, 1);
        if (kind === "disconnect") state.exports.cancelTemplateHTTPExecutions();
        if (kind === "pagehide") state.listeners.get("pagehide")();
        if (kind === "superseded") state.exports.cancelTemplateHTTPForElement(state.owner);
        if (kind === "owner-removed") {
            state.owner.isConnected = false;
            [...state.timers].forEach(callback => callback());
        }
        assert.equal(request.signal.aborted, true);
        assert.equal(state.timers.size, 0);
        assert.equal(state.requests.length, 1);
        assert.equal(state.requests[0].url, "/api/template/cancelHTTP");
    });
}


test("persistent approval is explicit and only offered for kernel-verified sources", () => {
    const state = loadHTTP();
    const request = state.begin();
    state.event("templateHTTPConfirm", {confirmID: "unknown"});
    assert.equal(state.dialogs[0].always, undefined);
    state.event("templateHTTPConfirm", {confirmID: "saved", canPersist: true, sourceLabel: "<saved>"});
    assert.match(state.dialogs[1].text, /&lt;saved&gt;/);
    assert.match(state.dialogs[1].text, /Multiple targets/);
    state.dialogs[1].always();
    state.dialogs[1].approve();
    assert.equal(state.requests.filter(item => item.data.confirmID === "saved").length, 1);
    assert.equal(state.requests.at(-1).data.scope, "template");
    request.finish();
});

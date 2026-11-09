import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {createSourceFile, isClassDeclaration, isMethodDeclaration, ModuleKind, ScriptTarget, transpileModule} from "typescript";
import {withFetchTimeout} from "../util/fetchTimeout";

const viewVisibility: {getAVCurrentViewID?: (owner: unknown) => string} = {};
runInNewContext(transpileModule(readFileSync("src/protyle/render/av/viewVisibility.ts", "utf8"), {
    compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2022},
}).outputText, {exports: viewVisibility, require: () => ({Constants: {CUSTOM_SY_AV_VIEW: "custom-sy-av-view"}})});
const {getAVCurrentViewID} = viewVisibility;

const loadHTTP = () => {
    const requests: Array<{url: string; data: Record<string, unknown>}> = [];
    const messages: unknown[][] = [];
    const hidden: string[] = [];
    const dialogs: Array<{text: string; approve: () => void; reject: () => void; always?: () => void; destroyed: boolean}> = [];
    const timers = new Set<() => void>();
    const listeners = new Map<string, () => void>();
    const attributes = new Map([["data-av-id", "doc"], ["custom-sy-av-view", "first"]]);
    const owner = {isConnected: true, closest: (): Element => null,
        dataset: {nodeId: "block", avId: "doc"},
        getAttribute: (name: string) => attributes.get(name) ?? null,
        setAttribute: (name: string, value: string) => attributes.set(name, value),
        removeAttribute: (name: string) => attributes.delete(name),
        hasAttribute: (name: string) => attributes.has(name),
        querySelector: (): Element => null, querySelectorAll: (): Element[] => [],
    };
    const siyuan = {isPublish: false, ws: {ws: {url: "ws://localhost/ws?app=app&id=main-session&type=main", readyState: 1}},
        languages: {templateHTTPConfirm: "HTTP?", templateHTTPWarning: "Warning", templateHTTPTemplateWarning: "Multiple targets", templateHTTPWaiting: "Waiting",
            templateHTTPRequesting: "Requesting", templateHTTPTimeout: "Timed out", templateHTTPFailed: "Failed",
            templateHTTPUnsafeTarget: "Non-public address; check Fake-IP"}};
    let id = 0;
    const owners = [owner];
    let invalidations = 0;
    const exports: Record<string, (...args: any[]) => any> = {};
    runInNewContext(transpileModule(readFileSync("src/template/http.ts", "utf8"), {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2022},
    }).outputText, {
        exports, URL, AbortController, WebSocket: {OPEN: 1}, CSS: {escape: (value: string) => value},
        document: {querySelectorAll: () => owners},
        window: {siyuan, addEventListener: (name: string, callback: () => void) => listeners.set(name, callback)},
        setInterval: (callback: () => void) => {timers.add(callback); return callback;},
        clearInterval: (callback: () => void) => timers.delete(callback),
        require: (name: string) => {
            switch (name) {
                case "../constants": return {Constants: {SIYUAN_APPID: "app"}};
                case "../protyle/render/av/viewVisibility": return {getAVCurrentViewID};
                case "./httpConfirmHandoff": return {clearTemplateHTTPConfirmations: () => {invalidations++;}};
                case "../util/genID": return {genUUID: () => `execution-${++id}`};
                case "../util/fetchWithAppId": return {fetchWithAppId: async (url: string, init: RequestInit) => {
                    requests.push({url, data: JSON.parse(init.body as string)});
                }};
                case "../dialog/message": return {
                    showMessage: (...args: unknown[]) => messages.push(args),
                    hideMessage: (value: string) => hidden.push(value),
                };
                case "../dialog/mobileConfirmDialog": return {mobileConfirmDialog: (_title: string, text: string,
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
    return {exports, begin, event, requests, messages, hidden, dialogs, timers, owner, owners, siyuan, listeners,
        invalidations: () => invalidations};
};

const beginAVRender = (state: ReturnType<typeof loadHTTP>, options?: {preserveAVMetadata?: boolean}) => {
    const source = readFileSync("src/protyle/render/av/locate.ts", "utf8");
    const start = source.indexOf("export const beginAVRender =");
    const end = source.indexOf("export const isCurrentAVRender", start);
    assert.ok(start >= 0 && end > start);
    const exports: {beginAVRender?: (owner: unknown, options?: {preserveAVMetadata?: boolean}) => symbol} = {};
    runInNewContext(transpileModule(source.slice(start, end), {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2022},
    }).outputText, {
        exports,
        renderTokens: new WeakMap(),
        cancelTemplateHTTPForElement: state.exports.cancelTemplateHTTPForElement,
    });
    return exports.beginAVRender(state.owner, options);
};

const renderAV = (state: ReturnType<typeof loadHTTP>, renderer = "render.ts") => {
    const source = readFileSync(`src/protyle/render/av/${renderer}`, "utf8");
    const call = source.match(/beginAVRender\([^)]*\)/)?.[0];
    assert.ok(call);
    runInNewContext(call, {
        e: state.owner, options: {blockElement: state.owner},
        beginAVRender: (_owner: unknown, options?: {preserveAVMetadata?: boolean}) => beginAVRender(state, options),
    });
};

const loadViewActions = (state: ReturnType<typeof loadHTTP>) => {
    const exports: Record<string, (...args: any[]) => void> = {};
    const context = {
        exports, Constants: {CUSTOM_SY_AV_VIEW: "custom-sy-av-view", CB_GET_HISTORY: "history"},
        window: {siyuan: {isPublish: false}, setTimeout: () => 0}, clearTimeout() {},
        locateRequests: new WeakMap(), refreshTimeouts: {}, addingFocusTokens: new Map(),
        getAVElements: () => [state.owner], getAVViewPageSize: (): undefined => undefined,
        clearSubItemsViewportAnchor() {}, clearSelect() {}, setReadonlyAVView() {},
        getAVCurrentViewID, getAVVisibleViewIDs: () => ["first"], setAVVisibleViewIDs() {},
        beginAVRender: (_owner: unknown, options?: {preserveAVMetadata?: boolean}) => beginAVRender(state, options),
        avRender: () => renderAV(state),
        transaction: (protyle: unknown, operations: unknown[]) => exports.refreshAV(protyle, operations[0]),
    };
    const render = readFileSync("src/protyle/render/av/render.ts", "utf8");
    const action = readFileSync("src/protyle/render/av/action.ts", "utf8");
    const switchStart = action.indexOf("export const switchAVView =");
    const code = render.slice(render.indexOf("export const refreshAV =")) +
        action.slice(switchStart, action.indexOf("export const duplicateCompletely", switchStart));
    runInNewContext(transpileModule(code, {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2022},
    }).outputText, context);
    return exports;
};

const pendingMetadata = (state: ReturnType<typeof loadHTTP>) => {
    let resolve: (response: Response) => void;
    let callbacks = 0;
    const response = new Promise<Response>(done => {resolve = done;});
    const exports: {fetchPost?: (...args: any[]) => Promise<void>} = {};
    runInNewContext(transpileModule(readFileSync("src/util/fetch.ts", "utf8"), {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2022},
    }).outputText, {
        exports, FormData, location: {port: "6806"}, window: {siyuan: state.siyuan}, console,
        require: (name: string) => {
            switch (name) {
                case "../template/http": return state.exports;
                case "./fetchWithAppId": return {fetchWithAppId: () => response};
                case "./fetchTimeout": return {withFetchTimeout};
                case "../config/setting/pending": return {trackSettingRequest: (_url: string, task: unknown) => task};
                case "../protyle/util/editorSave": return {trackEditorSaveRequest: (_url: string, _data: unknown, task: unknown) => task};
                case "./processMessage": return {processMessage: () => true};
                case "./kernelFault": return {kernelError: () => assert.fail("Unexpected kernel error")};
                case "../dialog/message": return {showMessage: () => assert.fail("Unexpected save error")};
                case "../constants": return {Constants: {}};
                case "electron": return {};
                default: throw new Error(name);
            }
        },
    });
    const request = exports.fetchPost("/api/av/renderAttributeView", {
        id: "doc", blockID: "block", ignoreRows: true,
    }, () => {callbacks++;});
    return {finish: async () => {
        resolve(new Response(JSON.stringify({code: 0, msg: "", data: {viewID: "first"}}), {
            headers: {"Content-Type": "application/json"},
        }));
        await request;
        return callbacks;
    }};
};

for (const mode of ["transaction", "readonly", "history"]) {
    test(`${mode} view switching drops a late metadata callback from the previous view`, async () => {
        const state = loadHTTP();
        const pending = pendingMetadata(state);
        loadViewActions(state).switchAVView({id: "editor", disabled: mode === "readonly",
            options: {action: mode === "history" ? ["history"] : []}}, state.owner, {dataset: {id: "second"}});
        assert.equal(state.owner.getAttribute("custom-sy-av-view"), "second");
        assert.equal(await pending.finish(), 0);
        assert.equal(state.timers.size, 0);
    });
}

for (const action of ["addAttrViewView", "duplicateAttrViewView", "removeAttrViewView", "sortAttrViewView"]) {
    test(`${action} invalidates pending metadata before the replacement view renders`, async () => {
        const state = loadHTTP();
        const pending = pendingMetadata(state);
        loadViewActions(state).refreshAV({id: "editor"}, {action, avID: "doc", blockID: "block", id: "second"});
        assert.equal(state.owner.getAttribute("custom-sy-av-view"), "first");
        assert.equal(await pending.finish(), 0);
        assert.equal(state.timers.size, 0);
    });
}

test("same-view refresh still delivers the pending metadata callback", async () => {
    const state = loadHTTP();
    const pending = pendingMetadata(state);
    renderAV(state);
    assert.equal(await pending.finish(), 1);
    assert.equal(state.timers.size, 0);
});

test("an unchanged mirror cannot keep another owner's obsolete metadata callback alive", async () => {
    const state = loadHTTP();
    state.owners.push({...state.owner, getAttribute: (name: string) =>
        name === "data-av-id" ? "doc" : name === "custom-sy-av-view" ? "first" : null});
    const pending = pendingMetadata(state);
    state.owner.setAttribute("custom-sy-av-view", "second");
    assert.equal(await pending.finish(), 0);
    assert.equal(state.requests.length, 1);
    assert.equal(state.timers.size, 0);
});

for (const identity of ["database", "header-view"]) {
    test(`metadata ${identity} identity changes are rejected before preservation`, () => {
        const state = loadHTTP();
        let headerView = "first";
        if (identity === "header-view") {
            state.owner.removeAttribute("custom-sy-av-view");
            state.owner.querySelector = () => ({getAttribute: () => headerView} as unknown as Element);
        }
        const request = state.exports.beginTemplateHTTPRequest("/api/av/renderAttributeView", {
            id: "doc", blockID: "block", ignoreRows: true,
        });
        if (identity === "database") state.owner.setAttribute("data-av-id", "other");
        else headerView = "second";
        renderAV(state);
        assert.equal(request.signal.aborted, true);
        assert.equal(state.timers.size, 0);
    });
}

for (const renderer of ["render.ts", "gallery/render.ts", "kanban/render.ts"]) {
    test(`${renderer} refresh preserves pending metadata panels but supersedes row rendering`, () => {
        const state = loadHTTP();
        const metadata = state.exports.beginTemplateHTTPRequest("/api/av/renderAttributeView", {
            id: "doc", blockID: "block", ignoreRows: true,
        });
        const rows = state.begin("/api/av/renderAttributeView");
        renderAV(state, renderer);
        assert.equal(metadata.signal.aborted, false);
        assert.equal(metadata.isCurrent(), true);
        assert.equal(rows.signal.aborted, true);
        assert.equal(state.requests.length, 1);
        assert.equal(state.requests[0].data.executionID, rows.headers["X-Siyuan-Template-Execution"]);
        metadata.finish();
        assert.equal(state.timers.size, 0);
    });
}

test("manual row batches survive their result rendering and retain source and view ownership", () => {
    const state = loadHTTP();
    const request = state.exports.beginTemplateHTTPRequest("/api/av/runAttributeViewAutomation", {blockID: "block", rows: true});
    renderAV(state);
    assert.equal(request.signal.aborted, false);
    state.owner.setAttribute("data-av-id", "another-database");
    assert.equal(request.isCurrent(), false);
    assert.equal(request.signal.aborted, true);
    assert.equal(state.timers.size, 0);
});

for (const kind of ["disconnect", "pagehide", "owner-removed", "explicit-cancel", "caller-abort"]) {
    test(`manual row batches preserved by rendering still cancel on ${kind}`, () => {
        const state = loadHTTP();
        const controller = new AbortController();
        const request = state.exports.beginTemplateHTTPRequest("/api/av/runAttributeViewAutomation", {
            blockID: "block", rows: true,
        }, undefined, controller.signal);
        renderAV(state);
        assert.equal(request.signal.aborted, false);
        if (kind === "disconnect") state.exports.cancelTemplateHTTPExecutions();
        if (kind === "pagehide") state.listeners.get("pagehide")();
        if (kind === "owner-removed") state.owner.isConnected = false;
        if (kind === "explicit-cancel") state.exports.cancelTemplateHTTPForElement(state.owner);
        if (kind === "caller-abort") controller.abort();
        assert.equal(request.isCurrent(), false);
        assert.equal(request.signal.aborted, true);
        assert.equal(state.timers.size, 0);
    });
}

test("only boolean metadata-only AV rendering survives row refresh", () => {
    for (const ignoreRows of [undefined, false, "true", 1]) {
        const state = loadHTTP();
        const request = state.exports.beginTemplateHTTPRequest("/api/av/renderAttributeView", {
            id: "doc", blockID: "block", ignoreRows,
        });
        renderAV(state);
        assert.equal(request.signal.aborted, true);
        assert.equal(state.timers.size, 0);
    }
    const state = loadHTTP();
    const guard = state.exports.guardTemplateHTTPRequest(() => true, state.owner);
    const keys = state.exports.beginTemplateHTTPRequest("/api/av/getAttributeViewKeys", {
        id: "doc", blockID: "block", ignoreRows: true,
    }, undefined, guard.signal);
    renderAV(state);
    assert.equal(keys.signal.aborted, true);
    guard.dispose();
    assert.equal(state.timers.size, 0);
});

for (const kind of ["disconnect", "pagehide", "owner-removed", "owner-hidden", "explicit-cancel", "caller-abort"]) {
    test(`metadata requests preserved by row refresh still cancel on ${kind}`, () => {
        const state = loadHTTP();
        const controller = new AbortController();
        const request = state.exports.beginTemplateHTTPRequest("/api/av/renderAttributeView", {
            id: "doc", blockID: "block", ignoreRows: true,
        }, undefined, controller.signal);
        renderAV(state);
        assert.equal(request.signal.aborted, false);
        if (kind === "disconnect") state.exports.cancelTemplateHTTPExecutions();
        if (kind === "pagehide") state.listeners.get("pagehide")();
        if (kind === "explicit-cancel") state.exports.cancelTemplateHTTPForElement(state.owner);
        if (kind === "caller-abort") controller.abort();
        if (kind === "owner-removed") state.owner.isConnected = false;
        if (kind === "owner-hidden") state.owner.closest = () => ({} as Element);
        assert.equal(request.isCurrent(), false);
        assert.equal(request.signal.aborted, true);
        assert.equal(state.timers.size, 0);
        assert.equal(state.requests.length, 1);
        assert.equal(state.requests[0].url, "/api/template/cancelHTTP");
    });
}

test("preserved metadata ownership is polled while no response arrives", () => {
    const state = loadHTTP();
    const request = state.exports.beginTemplateHTTPRequest("/api/av/renderAttributeView", {
        id: "doc", blockID: "block", ignoreRows: true,
    });
    renderAV(state);
    state.owner.isConnected = false;
    [...state.timers].forEach(callback => callback());
    assert.equal(request.signal.aborted, true);
    assert.equal(state.timers.size, 0);
    assert.equal(state.requests.length, 1);
});

for (const method of ["sync", "invalidate", "invalidateSecurity", "dispose"]) {
    test(`related database ${method} cancels metadata on a still-connected visible host`, () => {
        const state = loadHTTP();
        const file = createSourceFile("relatedView.ts", readFileSync("src/protyle/render/av/relatedView.ts", "utf8"),
            ScriptTarget.ES2022, true);
        const declaration = file.statements.find(item => isClassDeclaration(item) && item.name.text === "RelatedAVView");
        assert.ok(declaration && isClassDeclaration(declaration));
        const member = declaration.members.find(item => isMethodDeclaration(item) && item.name.getText(file) === method);
        assert.ok(member);
        const exports: {Lifecycle?: new () => Record<string, any>} = {};
        runInNewContext(transpileModule(`export class Lifecycle {${member.getText(file)}}`, {
            compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2022},
        }).outputText, {
            exports, clearTimeout() {}, setTimeout: () => 0, registrations: new Map(), removalObserver: undefined,
            closeAVCellEditor() {}, setAVData() {}, deleteAVRelationHost() {},
            beginAVRender: (_owner: unknown, options?: {preserveAVMetadata?: boolean}) => beginAVRender(state, options),
        });
        const lifecycle = Object.assign(new exports.Lifecycle(), {
            element: {isConnected: true, closest: (): Element => null, querySelector: () => ({
                setAttribute() {}, querySelector: () => ({setAttribute() {}}),
            })},
            hostElement: Object.assign(state.owner, {classList: {toggle() {}}}),
            host: {active: true, available: true, readonly: () => false},
            protyle: {id: "editor"}, unregisterRefresh() {}, failed() {},
        });
        const request = state.exports.beginTemplateHTTPRequest("/api/av/renderAttributeView", {
            id: "doc", ignoreRows: true,
        });
        renderAV(state);
        state.event("templateHTTPConfirm", {confirmID: "pending"});
        lifecycle[method](true);
        assert.equal(state.owner.isConnected, true);
        assert.equal(state.owner.closest(), null);
        assert.equal(request.signal.aborted, true);
        assert.equal(state.dialogs[0].destroyed, true);
        state.dialogs[0].approve();
        assert.equal(state.requests.length, 1);
        assert.equal(state.requests[0].url, "/api/template/cancelHTTP");
        assert.equal(state.timers.size, 0);
    });
}

test("template requests bind one execution to the exact main socket", () => {
    const state = loadHTTP();
    const request = state.begin();
    assert.equal(request.headers["X-Siyuan-Template-App"], "app");
    assert.equal(request.headers["X-Siyuan-Template-Session"], "main-session");
    assert.equal(request.headers.custom, "header");
    assert.equal(state.requests.length, 0);
    request.finish();
});

test("attribute panels require an explicit live owner and cancel stale confirmations", () => {
    const state = loadHTTP();
    assert.equal(state.begin("/api/av/getAttributeViewKeys"), undefined);
    const guard = state.exports.guardTemplateHTTPRequest(() => state.owner.isConnected, state.owner);
    const request = state.begin("/api/av/getAttributeViewKeys", guard.signal);
    assert.equal(request.headers["X-Siyuan-Template-Session"], "main-session");
    state.event("templateHTTPConfirm", {confirmID: "panel", executionID: request.headers["X-Siyuan-Template-Execution"]});
    state.owner.isConnected = false;
    state.dialogs[0].approve();
    assert.equal(request.signal.aborted, true);
    assert.equal(state.requests.some(item => item.url.endsWith("respondHTTP")), false);
    assert.equal(state.requests[0].url, "/api/template/cancelHTTP");
    guard.dispose();
    assert.equal(state.timers.size, 0);
});

test("non-public targets explain the possible Fake-IP cause", () => {
    const state = loadHTTP();
    const request = state.begin();
    state.event("templateHTTPStatus", {state: "error", errorCode: "unsafe_target"});
    assert.equal(state.messages[0][0], state.siyuan.languages.templateHTTPUnsafeTarget);
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

test("manual automation uses interactive confirmation and cancels with its database owner", () => {
    const state = loadHTTP();
    const request = state.begin("/api/av/runAttributeViewAutomation");
    assert.equal(request.headers["X-Siyuan-Template-Execution"], "execution-1");
    state.event("templateHTTPConfirm", {confirmID: "manual", canPersist: true});
    assert.equal(state.dialogs.length, 1);
    state.exports.cancelTemplateHTTPForElement(state.owner);
    assert.equal(request.signal.aborted, true);
    assert.equal(state.dialogs[0].destroyed, true);
    assert.equal(state.requests.at(-1).url, "/api/template/cancelHTTP");
});


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

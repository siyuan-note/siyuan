import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";
import {runInNewContext} from "node:vm";
import {transpileModule, ModuleKind} from "typescript";

class Control {
    value = "";
    innerHTML = "";
    textContent = "";
    disabled = false;
    isConnected = true;
    files: Array<{size: number; text: () => Promise<string>}> = [];
    dataset: Record<string, string> = {};
    listeners = new Map<string, (event: {target: Control}) => void | Promise<void>>();
    classes = new Set<string>();
    classList = {toggle: (name: string, force: boolean) => { if (force) { this.classes.add(name); } else { this.classes.delete(name); } }};
    addEventListener(name: string, handler: (event: {target: Control}) => void | Promise<void>) { this.listeners.set(name, handler); }
    closest() { return this; }
    focus() {}
    click() {}
}

const fixture = (remote = false) => {
    const controls: Record<string, Control> = {};
    for (const name of ["account", "password", "file", "status", "login", "add", "logout", "usage", "cancel", "export", "import"]) {
        controls[name] = new Control();
        controls[name].dataset.chatgpt = name;
    }
    const root = new Control();
    const buttons = ["login", "add", "logout", "usage", "cancel", "export", "import"].map(name => controls[name]);
    Object.assign(root, {
        querySelector: (selector: string) => controls[selector.match(/data-chatgpt='([^']+)'/)![1]],
        querySelectorAll: () => buttons,
    });
    const view = {isConnected: true, querySelector: () => root};
    const calls: Array<{path: string; body: unknown}> = [];
    const timers = new Map<number, () => void>();
    let observerCallback: () => void;
    const browserWindow = {opener: {}, location: {href: "about:blank"}, close: () => {}};
    const profiles = [{id: "account-one", email: "user@example.com", name: "", connected: true, sharing: true}];
    const namespace: Record<string, unknown> = {};
    let pendingStatus: (response: unknown) => void;
    let loginCount = 0;
    const source = readFileSync("src/config/tabs/ai/chatGPTAccount.ts", "utf8");
    runInNewContext(transpileModule(source, {compilerOptions: {module: ModuleKind.CommonJS}}).outputText, {
        exports: namespace,
        require: (name: string) => {
            if (name.endsWith("util/fetch")) {
                return {fetchPost: async (path: string, body: unknown, callback?: (response: unknown) => void) => {
                    calls.push({path, body});
                    if (path.endsWith("accounts")) { callback?.({code: 0, data: profiles}); }
                    if (path.endsWith("start")) { callback?.({code: 0, data: {id: "attempt-" + (++loginCount), url: "https://auth.openai.com/authorize"}}); }
                    if (path.endsWith("status")) { pendingStatus = callback!; }
                }};
            }
            if (name.endsWith("util/escape")) { return {escapeHtmlTextAndAttr: (value: string) => value}; }
            if (name.endsWith("util/hostCapabilities")) { return {getHostCapabilities: () => ({remoteKernel: remote})}; }
            if (name.endsWith("util/compatibility")) { return {isInMobileApp: () => false, saveExportFile: async () => ({status: "success"})}; }
            if (name.endsWith("editor/openLink")) { return {openByMobile: () => {}}; }
            if (name.endsWith("dialog/message")) { return {showMessage: () => {}}; }
            if (name.endsWith("render/fragments")) { return {genConfigItemMainHtml: () => ""}; }
            if (name === "electron") { return {shell: {openExternal: async () => {}}}; }
            throw new Error(name);
        },
        location: {hostname: remote ? "notes.example.com" : "127.0.0.1"},
        MutationObserver: class { constructor(callback: () => void) { observerCallback = callback; } observe() {} disconnect() {} },
        window: {
            siyuan: {languages: {mcpStatusConnected: "Connected", chatGPTConnect: "Continue", chatGPTRemoteTip: "Import on remote"}},
            setTimeout: (callback: () => void) => { const id = timers.size + 1; timers.set(id, callback); return id; },
            clearTimeout: (id: number) => { timers.delete(id); },
            open: () => browserWindow,
        },
        document: {body: {}},
    });
    const draft = {authType: "chatgpt", accountID: "", models: [{name: "previous-model"}]};
    const ready: boolean[] = [];
    const mount = namespace.mountChatGPTAccount as (root: unknown, draft: unknown, onChange: (ready: boolean) => void) => void;
    mount(view, draft, value => ready.push(value));
    return {
        controls, root, view, draft, calls, timers, ready, browserWindow,
        remove: () => { view.isConnected = false; observerCallback(); },
        finish: (response: unknown) => pendingStatus(response),
    };
};

test("remote account settings offer import and retain account selection", async () => {
    const f = fixture(true);
    await Promise.resolve();
    assert.equal(f.controls.login.disabled, true);
    assert.equal(f.controls.add.disabled, true);
    assert.equal(f.controls.import.disabled, false);
    f.controls.account.value = "account-one";
    await f.controls.account.listeners.get("change")!({target: f.controls.account});
    assert.equal(f.draft.accountID, "account-one");
    assert.equal(f.draft.models.length, 0);
    assert.equal(f.ready.at(-1), true);
});

test("closing account settings cancels login and ignores a late callback", async () => {
    const f = fixture();
    await Promise.resolve();
    await f.root.listeners.get("click")!({target: f.controls.login});
    assert.equal(f.browserWindow.location.href, "https://auth.openai.com/authorize");
    assert.equal(f.controls.cancel.disabled, false);
    for (const callback of [...f.timers.values()]) { callback(); }
    f.remove();
    assert.ok(f.calls.some(call => call.path.endsWith("cancel")));
    f.finish({code: 0, data: {state: "completed", accountID: "account-one"}});
    assert.equal(f.draft.accountID, "");
});

test("an old login result cannot replace a newer login attempt", async () => {
    const f = fixture();
    await Promise.resolve();
    await f.root.listeners.get("click")!({target: f.controls.login});
    for (const callback of [...f.timers.values()]) { callback(); }
    await f.root.listeners.get("click")!({target: f.controls.cancel});
    await f.root.listeners.get("click")!({target: f.controls.login});
    assert.equal(f.calls.filter(call => call.path.endsWith("start")).length, 2);
    f.finish({code: 0, data: {state: "completed", accountID: "account-one"}});
    assert.equal(f.draft.accountID, "");
});

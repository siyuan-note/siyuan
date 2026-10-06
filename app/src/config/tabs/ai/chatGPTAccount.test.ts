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
    attributes: Record<string, string> = {};
    listeners = new Map<string, (event: {target: Control}) => void | Promise<void>>();
    classes = new Set<string>();
    classList = {toggle: (name: string, force: boolean) => { if (force) { this.classes.add(name); } else { this.classes.delete(name); } }};
    addEventListener(name: string, handler: (event: {target: Control}) => void | Promise<void>) { this.listeners.set(name, handler); }
    setAttribute(name: string, value: string) { this.attributes[name] = value; }
    closest() { return this; }
    focus() {}
    click() {}
}

const account = (id = "account-one", email = "user@example.com") => ({id, email, name: "", connected: true, sharing: true});

const fixture = (remote = false, initialProfiles = [account()], accountID = "") => {
    const controls: Record<string, Control> = {};
    for (const name of ["accountRow", "accountInfo", "account", "password", "file", "statusRow", "status", "login", "add", "logout", "remove", "usage", "transfer", "transferPanel", "cancel", "export", "import"]) {
        controls[name] = new Control();
        controls[name].dataset.chatgpt = name;
    }
    const root = new Control();
    const buttons = ["login", "add", "logout", "remove", "usage", "transfer", "cancel", "export", "import"].map(name => controls[name]);
    Object.assign(root, {
        querySelector: (selector: string) => controls[selector.match(/data-chatgpt='([^']+)'/)![1]],
        querySelectorAll: () => buttons,
    });
    const view = {isConnected: true, querySelector: () => root};
    const calls: Array<{path: string; body: unknown}> = [];
    const timers = new Map<number, () => void>();
    let observerCallback: () => void;
    const browserWindow = {opener: {}, location: {href: "about:blank"}, close: () => {}};
    const profiles = [...initialProfiles];
    const namespace: Record<string, unknown> = {};
    let pendingStatus: (response: unknown) => void;
    let loginCount = 0;
    const confirmations: Array<{text: string; confirm: () => void; cancel: () => void}> = [];
    const messages: string[] = [];
    const outcomes = {removeCode: 0, revoked: true};
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
                    if (path.endsWith("logout")) {
                        const selected = profiles.find(profile => profile.id === (body as {accountID: string}).accountID);
                        if (selected) { selected.connected = false; selected.sharing = false; }
                        callback?.({code: 0, data: {revoked: true}});
                    }
                    if (path.endsWith("remove")) {
                        const index = profiles.findIndex(profile => profile.id === (body as {accountID: string}).accountID);
                        if (outcomes.removeCode === 0 && index !== -1) { profiles.splice(index, 1); }
                        callback?.({code: outcomes.removeCode, data: {revoked: outcomes.revoked}});
                    }
                    if (path.endsWith("import")) {
                        const imported = account("account-two", "imported@example.com");
                        profiles.push(imported);
                        callback?.({code: 0, data: imported});
                    }
                }};
            }
            if (name.endsWith("util/escape")) { return {escapeHtmlTextAndAttr: (value: string) => value}; }
            if (name.endsWith("util/hostCapabilities")) { return {getHostCapabilities: () => ({remoteKernel: remote})}; }
            if (name.endsWith("util/compatibility")) { return {isInMobileApp: () => false, saveExportFile: async () => ({status: "success"})}; }
            if (name.endsWith("editor/openLink")) { return {openByMobile: () => {}}; }
            if (name.endsWith("dialog/message")) { return {showMessage: (message: string) => messages.push(message)}; }
            if (name.endsWith("dialog/confirmDialog")) {
                return {confirmDialog: (_title: string, text: string, confirm: () => void, cancel: () => void) => confirmations.push({text, confirm, cancel})};
            }
            if (name.endsWith("render/fragments")) { return {genConfigItemMainHtml: () => ""}; }
            if (name === "electron") { return {shell: {openExternal: async () => {}}}; }
            throw new Error(name);
        },
        location: {hostname: remote ? "notes.example.com" : "127.0.0.1"},
        MutationObserver: class { constructor(callback: () => void) { observerCallback = callback; } observe() {} disconnect() {} },
        window: {
            siyuan: {languages: {confirmDeleteTip: "Delete ${x}?", chatGPTRevokeFailed: "Remote revocation was not confirmed", chatGPTAccount: "ChatGPT account", chatGPTSignedOut: "Not signed in; account info is kept for signing in again", mcpStatusConnected: "Connected", mcpStatusAuthorizationRequired: "Authorization required", chatGPTConnect: "Continue", chatGPTSignInPendingTip: "Signing in", chatGPTRemoteTip: "Import on remote"}},
            setTimeout: (callback: () => void) => { const id = timers.size + 1; timers.set(id, callback); return id; },
            clearTimeout: (id: number) => { timers.delete(id); },
            open: () => browserWindow,
        },
        document: {body: {}},
    });
    const draft = {authType: "chatgpt", accountID, models: [{name: "previous-model"}]};
    const ready: boolean[] = [];
    const mount = namespace.mountChatGPTAccount as (root: unknown, draft: unknown, onChange: (ready: boolean) => void) => void;
    mount(view, draft, value => ready.push(value));
    return {
        controls, root, view, draft, calls, timers, ready, browserWindow, profiles, confirmations, outcomes, messages,
        remove: () => { view.isConnected = false; observerCallback(); },
        finish: (response: unknown) => pendingStatus(response),
    };
};

test("no saved accounts show login without an account picker or repeated login text", () => {
    const f = fixture(false, []);
    assert.equal(f.controls.accountRow.classes.has("fn__none"), true);
    assert.equal(f.controls.account.classes.has("fn__none"), true);
    for (const name of ["add", "logout", "remove", "usage", "statusRow"]) {
        assert.equal(f.controls[name].classes.has("fn__none"), true);
    }
    assert.equal(f.controls.login.disabled, false);
    assert.equal(f.controls.login.classes.has("fn__none"), false);
    assert.equal(f.ready.at(-1), false);
});

test("removing the selected registration preserves another registration with the same email", async () => {
    const f = fixture(false, [account(), account("account-two")], "account-one");
    const removing = f.root.listeners.get("click")!({target: f.controls.remove});
    assert.equal(f.confirmations[0].text, "Delete user@example.com (ount-one)?");
    assert.equal(f.calls.some(call => call.path.endsWith("remove")), false);
    f.confirmations[0].confirm();
    await removing;
    assert.equal(f.profiles.length, 1);
    assert.equal(f.profiles[0].id, "account-two");
    assert.equal(f.controls.account.classes.has("fn__none"), true);
    assert.equal(f.draft.accountID, "account-two");
    assert.equal(f.draft.models.length, 0);
});

test("cancelling account removal does not send a request", async () => {
    const f = fixture();
    const removing = f.root.listeners.get("click")!({target: f.controls.remove});
    f.confirmations[0].cancel();
    await removing;
    assert.equal(f.calls.some(call => call.path.endsWith("remove")), false);
    assert.equal(f.draft.accountID, "account-one");
    assert.equal(f.controls.remove.disabled, false);
});

test("removing the last signed-out account on a remote kernel restores the empty state", async () => {
    const f = fixture(true, [{...account(), connected: false, sharing: false}]);
    assert.equal(f.controls.remove.disabled, false);
    const removing = f.root.listeners.get("click")!({target: f.controls.remove});
    f.confirmations[0].confirm();
    await removing;
    assert.equal(f.controls.accountRow.classes.has("fn__none"), true);
    assert.equal(f.controls.remove.classes.has("fn__none"), true);
    assert.equal(f.draft.accountID, "");
    assert.equal(f.ready.at(-1), false);
});

test("failed removal retains the selected registration and model configuration", async () => {
    const f = fixture(false, [account()], "account-one");
    f.outcomes.removeCode = -1;
    const removing = f.root.listeners.get("click")!({target: f.controls.remove});
    f.confirmations[0].confirm();
    await removing;
    assert.equal(f.draft.accountID, "account-one");
    assert.equal(f.draft.models.length, 1);
    assert.equal(f.controls.remove.disabled, false);
});

test("unconfirmed remote revocation is reported after local removal", async () => {
    const f = fixture();
    f.outcomes.revoked = false;
    const removing = f.root.listeners.get("click")!({target: f.controls.remove});
    f.confirmations[0].confirm();
    await removing;
    assert.equal(f.draft.accountID, "");
    assert.equal(f.messages.at(-1), "Remote revocation was not confirmed");
});

test("a single saved account is selected and displayed as text", () => {
    const f = fixture();
    assert.equal(f.controls.accountRow.classes.has("fn__none"), false);
    assert.equal(f.controls.account.classes.has("fn__none"), true);
    assert.equal(f.controls.accountInfo.classes.has("fn__none"), false);
    assert.equal(f.controls.accountInfo.textContent, "user@example.com (ount-one)");
    assert.equal(f.draft.accountID, "account-one");
    assert.equal(f.draft.models.length, 0);
    assert.equal(f.ready.at(-1), true);
    assert.equal(f.controls.login.classes.has("fn__none"), true);
});

test("reopening a selected single account preserves its models", () => {
    const f = fixture(false, [account()], "account-one");
    assert.equal(f.draft.models.length, 1);
    assert.equal(f.ready.at(-1), true);
});

test("logging out shows the signed-out state and retains the registration for sign-in", async () => {
    const f = fixture();
    await f.root.listeners.get("click")!({target: f.controls.logout});
    assert.equal(f.controls.statusRow.classes.has("fn__none"), false);
    assert.equal(f.controls.status.textContent, "Not signed in; account info is kept for signing in again");
    assert.equal(f.controls.logout.classes.has("fn__none"), true);
    assert.equal(f.controls.export.disabled, true);
    assert.equal(f.controls.login.disabled, false);
    assert.equal(f.controls.login.classes.has("fn__none"), false);
    assert.equal(f.draft.accountID, "account-one");
    assert.equal(f.ready.at(-1), false);
    await f.root.listeners.get("click")!({target: f.controls.login});
    assert.equal((f.calls.find(call => call.path.endsWith("start"))?.body as {accountID: string}).accountID, "account-one");
});

test("reopening a signed-out account does not show it as connected", () => {
    const f = fixture(false, [{...account(), connected: false, sharing: false}], "account-one");
    assert.equal(f.controls.status.textContent, "Not signed in; account info is kept for signing in again");
    assert.equal(f.controls.logout.classes.has("fn__none"), true);
    assert.equal(f.controls.export.disabled, true);
    assert.equal(f.ready.at(-1), false);
});

test("an account without plan permission is shown as requiring authorization", () => {
    const f = fixture(false, [{...account(), sharing: false}]);
    assert.equal(f.controls.status.textContent, "Authorization required");
    assert.equal(f.controls.logout.classes.has("fn__none"), false);
    assert.equal(f.ready.at(-1), false);
    assert.equal(f.controls.login.classes.has("fn__none"), false);
});

test("switching between connected and signed-out accounts updates login visibility", async () => {
    const f = fixture(false, [account(), {...account("account-two"), connected: false, sharing: false}], "account-one");
    assert.equal(f.controls.login.classes.has("fn__none"), true);
    f.controls.account.value = "account-two";
    await f.controls.account.listeners.get("change")!({target: f.controls.account});
    assert.equal(f.controls.login.classes.has("fn__none"), false);
    f.controls.account.value = "account-one";
    await f.controls.account.listeners.get("change")!({target: f.controls.account});
    assert.equal(f.controls.login.classes.has("fn__none"), true);
});

test("multiple saved accounts show a picker and switching clears the previous models", async () => {
    const f = fixture(false, [account(), account("account-two", "other@example.com")], "account-one");
    assert.equal(f.controls.account.classes.has("fn__none"), false);
    assert.equal(f.controls.accountInfo.classes.has("fn__none"), true);
    assert.equal(f.controls.account.value, "account-one");
    assert.equal(f.controls.account.innerHTML.includes("Continue"), false);
    f.controls.account.value = "account-two";
    await f.controls.account.listeners.get("change")!({target: f.controls.account});
    assert.equal(f.draft.accountID, "account-two");
    assert.equal(f.draft.models.length, 0);
    assert.equal(f.ready.at(-1), true);
});

test("logging in adds the first account and replaces the empty state with account information", async () => {
    const f = fixture(false, []);
    await f.root.listeners.get("click")!({target: f.controls.login});
    assert.equal(f.controls.statusRow.classes.has("fn__none"), false);
    assert.equal(f.controls.accountRow.classes.has("fn__none"), false);
    for (const callback of [...f.timers.values()]) { callback(); }
    f.profiles.push(account());
    await f.finish({code: 0, data: {state: "completed", accountID: "account-one"}});
    assert.equal(f.controls.accountRow.classes.has("fn__none"), false);
    assert.equal(f.controls.account.classes.has("fn__none"), true);
    assert.equal(f.controls.accountInfo.textContent, "user@example.com (ount-one)");
    assert.equal(f.draft.accountID, "account-one");
    assert.equal(f.ready.at(-1), true);
    assert.equal(f.controls.login.classes.has("fn__none"), true);
});

test("importing another account shows the picker with the imported account selected", async () => {
    const f = fixture(true);
    f.controls.password.value = "transfer-password";
    f.controls.file.files = [{size: 10, text: async () => "encrypted account"}];
    await f.controls.file.listeners.get("change")!({target: f.controls.file});
    assert.equal(f.controls.account.classes.has("fn__none"), false);
    assert.equal(f.controls.account.value, "account-two");
    assert.equal(f.draft.accountID, "account-two");
    assert.equal(f.draft.models.length, 0);
    assert.equal(f.ready.at(-1), true);
});

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

test("account transfer stays collapsed by default and can be toggled on local and remote kernels", async () => {
    for (const remote of [false, true]) {
        const f = fixture(remote);
        assert.equal(f.controls.transferPanel.classes.has("fn__none"), true);
        assert.equal(f.controls.transfer.attributes["aria-expanded"], "false");
        assert.equal(f.controls.transfer.disabled, false);
        const calls = f.calls.length;
        await f.root.listeners.get("click")!({target: f.controls.transfer});
        assert.equal(f.controls.transferPanel.classes.has("fn__none"), false);
        assert.equal(f.controls.transfer.attributes["aria-expanded"], "true");
        assert.equal(f.controls.import.disabled, false);
        await f.root.listeners.get("click")!({target: f.controls.transfer});
        assert.equal(f.controls.transferPanel.classes.has("fn__none"), true);
        assert.equal(f.controls.transfer.attributes["aria-expanded"], "false");
        assert.equal(f.calls.length, calls);
    }
});

test("closing account settings cancels login and ignores a late callback", async () => {
    const f = fixture(false, [{...account(), connected: false, sharing: false}]);
    await Promise.resolve();
    await f.root.listeners.get("click")!({target: f.controls.login});
    assert.equal(f.browserWindow.location.href, "https://auth.openai.com/authorize");
    assert.equal(f.controls.cancel.disabled, false);
    for (const callback of [...f.timers.values()]) { callback(); }
    f.remove();
    assert.ok(f.calls.some(call => call.path.endsWith("cancel")));
    f.finish({code: 0, data: {state: "completed", accountID: "late-account"}});
    assert.equal(f.draft.accountID, "account-one");
});

test("an old login result cannot replace a newer login attempt", async () => {
    const f = fixture(false, [{...account(), connected: false, sharing: false}]);
    await Promise.resolve();
    await f.root.listeners.get("click")!({target: f.controls.login});
    for (const callback of [...f.timers.values()]) { callback(); }
    await f.root.listeners.get("click")!({target: f.controls.cancel});
    await f.root.listeners.get("click")!({target: f.controls.login});
    assert.equal(f.calls.filter(call => call.path.endsWith("start")).length, 2);
    f.finish({code: 0, data: {state: "completed", accountID: "late-account"}});
    assert.equal(f.draft.accountID, "account-one");
});

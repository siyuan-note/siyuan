import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";
import * as cloudUser from "./cloudUser";

const setup = () => {
    const originalWindow = globalThis.window;
    const createUser = (userId = "alice", token = "valid-token", status = 2) => ({
        userId, userName: userId, userToken: token, userSiYuanSubscriptionStatus: status,
    }) as cloudUser.TCloudUser;
    const user = createUser();
    const testWindow = {siyuan: {user, config: {cloudRegion: 0}, languages: {
        refreshUser: "Refreshed", _kernel: {18: "Failed"},
    }}, dispatchEvent: () => {}} as unknown as Window & typeof globalThis;
    Object.defineProperty(globalThis, "window", {configurable: true, value: testWindow});
    const messages: string[] = [];
    const requests: Array<{
        token: string;
        finish: (code: number, data: cloudUser.TCloudUser | null) => void;
        fail: () => void;
    }> = [];
    const classes = new Set<string>();
    const root = {isConnected: true, querySelector: () => ({classList: {
        add: (name: string) => classes.add(name), remove: (name: string) => classes.delete(name),
    }})} as unknown as Element;
    const runtime = {} as {refreshCloudUser: (force?: boolean, root?: Element) => Promise<void>};
    const code = transpileModule(readFileSync("src/config/tabs/accountUi.ts", "utf8"), {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
    }).outputText;
    runInNewContext(code, {
        exports: runtime, window: testWindow, document: {getElementById: (): null => null},
        CustomEvent: class {},
        require: (name: string) => {
            if (name === "./cloudUser") return cloudUser;
            if (name === "../../dialog/message") return {showMessage: (message: string) => messages.push(message)};
            if (name === "../../dialog/processSystem") return {processSync: () => {}};
            if (name === "../../util/fetch") return {fetchPost: (
                url: string, data: {token: string}, callback: (response: unknown) => void,
                _headers: unknown, fail: () => void,
            ) => {
                assert.equal(url, "/api/setting/getCloudUser");
                return new Promise<void>(resolve => requests.push({token: data.token,
                    finish: (code, data) => { callback({code, data, msg: code ? "Failed" : ""}); resolve(); },
                    fail: () => { fail(); resolve(); },
                }));
            }};
            return {};
        },
    });
    return {runtime, user, testWindow, root, classes, messages, requests, createUser,
        restore: () => Object.defineProperty(globalThis, "window", {configurable: true, value: originalWindow})};
};

test("opening account settings fetches the current token, applies renewed status, and throttles reopening", async () => {
    const ui = setup();
    try {
        const pending = ui.runtime.refreshCloudUser(false, ui.root);
        await Promise.resolve();
        assert.equal(ui.requests[0].token, "valid-token");
        assert.equal(ui.classes.has("fn__rotate"), true);
        cloudUser.setCloudUser(ui.createUser("alice", "new-token", 0));
        ui.requests[0].finish(0, ui.createUser("alice", "new-token", 0));
        await pending;
        assert.equal(ui.testWindow.siyuan.user.userSiYuanSubscriptionStatus, 0);
        assert.equal(ui.classes.has("fn__rotate"), false);
        assert.deepEqual(ui.messages, []);
        await ui.runtime.refreshCloudUser(false, ui.root);
        assert.equal(ui.requests.length, 1);
        const manual = ui.runtime.refreshCloudUser(true, ui.root);
        await Promise.resolve();
        assert.equal(ui.requests[1].token, "new-token");
        ui.requests[1].finish(0, ui.createUser("alice", "new-token", 0));
        await manual;
        assert.deepEqual(ui.messages, ["Refreshed"]);
    } finally { ui.restore(); }
});

test("confirmed invalid credentials clear the account and retain the login name", async () => {
    const ui = setup();
    try {
        const pending = ui.runtime.refreshCloudUser(true, ui.root);
        await Promise.resolve();
        ui.requests[0].finish(255, null);
        await pending;
        assert.equal(ui.testWindow.siyuan.user, null);
        assert.equal(cloudUser.getCloudLoginUserName(), "alice");
        assert.deepEqual(ui.messages, ["Failed"]);
    } finally { ui.restore(); }
});

test("offline automatic refresh preserves the account and releases the spinner", async () => {
    const ui = setup();
    try {
        const pending = ui.runtime.refreshCloudUser(false, ui.root);
        await Promise.resolve();
        ui.requests[0].fail();
        await pending;
        assert.equal(ui.testWindow.siyuan.user, ui.user);
        assert.deepEqual(ui.messages, ["Failed"]);
        assert.equal(ui.classes.has("fn__rotate"), false);
        await ui.runtime.refreshCloudUser(false, ui.root);
        assert.equal(ui.requests.length, 1);
    } finally { ui.restore(); }
});

test("responses cannot restore a session after logout and login to the same account", async () => {
    const ui = setup();
    try {
        const pending = ui.runtime.refreshCloudUser(false, ui.root);
        await Promise.resolve();
        cloudUser.setCloudUser(null);
        const current = ui.createUser("alice", "relogin-token");
        cloudUser.setCloudUser(current);
        ui.requests[0].finish(0, ui.createUser("alice", "stale-token", 0));
        await pending;
        assert.equal(ui.testWindow.siyuan.user, current);
        assert.deepEqual(ui.messages, []);
    } finally { ui.restore(); }
});

test("logged-out and changed-region refreshes do not overwrite the current account", async () => {
    const ui = setup();
    try {
        const pending = ui.runtime.refreshCloudUser(false, ui.root);
        await Promise.resolve();
        ui.testWindow.siyuan.config.cloudRegion = 1;
        ui.requests[0].finish(0, ui.createUser("alice", "stale-token", 0));
        await pending;
        assert.equal(ui.testWindow.siyuan.user, ui.user);
        cloudUser.setCloudUser(null);
        await ui.runtime.refreshCloudUser(false, ui.root);
        assert.equal(ui.requests.length, 1);
    } finally { ui.restore(); }
});

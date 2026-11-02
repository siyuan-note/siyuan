import {test} from "node:test";
import {mockElectron, resetElectronStub} from "../fixtures/electronStub";
import type {App} from "electron";
const assert = require("node:assert/strict");
const path = require("node:path");

const load = (t: any, app: Partial<App> = {}) => {
    resetElectronStub();
    mockElectron(t, {app: app as App});
    t.after(resetElectronStub);
    return require("./protocolClient");
};

// 记录注册调用的假 app，用例据此断言传参形态。
const createApp = () => {
    const calls = [];
    return {
        calls,
        setAsDefaultProtocolClient: (...args) => calls.push(["set", ...args]),
        removeAsDefaultProtocolClient: (...args) => calls.push(["remove", ...args]),
    };
};

const register = (t: any) => {
    const app = createApp();
    return {app, registerProtocolClient: load(t, app as unknown as App).registerProtocolClient};
};

test("registerProtocolClient registers the protocol without arguments in production", (t) => {
    const {app, registerProtocolClient} = register(t);
    registerProtocolClient({isDevEnv: false, defaultApp: false});
    assert.deepStrictEqual(app.calls, [["set", "siyuan"]]);
});

test("registerProtocolClient passes the script path on Windows development runs", (t) => {
    const {app, registerProtocolClient} = register(t);
    const execPath = "C:\\electron.exe";
    registerProtocolClient({
        isDevEnv: true, defaultApp: true, platform: "win32", execPath, argv: ["electron.exe", "main.js"],
    });
    const mainScript = path.resolve("main.js");
    assert.deepStrictEqual(app.calls, [
        ["remove", "siyuan", execPath, [mainScript]],
        ["set", "siyuan", execPath, [mainScript]],
    ]);
});

test("registerProtocolClient keeps the plain registration on non-Windows development runs", (t) => {
    const {app, registerProtocolClient} = register(t);
    registerProtocolClient({
        isDevEnv: true, defaultApp: true, platform: "darwin", execPath: "/electron", argv: ["/electron", "main.js"],
    });
    assert.deepStrictEqual(app.calls, [["set", "siyuan"]]);
});

test("registerProtocolClient ignores development arguments outside electron main runs", (t) => {
    const {app, registerProtocolClient} = register(t);
    registerProtocolClient({
        isDevEnv: true, defaultApp: false, platform: "win32", execPath: "electron.exe", argv: ["electron.exe", "main.js"],
    });
    assert.deepStrictEqual(app.calls, [["set", "siyuan"]]);
});

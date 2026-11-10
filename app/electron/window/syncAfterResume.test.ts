import {test} from "node:test";
import {syncAfterResume} from "./syncAfterResume";
import type {BrowserWindow, Session} from "electron";
import type {Workspace} from "../shared/types";
const assert = require("node:assert/strict");

// 工作空间按完整类型构造；被测路径只读 ownsKernel 与 kernelTarget，窗口对象不参与。
const createWorkspace = (ownsKernel: boolean, origin: string): Workspace => ({
    ownsKernel,
    kernelTarget: {mode: ownsKernel ? "local" : "remote", origin, ownsKernel, port: "6806"},
    browserWindow: {} as unknown as BrowserWindow,
    webContentsId: 0,
    port: "6806",
});

test("resume sync carries each workspace session and reports rejected requests", async () => {
    const requests = [];
    const logs = [];
    const local = createWorkspace(true, "http://127.0.0.1:6806");
    const remote = createWorkspace(false, "https://remote.example");
    const createSession = name => ({fetch: async (url, options) => {
        requests.push({name, url, options});
        return {ok: name === "remote", status: name === "remote" ? 200 : 401};
    }});
    const session = {defaultSession: createSession("local")};
    const run = () => syncAfterResume({
        writeLog: message => logs.push(message),
        isOnline: async () => true,
        sleep: async () => {},
        workspaces: [local, remote],
        session: session as unknown as {defaultSession: Session},
        getRemoteSession: target => {
            assert.equal(target, remote.kernelTarget);
            return createSession("remote") as unknown as Session;
        },
    });
    await run();
    assert.equal(requests.length, 2);
    for (const request of requests) {
        assert.equal(request.options.credentials, "include");
        assert.equal(request.options.method, "POST");
        assert.equal(request.url.endsWith("/api/sync/performSync"), true);
        assert.equal(request.options.bypassCustomProtocolHandlers, request.name === "remote");
        assert.equal(request.options.redirect, request.name === "remote" ? "manual" : "follow");
    }
    assert.ok(logs.includes("sync after system resume rejected [HTTP 401]"));
    session.defaultSession.fetch = async () => { throw new Error("secret authentication data"); };
    await run();
    assert.ok(logs.includes("sync after system resume request failed"));
    assert.ok(logs.every(message => !message.includes("secret")));
});

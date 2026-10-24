import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";

test("destroying a main Model cancels reconnects, queued messages and late socket callbacks", () => {
    const sockets: Socket[] = [];
    const timers = new Map<number, () => void>();
    const calls: string[] = [];
    class Socket {
        onopen: () => void;
        onclose: (event: {reason: string}) => void;
        onmessage: (event: {data: string}) => void;
        onerror: () => void;
        readyState = 1;
        constructor() { sockets.push(this); }
        close() { calls.push("close"); }
        send() { calls.push("send"); }
    }
    const exports = {} as {Model: new (options: unknown) => {
        connect: (options: unknown) => void; destroy: () => void; flushMainMessages: () => void; send: (cmd: string, data: unknown) => void;
    }};
    const window = {location: {protocol: "https:", host: "siyuan"}, siyuan: {isReady: false, config: {}}};
    runInNewContext(transpileModule(readFileSync("src/layout/Model.ts", "utf8"), {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
    }).outputText, {exports, window, WebSocket: Socket, document: {getElementById: (): HTMLElement | null => null}, console,
        setTimeout: (callback: () => void) => { timers.set(1, callback); return 1; },
        clearTimeout: (id: number) => timers.delete(id),
        require: () => ({Constants: {SIYUAN_APPID: "test"}, processMessage: (value: unknown) => value,
            refreshSettingConfig: () => calls.push("refresh")})});
    const model = new exports.Model({app: {}});
    const options = {id: "test", type: "main", callback: () => calls.push("open"), msgCallback: () => calls.push("message")};
    model.connect(options);
    const socket = sockets[0];
    const lateOpen = socket.onopen;
    const lateMessage = socket.onmessage;
    const lateClose = socket.onclose;
    socket.onmessage({data: '{"cmd":"test"}'});
    socket.onclose({reason: "network interrupted"});
    const reconnect = timers.get(1);
    assert.equal(timers.size, 1);
    model.destroy();
    model.destroy();
    assert.equal(timers.size, 0);
    reconnect();
    lateOpen();
    lateMessage({data: '{"cmd":"test"}'});
    lateClose({reason: "network interrupted"});
    window.siyuan.isReady = true;
    model.flushMainMessages();
    model.send("test", {});
    model.connect(options);
    assert.equal(sockets.length, 1);
    assert.deepEqual(calls, ["close"]);
    assert.equal(socket.onopen, null);
    assert.equal(socket.onmessage, null);
    assert.equal(socket.onerror, null);
});

test("main socket recovery is recorded and obsolete sockets cannot finish a fault diagnosis", () => {
    const sockets: Socket[] = [];
    const diagnoses: (() => boolean)[] = [];
    let recovered = 0;
    class Socket {
        onopen: () => void;
        onerror: (event: unknown) => void;
        onclose: unknown;
        readyState = 3;
        constructor() { sockets.push(this); }
        close() {}
    }
    const api = {} as {Model: new (options: unknown) => {
        connect: (options: unknown) => void, destroy: () => void,
    }};
    runInNewContext(transpileModule(readFileSync("src/layout/Model.ts", "utf8"), {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
    }).outputText, {exports: api, WebSocket: Socket, clearTimeout: () => {},
        window: {location: {protocol: "https:", host: "local"}, siyuan: {isReady: false}},
        document: {getElementById: (): null => null},
        require: (name: string) => {
            if (name === "../constants") return {Constants: {SIYUAN_APPID: "test"}};
            if (name === "../util/kernelFault") return {kernelError: (obsolete: () => boolean) => diagnoses.push(obsolete)};
            if (name === "../util/kernelConnection") return {markKernelConnectionAlive: () => recovered++};
            throw new Error(name);
        },
    });
    const model = new api.Model({app: {}});
    const options = {id: "test", type: "main"};
    model.connect(options);
    sockets[0].onerror({target: {url: "wss://local/ws?app=test&id=test&type=main", readyState: 3}});
    assert.equal(diagnoses.length, 1);
    assert.equal(diagnoses[0](), false);
    model.connect(options);
    sockets[1].onopen();
    assert.equal(recovered, 1);
    assert.equal(diagnoses[0](), true);
    sockets[1].onerror({target: {url: "wss://local/ws?app=test&id=test&type=main", readyState: 3}});
    model.destroy();
    assert.equal(diagnoses[1](), true);
});

test("main windows query their own checkout preparation on startup and reconnect", () => {
    const sockets: Socket[] = [];
    const queries: {id: string, reconnect?: boolean}[] = [];
    const messages: string[] = [];
    class Socket {
        static CONNECTING = 0;
        onopen: () => void;
        onclose: unknown;
        onmessage: unknown;
        onerror: unknown;
        readyState = 1;
        constructor(public url: string) { sockets.push(this); }
        close() {}
        send(message: string) { messages.push(message); }
    }
    const api = {} as {Model: new (options: unknown) => {
        connect: (options: unknown) => void, flushMainMessages: () => void, destroy: () => void,
    }};
    const window = {location: {protocol: "https:", host: "local"}, siyuan: {isReady: false}};
    runInNewContext(transpileModule(readFileSync("src/layout/Model.ts", "utf8"), {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
    }).outputText, {exports: api, WebSocket: Socket, URL, clearTimeout: () => {}, window,
        document: {getElementById: (): null => null},
        require: (name: string) => {
            if (name === "../constants") return {Constants: {SIYUAN_APPID: "test"}};
            if (name === "../sync/checkoutProgress") return {
                reconcileSyncCheckout: (id: string, reconnect?: boolean) => queries.push({id, reconnect}),
            };
            if (name === "../util/kernelConnection") return {markKernelConnectionAlive: () => {}};
            if (name === "../config/setting/reset") return {reloadSettingsResetOnReconnect: () => false};
            if (name === "../config/setting/taskBlocker") return {resetSettingTaskRevision: () => {}};
            if (name === "../config/setting/sync") return {refreshSettingConfig: async () => {}};
            throw new Error(name);
        },
    });
    const model = new api.Model({app: {}});
    model.connect({id: "detached-window", type: "main"});
    assert.equal(new URL(sockets[0].url).searchParams.get("ready"), "false");
    sockets[0].onopen();
    assert.equal(messages.length, 0, "a connected window must not report readiness during initialization");
    window.siyuan.isReady = true;
    sockets[0].readyState = Socket.CONNECTING;
    model.flushMainMessages();
    assert.equal(messages.length, 0, "readiness must wait for the socket to open");
    sockets[0].readyState = 1;
    model.flushMainMessages();
    sockets[0].onopen();
    assert.deepEqual(messages.map(message => JSON.parse(message).cmd), ["ready", "ready"]);
    assert.deepEqual(queries, [{id: "detached-window", reconnect: undefined},
        {id: "detached-window", reconnect: undefined}, {id: "detached-window", reconnect: true}]);
    model.connect({id: "detached-window", type: "main"});
    assert.equal(new URL(sockets[1].url).searchParams.get("ready"), "false");
    sockets[1].onopen();
    assert.equal(JSON.parse(messages.at(-1)).cmd, "ready");
    model.destroy();
});

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

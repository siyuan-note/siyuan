import {test} from "node:test";
import * as assert from "node:assert/strict";
import type {BrowserWindow, IpcMainInvokeEvent} from "electron";
import {mockElectron, resetElectronStub} from "../fixtures/electronStub";
import {Channel} from "../shared/channels";
import type {windowCommandHandlers} from "./windowCommands";

test("opening a document in another window restores it before navigating", t => {
    t.after(resetElectronStub);
    const options = {rootID: "document", id: "block"};
    const calls: unknown[] = [];
    let minimized = true;
    const target = {
        isDestroyed: () => false,
        isMinimized: () => minimized,
        restore: () => {
            minimized = false;
            calls.push("restore");
        },
        focus: () => calls.push("focus"),
        show: () => calls.push("show"),
        webContents: {
            id: 2,
            isDestroyed: () => false,
            getURL: () => "http://127.0.0.1:6806/stage/build/app/window.html#document",
            send: (channel: string, data: unknown) => calls.push([channel, data]),
        },
    };
    mockElectron(t as Parameters<typeof mockElectron>[0], {
        BrowserWindow: {getAllWindows: () => [target]} as unknown as typeof BrowserWindow,
    });
    const handlers: typeof windowCommandHandlers = require("./windowCommands").windowCommandHandlers;
    const openFile = (rootID: string) => handlers[Channel.SIYUAN_OPEN_FILE]({
        event: {sender: {id: 1}} as IpcMainInvokeEvent,
        data: {cmd: Channel.SIYUAN_OPEN_FILE, options: JSON.stringify({...options, rootID}), port: "6806"},
        window: undefined,
        kernelTarget: undefined,
        isMainFrame: true,
        initialized: true,
        remoteSender: false,
    });

    assert.equal(openFile("missing"), false);
    assert.deepEqual(calls, []);
    assert.equal(openFile(options.rootID), true);
    assert.deepEqual(calls.splice(0), ["restore", "show", [Channel.SIYUAN_OPEN_FILE, options]]);
    assert.equal(openFile(options.rootID), true);
    assert.deepEqual(calls, ["show", [Channel.SIYUAN_OPEN_FILE, options]]);
});

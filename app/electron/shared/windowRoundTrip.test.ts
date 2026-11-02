import {EventEmitter} from "node:events";
import {test} from "node:test";
import {mockElectron, resetElectronStub} from "../fixtures/electronStub";
import type {BrowserWindow, IpcMain} from "electron";
const assert = require("node:assert/strict");

const CHANNEL = "test-round-trip-reply";

// 被测模块从 electron 取 ipcMain，首次加载前必须先换成这条用例的事件总线。
const roundTripModule = (t: any, ipc = new EventEmitter()) => {
    resetElectronStub();
    mockElectron(t, {ipcMain: ipc as unknown as IpcMain});
    return require("./windowRoundTrip");
};

type Peer = {
    window: BrowserWindow;
    /** 收到的请求，用来取出本轮的请求序号。 */
    sent: {cmd: string; data: number}[];
    /** 由主框架发出的回执事件；载荷另行传给 ipc.emit。 */
    reply: () => {sender: unknown; senderFrame: unknown};
};

const createPeer = (id: number, onSend?: () => void): Peer => {
    const sent: {cmd: string; data: number}[] = [];
    const mainFrame = {peer: id};
    const webContents = {
        id, mainFrame,
        send: (_channel: string, message: {cmd: string; data: number}) => {
            if (onSend) {
                onSend();
            }
            sent.push(message);
        },
    };
    return {
        window: {isDestroyed: () => false, webContents} as unknown as BrowserWindow,
        sent,
        reply: () => ({sender: webContents, senderFrame: mainFrame}),
    };
};

const options = (windows: BrowserWindow[], overrides: Record<string, unknown> = {}) => ({
    windows,
    channel: CHANNEL,
    command: "testRoundTrip",
    timeoutMs: 50,
    readRequestID: (payload: unknown) => payload as number,
    ...overrides,
});

test("every confirming window ends the round once and removes its listener", async (t) => {
    const ipc = new EventEmitter();
    const {requestFromWindows} = roundTripModule(t, ipc);
    const peers = [createPeer(1), createPeer(2)];
    const round = requestFromWindows(options(peers.map(peer => peer.window)));
    const requestID = peers[0].sent[0].data;
    assert.deepEqual(peers.map(peer => peer.sent[0].cmd), ["testRoundTrip", "testRoundTrip"]);
    for (const peer of peers) {
        ipc.emit(CHANNEL, peer.reply(), requestID);
    }
    assert.equal(await round, true);
    assert.equal(ipc.listenerCount(CHANNEL), 0);
});

test("stale, subframe and unregistered replies are ignored until the timeout", async (t) => {
    const ipc = new EventEmitter();
    const {requestFromWindows} = roundTripModule(t, ipc);
    const peer = createPeer(1);
    const round = requestFromWindows(options([peer.window], {timeoutMs: 20}));
    const requestID = peer.sent[0].data;
    ipc.emit(CHANNEL, peer.reply(), requestID + 1); // 上一轮的迟到回执
    ipc.emit(CHANNEL, {sender: peer.window.webContents, senderFrame: {sub: true}}, requestID); // 子帧
    ipc.emit(CHANNEL, {sender: {id: 9, mainFrame: {}}, senderFrame: {}}, requestID); // 未参与的窗口
    assert.equal(await round, false);
    assert.equal(ipc.listenerCount(CHANNEL), 0);
});

test("an unaccepted reply fails the round without waiting for the rest", async (t) => {
    const ipc = new EventEmitter();
    const {requestFromWindows} = roundTripModule(t, ipc);
    const peers = [createPeer(1), createPeer(2)];
    const round = requestFromWindows(options(peers.map(peer => peer.window), {
        // 与工作空间保存回执同形：载荷自带序号与结果。
        readRequestID: (payload: unknown) => (payload as {id?: number} | undefined)?.id,
        isAccepted: (payload: unknown) => (payload as {saved?: boolean}).saved === true,
    }));
    const requestID = peers[0].sent[0].data;
    ipc.emit(CHANNEL, peers[0].reply(), {id: requestID, saved: false});
    assert.equal(await round, false);
    assert.equal(ipc.listenerCount(CHANNEL), 0);
});

test("a failing send either drops that window or fails the whole round", async (t) => {
    const ipc = new EventEmitter();
    const {requestFromWindows} = roundTripModule(t, ipc);
    // 第二个窗口发送即抛错，第一个窗口正常确认。
    const dropped = [createPeer(1), createPeer(2, () => { throw new Error("destroyed"); })];
    const droppedRound = requestFromWindows(options(dropped.map(peer => peer.window), {skipFailedPeer: true}));
    const droppedID = dropped[0].sent[0].data;
    ipc.emit(CHANNEL, dropped[0].reply(), droppedID);
    assert.equal(await droppedRound, true);

    const strict = [createPeer(3), createPeer(4, () => { throw new Error("destroyed"); })];
    assert.equal(await requestFromWindows(options(strict.map(peer => peer.window))), false);
});

test("a round without participating windows confirms immediately", async (t) => {
    const ipc = new EventEmitter();
    const {requestFromWindows} = roundTripModule(t, ipc);
    const destroyed = {isDestroyed: () => true, webContents: {id: 1, send() {}}} as unknown as BrowserWindow;
    assert.equal(await requestFromWindows(options([destroyed])), true);
    assert.equal(ipc.listenerCount(CHANNEL), 0);
});

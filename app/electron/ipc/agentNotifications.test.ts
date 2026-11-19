import * as assert from "node:assert/strict";
import {EventEmitter} from "node:events";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";
import {parseAgentNotificationTarget, isAgentNotificationID} from "../../src/layout/dock/agent/agentNotificationTarget";
import {showWindow} from "../window/windowVisibility";

const compiled = transpileModule(readFileSync("electron/ipc/agentNotifications.ts", "utf8"), {
    compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2022},
}).outputText;

const fixture = () => {
    const notifications: FakeNotification[] = [];
    class FakeNotification extends EventEmitter {
        closed = 0;
        constructor(readonly options: unknown) { super(); notifications.push(this); }
        show() {}
        close() { this.closed++; }
    }
    const origins = new Map([[1, "http://first"], [2, "http://second"]]);
    const exports: any = {};
    runInNewContext(compiled, {
        exports,
        require: () => ({Notification: FakeNotification, showWindow, parseAgentNotificationTarget, isAgentNotificationID,
            Channel: {SIYUAN_AGENT_NOTIFICATION: "agent-click"},
            getWindowKernelTarget: (id: number) => origins.has(id) ? {origin: origins.get(id)} : undefined}),
    });
    const window = (id: number) => {
        const calls: unknown[] = [];
        let dead = false;
        let minimized = true;
        const sender = Object.assign(new EventEmitter(), {
            id, isDestroyed: () => dead,
            send: (channel: string, target: unknown) => calls.push([channel, target]),
        });
        const win = {
            webContents: sender, isDestroyed: () => dead, isMinimized: () => minimized,
            restore: () => { minimized = false; calls.push("restore"); },
            show: () => calls.push("show"), focus: () => calls.push("focus"),
        };
        return {win, sender, calls, destroy: () => { dead = true; sender.emit("destroyed"); }};
    };
    return {handle: exports.handleAgentNotification, notifications, origins, window};
};

const target = {sessionID: "session", kind: "question", interactionID: "question-1"};

test("Windows notification clicks restore only their original window and exact interaction", () => {
    const f = fixture();
    const first = f.window(1), second = f.window(2);
    f.handle(first.win, first.sender, {action: "show", title: "Pending", target});
    f.handle(second.win, second.sender, {action: "show", title: "Pending", target: {...target, sessionID: "other"}});
    f.notifications[0].emit("close", {reason: "timedOut"});
    f.notifications[0].emit("click");
    assert.deepEqual(first.calls, ["restore", "show", "focus", ["agent-click", target]]);
    assert.deepEqual(second.calls, []);
});

test("notifications reject invalid targets, foreign windows and unavailable workspace origins", () => {
    const f = fixture();
    const first = f.window(1), second = f.window(2);
    for (const invalid of [null, {}, {...target, kind: "approve"}, {...target, interactionID: "bad\nvalue"}]) {
        f.handle(first.win, first.sender, {action: "show", title: "Pending", target: invalid});
    }
    f.handle(second.win, first.sender, {action: "show", title: "Pending", target});
    f.origins.delete(1);
    f.handle(first.win, first.sender, {action: "show", title: "Pending", target});
    assert.equal(f.notifications.length, 0);
});

test("destroyed and reassigned notification owners cannot route clicks into another workspace", () => {
    for (const action of ["destroy", "origin"]) {
        const f = fixture(), first = f.window(1);
        f.handle(first.win, first.sender, {action: "show", title: "Pending", target});
        const old = f.notifications[0];
        if (action === "destroy") first.destroy();
        if (action === "origin") f.origins.set(1, "http://replacement");
        old.emit("click");
        assert.deepEqual(first.calls, [], action);
    }
});

test("a queued click racing notification removal still reaches frontend expiry validation", () => {
    const f = fixture(), first = f.window(1);
    f.handle(first.win, first.sender, {action: "show", title: "Pending", target});
    f.handle(first.win, first.sender, {action: "clear", sessionID: target.sessionID, target});
    f.notifications[0].emit("click");
    assert.deepEqual(first.calls.at(-1), ["agent-click", target]);
});

test("clearing one question retains the other session's notification", () => {
    const f = fixture(), first = f.window(1);
    f.handle(first.win, first.sender, {action: "show", title: "Pending", target});
    const other = {...target, sessionID: "other"};
    f.handle(first.win, first.sender, {action: "show", title: "Pending", target: other});
    f.handle(first.win, first.sender, {action: "clear", sessionID: target.sessionID});
    assert.equal(f.notifications[0].closed, 1);
    assert.equal(f.notifications[1].closed, 0);
    f.notifications[1].emit("click");
    assert.deepEqual(first.calls.at(-1), ["agent-click", other]);
});

import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";
import {parseAgentNotificationTarget} from "./agentNotificationTarget";

const target = {sessionID: "session", kind: "question", interactionID: "question"};

test("internal notification targets reject malformed IDs and discard extra behavior", () => {
    assert.equal(parseAgentNotificationTarget([]), undefined);
    assert.equal(parseAgentNotificationTarget({...target, interactionID: "x".repeat(513)}), undefined);
    assert.equal(parseAgentNotificationTarget({...target, sessionID: "bad\0session"}), undefined);
    assert.deepEqual(parseAgentNotificationTarget({...target, callback: "untrusted", approved: true}), target);
});

test("only Windows desktop receives an internal interaction route; other notification behavior is unchanged", () => {
    const compiled = transpileModule(readFileSync("src/layout/dock/agent/agentNotification.ts", "utf8"), {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2022},
    }).outputText;
    for (const platform of ["win32", "darwin", "linux"]) {
        const calls: unknown[] = [], ordinary: unknown[] = [];
        const exported: any = {};
        runInNewContext(compiled, {
            exports: exported, process: {platform},
            require: () => ({ipcRenderer: {send: (channel: string, data: unknown) => calls.push([channel, data])},
                Constants: {SIYUAN_CMD: "command"}, sendNotification: (value: unknown) => ordinary.push(value)}),
        });
        exported.notifyAgentInteraction("Pending", target);
        exported.clearAgentInteractionNotifications("session", target);
        assert.equal(calls.length, platform === "win32" ? 2 : 0);
        assert.equal(ordinary.length, platform === "win32" ? 0 : 1);
        if (platform === "win32") {
            assert.deepEqual(JSON.parse(JSON.stringify(calls[0])), ["command", {
                cmd: "agentNotification", action: "show", title: "Pending", target,
            }]);
        }
    }
});

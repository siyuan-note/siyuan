import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {dispatchPluginGlobalShortcut} from "./globalShortcut";

describe("plugin global shortcuts", () => {
    it("runs only the first matching command", () => {
        const calls: string[] = [];
        const plugins = ["first", "second"].map(name => ({
            commands: [{
                customHotkey: "⌘A",
                globalCallback: () => calls.push(name),
            }],
        }));

        assert.equal(dispatchPluginGlobalShortcut(plugins, "⌘A"), true);
        assert.deepEqual(calls, ["first"]);
    });

    it("ignores commands that do not match", () => {
        let calls = 0;
        const plugins = [{commands: [{customHotkey: "⌘A", globalCallback: () => calls++}]}];

        assert.equal(dispatchPluginGlobalShortcut(plugins, "⌘B"), false);
        assert.equal(calls, 0);
    });

    it("prefers execute and passes the global context", () => {
        const calls: string[] = [];
        let receivedContext: ICommandContext | undefined;
        const plugins = [{commands: [{
            customHotkey: "⌘A",
            execute: (context: ICommandContext) => {
                calls.push("execute");
                receivedContext = context;
            },
            globalCallback: () => calls.push("global"),
        }]}];

        assert.equal(dispatchPluginGlobalShortcut(plugins, "⌘A"), true);
        assert.deepEqual(calls, ["execute"]);
        assert.deepEqual(receivedContext, {source: "globalShortcut", focus: "global"});
    });
});

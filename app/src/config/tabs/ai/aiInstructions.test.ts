import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";

const setup = () => {
    const button = {disabled: false};
    const input = {disabled: false, rows: 0};
    let closed = false;
    let options: {value: string, multiline: boolean, onConfirm: (content: string, currentDialog: typeof dialog) => void};
    const dialog = {
        element: {querySelector: (selector: string) => selector === "textarea" ? input : button},
        destroy: () => { closed = true; },
    };
    const requests: {content: string, revision: string}[] = [];
    const messages: string[] = [];
    let finish: (success: boolean) => void;
    const exports = {} as {openAgentInstructions: () => void};
    runInNewContext(transpileModule(readFileSync("src/config/tabs/ai/aiInstructions.ts", "utf8"), {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2020},
    }).outputText, {
        exports,
        TextEncoder,
        window: {siyuan: {languages: {agentInstructionsTooLarge: "too large"}}},
        require: (name: string) => {
            if (name.endsWith("/inputDialog")) {
                return {openInputDialog: (value: typeof options) => { options = value; return dialog; }};
            }
            if (name.endsWith("/message")) {
                return {showMessage: (value: string) => messages.push(value)};
            }
            if (name.endsWith("/fetch")) {
                return {fetchPost: (path: string, data: typeof requests[number], callback: (result?: unknown) => void) => {
                    if (path.endsWith("getInstructions")) {
                        callback({data: {content: "original", revision: "revision-1"}});
                        return Promise.resolve();
                    }
                    requests.push(data);
                    return new Promise<void>(resolve => {
                        finish = success => { if (success) { callback(); } resolve(); };
                    });
                }};
            }
            throw new Error(name);
        },
    });
    exports.openAgentInstructions();
    return {button, input, requests, messages, options: () => options, closed: () => closed,
        save: (content: string) => options.onConfirm(content, dialog), finish: (success: boolean) => finish(success)};
};

test("instruction editor retains its revision and draft after a failed save", async () => {
    const editor = setup();
    assert.equal(editor.options().value, "original");
    assert.equal(editor.options().multiline, true);
    editor.save("draft");
    editor.save("duplicate");
    assert.equal(editor.requests.length, 1);
    assert.equal(editor.requests[0].revision, "revision-1");
    assert.equal(editor.input.disabled, true);
    editor.finish(false);
    await Promise.resolve();
    assert.equal(editor.closed(), false);
    assert.equal(editor.input.disabled, false);
    assert.equal(editor.button.disabled, false);
    editor.save("merged draft");
    assert.equal(editor.requests[1].revision, "revision-1");
    editor.finish(true);
    await Promise.resolve();
    assert.equal(editor.closed(), true);
});

test("instruction limit counts UTF-8 bytes and allows an empty file", async () => {
    const editor = setup();
    editor.save("界".repeat(11000));
    assert.equal(editor.messages[0], "too large");
    assert.equal(editor.requests.length, 0);
    editor.save("");
    assert.equal(editor.requests[0].content, "");
    editor.finish(true);
    await Promise.resolve();
    assert.equal(editor.closed(), true);
});

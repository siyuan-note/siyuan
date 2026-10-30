import {test} from "node:test";
import * as assert from "node:assert/strict";
import {memoryTaskErrorMessage} from "./taskError";

const messages = {target: "Specify the target", changed: "Content changed", partial: "Some updates were not saved",
    intent: "Clarify update or forget", generic: "Processing failed", model: {448: "Safe connection error", 450: "Safe authentication error", 459: "Safe overview error"}};

test("task and per-item failures map only exact known categories", () => {
    for (const [error, expected] of [
        ["memory request intent is ambiguous; clarify the update", messages.intent],
        ["memory proposal does not match forget intent", messages.intent],
        ["memory proposal does not match remember intent", messages.intent],
        ["forget request is ambiguous or not explicitly authorized", messages.intent],
        ["forget requires a direct unquoted manual request", messages.intent],
        ["submit memory saving and forgetting as separate requests", messages.intent],
        ["memory forget request found no matching target", messages.target],
        ["proposal identity does not match target", messages.target],
        ["proposal target not in verified snapshot", messages.target],
        ["forget target is not in verified snapshot", messages.target],
        ["forget target does not match verified snapshot", messages.target],
        ["memory revision conflict", messages.changed],
        ["memory has been withdrawn", messages.changed],
        ["memory proposal sources changed; retry explicitly", messages.changed],
        ["memory proposal sources changed before commit", messages.changed],
        ["forget target sources changed; retry explicitly", messages.changed],
        ["forget candidate snapshot changed; retry explicitly", messages.changed],
    ]) {
        assert.equal(memoryTaskErrorMessage({error}, messages), expected);
        assert.equal(memoryTaskErrorMessage({results: [{error}]}, messages), expected);
    }
});

test("partial failures retain saved-result context and deduplicate safe explanations", () => {
    const error = memoryTaskErrorMessage({error: "some memory proposals were not saved; saved memories remain available",
        results: [{saved: true}, {error: "proposal target not in verified snapshot"},
            {error: "proposal identity does not match target"}, {error: "memory revision conflict"}]}, messages);
    assert.equal(error, [messages.partial, messages.target, messages.changed].join("\n"));
    assert.equal(memoryTaskErrorMessage({results: [{saved: true}, {error: "private provider body /workspace/private"}]}, messages), messages.partial);
});

test("unknown errors and embedded known phrases never echo paths, input or provider response bodies", () => {
    for (const error of ["<img src=x onerror=bad>", "POST https://private.example/token?key=secret",
        "proposal target not in verified snapshot: private user input", "prefix memory revision conflict", "memory model error (999)"]) {
        assert.equal(memoryTaskErrorMessage({error, results: [{error}]}, messages), messages.generic);
    }
    assert.equal(memoryTaskErrorMessage({error: "private", results: [{error: "memory revision conflict"}]}, messages), messages.changed);
});

test("existing controlled model messages remain useful without accepting arbitrary model text", () => {
    for (const code of [448, 450, 459] as const) {
        assert.equal(memoryTaskErrorMessage({error: messages.model[code]}, messages), messages.model[code]);
        assert.equal(memoryTaskErrorMessage({error: `memory model error (${code})`}, messages), messages.generic);
    }
    assert.equal(memoryTaskErrorMessage({error: "Safe authentication error: secret response"}, messages), messages.generic);
});

test("notifications remain bounded even if many distinct controlled model errors are returned", () => {
    const model = Object.fromEntries(Array.from({length: 12}, (_, index) => [448 + index, `${index}: ${"x".repeat(600)}`]));
    const message = memoryTaskErrorMessage({results: Object.values(model).map(error => ({error}))}, {...messages, model});
    assert.equal(message.split("\n").length, 4);
    assert.ok(message.length <= 4 * 512 + 3);
});

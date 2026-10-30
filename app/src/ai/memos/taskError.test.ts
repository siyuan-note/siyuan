import {test} from "node:test";
import * as assert from "node:assert/strict";
import {readFileSync, readdirSync} from "node:fs";
import {memoryTaskErrorMessage} from "./taskError";

const messages = {target: "Specify the target", changed: "Content changed", partial: "Some updates were not saved",
    intent: "Clarify update or forget", limit: "Processing limit exceeded", read: "Unable to read all memory data",
    generic: "Processing failed", model: {448: "Safe connection error", 450: "Safe authentication error", 456: "Safe model output format error", 459: "Safe overview error"}};

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

test("production model-format failures, processing budgets and incomplete reads remain distinct", () => {
    for (const error of ["unknown memory proposal operation", "multiple memory actions target the same record",
        "duplicate memory proposal action", "unexpected trailing model output", "invalid forget verification",
        "invalid forget verification targets", "invalid memory forget selection", "invalid memory keyword response",
        "invalid memory validity timestamp", "memory validity timestamp is not explicit in evidence",
        "memory validity interval is empty or reversed", "proposal has no grounded evidence", "proposal scope is not permitted", "proposal source is invalid"]) {
        assert.equal(memoryTaskErrorMessage({error}, messages), messages.model[456]);
        assert.equal(memoryTaskErrorMessage({results: [{error}]}, messages), messages.model[456]);
    }
    for (const error of ["memory input exceeds selected model context budget", "memory proposal too large",
        "memory proposal exceeds batch budget", "memory candidate context exceeds budget; narrow the request",
        "forget verification context exceeds budget", "forget verification exceeds budget", "memory source exceeds processing budget",
        "memory sources exceed processing budget; select fewer blocks", "conversation source exceeds budget",
        "memory native source exceeds processing budget", "memory database columns exceed processing budget",
        "memory database rows exceed processing budget", "memory overview exceeds budget"]) {
        assert.equal(memoryTaskErrorMessage({error}, messages), messages.limit);
    }
    for (const error of ["memory scan incomplete", "memory scope scan incomplete", "memory search incomplete; narrow the source before retrying",
        "some memory records could not be validated", "memory overview scan incomplete", "memory overview sources require review",
        "memory native source unavailable", "memory source is unavailable or encrypted", "invalid memory database value"]) {
        assert.equal(memoryTaskErrorMessage({error}, messages), messages.read);
    }
    for (const error of ["memory candidate sources changed before model request", "memory saving cannot change an inactive forget target",
        "memory configuration changed; retry explicitly", "memory configuration changed", "memory workspace changed"]) {
        assert.equal(memoryTaskErrorMessage({error}, messages), messages.changed);
    }
});

test("every exact classified constant exists in the production memory implementation", () => {
    const source = readFileSync("src/ai/memos/taskError.ts", "utf8");
    const production = readdirSync("../kernel/model").filter(file => /^ai_memory.*\.go$/.test(file) && !file.endsWith("_test.go"))
        .map(file => readFileSync(`../kernel/model/${file}`, "utf8")).join("\n") + readFileSync("../kernel/memo/record.go", "utf8");
    for (const match of source.matchAll(/\["([^"]+)", "(?:target|changed|partial|intent|format|limit|read)"\]/g)) {
        assert.ok(production.includes(`"${match[1]}"`), `Missing production constant: ${match[1]}`);
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

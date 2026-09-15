import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {join} from "node:path";
import test from "node:test";
import {runInNewContext} from "node:vm";
import * as ts from "typescript";

const dropDocuments = (paths: string[], targetPath: string) => {
    const source = readFileSync(join(__dirname, "Files.ts"), "utf8");
    const start = source.indexOf("const selectRootElements: HTMLElement[] = [];");
    const end = source.indexOf("if (newElement.classList.contains(\"dragover__bottom\")", start);
    assert.ok(start >= 0 && end > start);
    const messages: {message: string, timeout: number, type: string}[] = [];
    const requests: {fromPaths: string[], toPath: string}[] = [];
    const classes = new Set(["dragover"]);
    const rows = paths.map((path) => ({
        dataset: {path},
        getAttribute: (name: string) => name === "data-path" ? path :
            name === "data-type" ? "navigation-file" : "notebook",
    }));
    const script = ts.transpileModule(`(function () {${source.slice(start, end)}}).call(panel);`, {
        compilerOptions: {target: ts.ScriptTarget.ES2020},
    }).outputText;
    runInNewContext(script, {
        panel: {element: {querySelectorAll: () => rows}},
        newElement: {
            getAttribute: () => targetPath,
            classList: {
                contains: (name: string) => classes.has(name),
                remove: (...names: string[]) => names.forEach((name) => classes.delete(name)),
            },
        },
        toURL: "notebook",
        toPath: targetPath,
        window: {siyuan: {languages: {_kernel: {87: "Cannot move to this location"}}}},
        showMessage: (message: string, timeout: number, type: string) => messages.push({message, timeout, type}),
        isMoveTargetAllowed: () => true,
        fetchPost: (_url: string, body: {fromPaths: string[], toPath: string}) => requests.push(body),
    });
    return {messages, requests, classes};
};

test("dropping a document into itself or descendants reports an invalid target without sending an empty move", () => {
    for (const target of ["/parent.sy", "/parent/child.sy", "/parent/child/grandchild.sy"]) {
        for (const sources of [["/parent.sy"], ["/other.sy", "/parent.sy"]]) {
            const result = dropDocuments(sources, target);
            assert.deepEqual(result.messages, [{message: "Cannot move to this location", timeout: 7000, type: "error"}]);
            assert.equal(result.requests.length, 0);
            assert.equal(result.classes.size, 0);
        }
    }
});

test("dropping documents into another document retains the selected source paths", () => {
    const result = dropDocuments(["/parent.sy", "/parent/child.sy", "/other.sy"], "/target.sy");
    assert.deepEqual(result.messages, []);
    assert.equal(result.requests.length, 1);
    assert.deepEqual(Array.from(result.requests[0].fromPaths), ["/parent.sy", "/other.sy"]);
    assert.equal(result.requests[0].toPath, "/target.sy");
    assert.equal(result.classes.size, 0);
});

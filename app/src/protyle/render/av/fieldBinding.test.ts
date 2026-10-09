import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {join} from "node:path";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ScriptTarget, transpileModule} from "typescript";

test("hidden primary binding survives path selection and releases removed or replaced targets", () => {
    const source = readFileSync(join(__dirname, "batchEdit.ts"), "utf8");
    const code = transpileModule(source.substring(source.indexOf("export const openAVFieldBinding"))
        .replace("export const", "const") + "\nopenAVFieldBinding;", {
        compilerOptions: {target: ScriptTarget.ES2020},
    }).outputText;
    for (const reason of ["path-selection", "removed", "replaced", "readonly"]) {
        let hidden = false;
        let destroyed = 0;
        let disconnected = 0;
        let callback: () => void;
        const field = {isConnected: true, dataset: {cellValue: encodeURIComponent(JSON.stringify({block: {content: " Primary "}}))}};
        const hint = {classList: {contains: () => hidden}};
        const protyle = {toolbar: {range: {startContainer: field as unknown}}, hint: {element: hint}};
        const open = runInNewContext(code, {
            createBatchEditContext: () => ({cellElements: [field], destroy: () => { destroyed++; }}),
            openAVBindBlock: (owner: unknown, target: unknown, query: string) => {
                assert.equal(owner, protyle);
                assert.equal(target, field);
                assert.equal(query, "Primary");
                return reason !== "readonly";
            },
            MutationObserver: class {
                constructor(listener: () => void) { callback = listener; }
                observe() {}
                disconnect() { disconnected++; }
            },
        });
        open({protyle, blockElement: {}});
        if (reason === "readonly") {
            assert.equal(callback, undefined);
        } else {
            callback();
            assert.equal(destroyed, 0);
            if (reason === "path-selection") {
                hidden = true;
                callback();
                assert.equal(destroyed, 0);
                field.isConnected = false;
            }
            if (reason === "removed") {
                field.isConnected = false;
            }
            if (reason === "replaced") {
                protyle.toolbar.range.startContainer = {};
            }
            callback();
            assert.equal(disconnected, 1);
        }
        assert.equal(destroyed, 1);
    }
});

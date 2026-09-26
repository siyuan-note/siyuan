import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {join} from "node:path";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {transpileModule, ModuleKind, ScriptTarget} from "typescript";

test("date inputs keep native arrow keys while allowing Escape to close the panel", () => {
    const inputs = Array.from({length: 4}, () => {
        const listeners = new Map<string, Array<(event: unknown) => void>>();
        return {
            value: "2026-09-26",
            addEventListener(type: string, listener: (event: unknown) => void) {
                listeners.set(type, [...(listeners.get(type) || []), listener]);
            },
            listeners,
        };
    });
    const exports = {} as typeof import("./date");
    runInNewContext(transpileModule(readFileSync(join(__dirname, "date.ts"), "utf8"), {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2020},
    }).outputText, {exports, require: () => ({})});
    exports.bindDateEvent({menuElement: {querySelectorAll: () => inputs}} as unknown as
        Parameters<typeof exports.bindDateEvent>[0]);
    for (const input of inputs.slice(0, 2)) {
        for (const key of ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Escape"]) {
            let stopped = false;
            let prevented = false;
            const event = {key, stopPropagation() { stopped = true; }, preventDefault() { prevented = true; }};
            input.listeners.get("keydown")!.forEach(listener => listener(event));
            assert.equal(stopped, key !== "Escape");
            assert.equal(prevented, false);
        }
    }
});

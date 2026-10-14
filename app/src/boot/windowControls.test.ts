import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";

test("shared window state restores controls and macOS spacing after fullscreen and maximization", () => {
    const code = transpileModule(readFileSync("src/boot/windowControls.ts", "utf8"), {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
    }).outputText;
    const classes = new Set<string>();
    const spacing: number[] = [];
    const dependencies = {Constants: {LOCAL_ZOOM: "zoom"}, setToolbarLeftMac: (zoom: number) => spacing.push(zoom)};
    const exports = {} as {applyWindowState: (command: string) => void};
    runInNewContext(code, {exports, require: () => dependencies, window: {siyuan: {storage: {zoom: 0.8}}},
        document: {body: {classList: {add: (name: string) => classes.add(name), remove: (name: string) => classes.delete(name),
            toggle: (name: string, active: boolean) => active ? classes.add(name) : classes.delete(name)}}}});
    exports.applyWindowState("blur");
    assert.equal(classes.has("body--blur"), true);
    exports.applyWindowState("focus");
    assert.equal(classes.has("body--blur"), false);
    exports.applyWindowState("maximize");
    assert.equal(classes.has("body--maximize"), true);
    exports.applyWindowState("unmaximize");
    assert.equal(classes.has("body--maximize"), false);
    exports.applyWindowState("enter-full-screen");
    assert.equal(classes.has("body--fullscreen"), true);
    exports.applyWindowState("leave-full-screen");
    assert.equal(classes.has("body--fullscreen"), false);
    assert.deepEqual(spacing, [0.8, 0.8]);
});

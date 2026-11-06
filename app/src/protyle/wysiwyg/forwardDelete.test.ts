import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import * as path from "node:path";
import {test} from "node:test";
import {ScriptTarget, transpileModule} from "typescript";
import {matchShortcut} from "../../util/shortcut";

test("Enter waits for forward deletion and preserves modifiers when replayed after caret restoration", async () => {
    const source = readFileSync(path.join(__dirname, "keydown.ts"), "utf8");
    const start = source.indexOf('        if (forwardBlockRemovalPending && event.key === "Enter" && !event.isComposing)');
    const end = source.indexOf('        if (event.target.localName === "protyle-html"', start);
    assert.ok(start > 0 && end > start);
    const body = transpileModule(source.slice(start, end), {compilerOptions: {target: ScriptTarget.ES2022}}).outputText;
    for (const available of [true, false]) {
        let complete: (value: boolean) => void;
        const pending = new Promise<boolean>(resolve => {complete = resolve;});
        const events: Array<{key: string; shiftKey: boolean}> = [];
        const editor = {isConnected: available, dispatchEvent: (event: {key: string; shiftKey: boolean}) => events.push(event)};
        const protyle = {disabled: false};
        const run = new Function("forwardBlockRemovalPending", "forwardBlockRemovalComplete", "editorElement", "protyle",
            "KeyboardEvent", `return async event => {${body}};`)(true, pending, editor, protyle,
            class {constructor(_type: string, options: object) {Object.assign(this, options);}});
        let prevented = false;
        let stopped = false;
        const result = run({key: "Enter", code: "Enter", keyCode: 13, shiftKey: true,
            preventDefault: () => {prevented = true;}, stopPropagation: () => {stopped = true;}});
        assert.ok(prevented && stopped);
        assert.deepEqual(events, [], "the original Enter cannot split a paragraph awaiting removal");
        complete(true);
        await result;
        assert.equal(events.length, available ? 1 : 0, "destroyed editors cannot receive queued input");
        if (available) {
            assert.equal(events[0].key, "Enter");
            assert.equal(events[0].shiftKey, true);
            assert.ok(matchShortcut("⇧↩", events[0] as KeyboardEvent, {mac: false, keyCodes: {13: "↩"}}));
        }
    }
});

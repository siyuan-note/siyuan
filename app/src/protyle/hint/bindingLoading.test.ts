import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {join} from "node:path";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {createSourceFile, isClassDeclaration, ScriptTarget, transpileModule} from "typescript";

test("panel binding loads at its field and dismisses only on outside pointer events", () => {
    const source = createSourceFile("index.ts", readFileSync(join(__dirname, "index.ts"), "utf8"), ScriptTarget.Latest);
    const declaration = source.statements.find(node => isClassDeclaration(node) && node.name.text === "Hint");
    assert.ok(declaration && isClassDeclaration(declaration));
    const methods = declaration.members.filter(member =>
        ["genLoading", "cancelLoadingAnimation", "destroy"].includes(member.name?.getText(source)))
        .map(member => member.getText(source)).join("\n");
    const document = new EventTarget();
    const classes = new Set(["fn__none"]);
    const input = {};
    const positions: number[][] = [];
    const mobilePositions: number[][] = [];
    const element = {
        classList: {contains: (name: string) => classes.has(name),
            add: (name: string) => classes.add(name), remove: (name: string) => classes.delete(name)},
        contains: (target: unknown) => target === input,
        querySelector: () => ({}),
    };
    const hint = runInNewContext(transpileModule(`class Hint {
        destroyEmojiPanel() {}
        setMobilePosition(...position) { mobilePositions.push(position); }
        ${methods}
    }
    new Hint();`, {compilerOptions: {target: ScriptTarget.ES2020}}).outputText, {
        document, AbortController, mobilePositions,
        getAVBindingCell: () => ({dataset: {rowId: "item"},
            getBoundingClientRect: () => ({left: 100, top: 200, bottom: 234, height: 34})}),
        getSelectionPosition: () => { throw new Error("Detached editor has no selection"); },
        setPosition: (_element: unknown, ...position: number[]) => positions.push(position),
    });
    hint.element = element;
    const protyle = {toolbar: {range: {}}, wysiwyg: {element: {}}};
    hint.genLoading(protyle, 0, "av");
    assert.deepEqual(positions, [[100, 234, 34]]);
    assert.deepEqual(JSON.parse(JSON.stringify(mobilePositions)), [[200, 234]]);
    const inside = new Event("pointerdown");
    Object.defineProperty(inside, "target", {value: input});
    document.dispatchEvent(inside);
    assert.equal(classes.has("fn__none"), false);
    document.dispatchEvent(new Event("pointerdown"));
    assert.equal(classes.has("fn__none"), true);
    hint.genLoading(protyle, 0, "av");
    hint.destroy();
    document.dispatchEvent(new Event("pointerdown"));
    assert.equal(classes.has("fn__none"), false);
});

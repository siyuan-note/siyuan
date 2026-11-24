import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {join} from "node:path";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {createSourceFile, isClassDeclaration, ScriptTarget, transpileModule} from "typescript";
import {getCreateTargetContext, isSameCreateTargetContext} from "./createTargetContext";

const verifyBindingDismissal = (dataset: Record<string, string>) => {
    const source = createSourceFile("index.ts", readFileSync(join(__dirname, "index.ts"), "utf8"), ScriptTarget.Latest);
    const declaration = source.statements.find(node => isClassDeclaration(node) && node.name.text === "Hint");
    assert.ok(declaration && isClassDeclaration(declaration));
    const methods = declaration.members.filter(member =>
        ["loadingID", "genLoading", "cancelLoadingAnimation", "destroy"].includes(member.name?.getText(source)))
        .map(member => member.getText(source)).join("\n");
    const document = new EventTarget();
    const classes = new Set(["fn__none"]);
    const input = {};
    const loader = {};
    const positions: number[][] = [];
    const mobilePositions: number[][] = [];
    const element = {
        classList: {contains: (name: string) => classes.has(name),
            add: (name: string) => classes.add(name), remove: (name: string) => classes.delete(name)},
        isConnected: true,
        contains: (target: unknown) => target === input || target === loader,
        querySelector: () => loader,
    };
    const hint = runInNewContext(transpileModule(`class Hint {
        destroyEmojiPanel() {}
        setMobilePosition(...position) { mobilePositions.push(position); }
        ${methods}
    }
    new Hint();`, {compilerOptions: {target: ScriptTarget.ES2020}}).outputText, {
        document, AbortController, mobilePositions, getCreateTargetContext, isSameCreateTargetContext,
        getAVBindingCell: () => ({dataset, isConnected: true,
            getBoundingClientRect: () => ({left: 100, top: 200, bottom: 234, height: 34})}),
        getSelectionPosition: () => { throw new Error("Detached editor has no selection"); },
        setPosition: (_element: unknown, ...position: number[]) => positions.push(position),
    });
    hint.element = element;
    const protyle = {block: {rootID: "root"}, toolbar: {range: {}}, wysiwyg: {element: {}}};
    const isCurrent = hint.genLoading(protyle, 0, "av");
    assert.deepEqual(positions, [[100, 234, 34]]);
    assert.deepEqual(JSON.parse(JSON.stringify(mobilePositions)), [[200, 234]]);
    const inside = new Event("pointerdown");
    Object.defineProperty(inside, "target", {value: input});
    document.dispatchEvent(inside);
    assert.equal(classes.has("fn__none"), false);
    assert.equal(isCurrent(), true);
    document.dispatchEvent(new Event("pointerdown"));
    assert.equal(classes.has("fn__none"), true);
    assert.equal(isCurrent(), false);
    hint.genLoading(protyle, 0, "av");
    hint.destroy();
    document.dispatchEvent(new Event("pointerdown"));
    assert.equal(classes.has("fn__none"), false);
};

test("panel binding loads at its field and dismisses only on outside pointer events", () => {
    verifyBindingDismissal({rowId: "item"});
});

test("table binding dismisses outside even when the row ID is on the parent", () => {
    verifyBindingDismissal({});
});

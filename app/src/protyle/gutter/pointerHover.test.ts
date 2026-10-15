import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {createSourceFile, forEachChild, isCallExpression, ScriptTarget, transpileModule} from "typescript";

const source = createSourceFile("index.ts", readFileSync(__dirname + "/index.ts", "utf8"), ScriptTarget.ES2021, true);
const listeners: string[] = [];
const collect = (node: import("typescript").Node) => {
    if (isCallExpression(node) && node.expression.getText(source) === "this.element.addEventListener" &&
        ["\"mouseleave\"", "\"pointerleave\"", "\"pointermove\"", "\"pointerdown\""].includes(node.arguments[0].getText(source))) {
        if (node.arguments[0].getText(source) === "\"pointerdown\"" && !node.getText(source).includes("hidePlusTimeout")) {
            return;
        }
        listeners.push(node.getText(source));
    }
    forEachChild(node, collect);
};
collect(source);

test("touch after mouse hover preserves gutter targets until click", () => {
    const element = new EventTarget();
    let hidden = 0;
    const timers: (() => void)[] = [];
    const js = transpileModule("let hidePlusTimeout;\n" + listeners.join("\n"), {
        compilerOptions: {target: ScriptTarget.ES2021}
    }).outputText;
    new Function("hideInsert", "window", "protyle", js).call({element}, () => hidden++, {
        clearTimeout: () => timers.splice(0),
        setTimeout: (callback: () => void) => timers.push(callback)
    }, {wysiwyg: {element: {querySelectorAll: (): Element[] => []}}});
    const dispatch = (type: string, pointerType?: string) => {
        const event = new Event(type);
        Object.defineProperty(event, "pointerType", {value: pointerType});
        element.dispatchEvent(event);
    };
    dispatch("pointerdown", "touch");
    dispatch("mouseleave");
    dispatch("pointermove", "touch");
    dispatch("pointerup", "touch");
    dispatch("pointerleave", "touch");
    timers.forEach(callback => callback());
    assert.equal(hidden, 0);
    assert.equal(timers.length, 0);
    dispatch("click");
    dispatch("pointerleave", "mouse");
    assert.equal(timers.length, 1);
    timers.forEach(callback => callback());
    assert.equal(hidden, 1);
    dispatch("pointerleave", "mouse");
    dispatch("pointerdown", "touch");
    timers.forEach(callback => callback());
    assert.equal(hidden, 1, "touch cancels the pending insertion-control hide before a longer tap");
});

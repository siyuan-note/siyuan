import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {createSourceFile, forEachChild, isCallExpression, ScriptTarget, transpileModule} from "typescript";

const source = createSourceFile("AgentChat.ts", readFileSync("src/layout/dock/agent/AgentChat.ts", "utf8"),
    ScriptTarget.Latest, true);
let handlerSource: string;
const visit = (node: import("typescript").Node) => {
    if (isCallExpression(node) && node.expression.getText(source) === "this.panelElement.addEventListener" &&
        node.arguments[0].getText(source) === '"click"') {
        handlerSource = node.arguments[1].getText(source);
    }
    forEachChild(node, visit);
};
visit(source);
assert.ok(handlerSource);
const compiled = transpileModule(`(function () { return ${handlerSource}; })`, {
    compilerOptions: {target: ScriptTarget.ES2021},
}).outputText;

const clickPanel = (closestClass?: string) => {
    let composerFocus = 0;
    const panelElement = {isEqualNode: (element: unknown) => element === panelElement};
    const target = {
        parentElement: panelElement,
        isEqualNode: (element: unknown) => element === target,
        classList: {contains: () => false},
        closest: (selector: string) => selector.split(", ").includes(closestClass) ? target : null,
    };
    const chat = {panelElement, host: {}, composer: {focus: () => composerFocus++}};
    const handler = runInNewContext(compiled).call(chat);
    handler({target});
    return composerFocus;
};

test("clicking composer content preserves the native editable focus", () => {
    assert.equal(clickPanel(".protyle-wysiwyg"), 0);
});

test("clicking an editor utility preserves its input focus", () => {
    assert.equal(clickPanel(".protyle-util"), 0);
});

test("clicking empty panel space still focuses the composer", () => {
    assert.equal(clickPanel(), 1);
});

import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {join} from "node:path";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {createSourceFile, forEachChild, isCallExpression, Node, ScriptTarget, transpileModule} from "typescript";

const file = createSourceFile("index.ts", readFileSync(join(__dirname, "index.ts"), "utf8"), ScriptTarget.Latest, true);
const listeners = new Map<string, string>();
const visit = (node: Node) => {
    if (isCallExpression(node) && node.expression.getText(file) === "this.element.addEventListener" &&
        ["\"input\"", "\"compositionend\""].includes(node.arguments[0]?.getText(file))) {
        listeners.set(JSON.parse(node.arguments[0].getText(file)), transpileModule("const listener = (" + node.arguments[1].getText(file) + ");", {
            compilerOptions: {target: ScriptTarget.ES2020},
        }).outputText);
    }
    forEachChild(node, visit);
};
visit(file);

test("reference bracket input waits for IME commit and avoids saving duplicate closing brackets", async () => {
    for (const type of ["input", "compositionend"]) {
        for (const data of ["【", "【【", "【】", "】", "】】"]) {
            const calls: string[] = [];
            const range = {startContainer: {}};
            const block = {closest: (): undefined => undefined, getAttribute: () => "block"};
            const consumed = data.startsWith("】");
            const context: Record<string, unknown> = {
                lineBreakUndoContext: undefined, forwardDeleteUndoContext: undefined,
                isComposition: type === "compositionend", recoveredComposition: false,
                crossBlockComposition: undefined, beforeInputCompositionHandled: false,
                compositionSnapshot: undefined, compositionRange: undefined,
                compositionInputText: "",
                getAVTemplateInteractiveElement: (): undefined => undefined,
                getEditorRange: () => range, hasClosestBlock: () => block,
                isCommittedTextInput: (event: InputEvent) => !event.isComposing && event.inputType === "insertText",
                normalizeInlineElementBoundaries: (): undefined => undefined, renderLongTextRuns: (): undefined => undefined,
                isMac: () => false, input: () => calls.push("save"),
                protyle: {wysiwyg: {lastHTMLs: {}}, hint: {enableExtend: false, handleRefBracketInput: (_protyle: unknown, actual: unknown, text: string) => {
                    assert.equal(actual, range);
                    assert.equal(text, data);
                    calls.push("brackets");
                    return consumed;
                }}},
            };
            const receiver = {
                element: {}, lastHTMLs: {},
                escapeInline: (): undefined => undefined,
                scheduleInput: (callback: () => void) => callback(),
                runInput: (callback: () => void) => callback(),
            };
            const event = {data, inputType: "insertText", isComposing: false,
                target: {tagName: "DIV"}, stopPropagation() {}};
            const listener = runInNewContext("(function () { " + listeners.get(type) + " return listener; }).call(receiver)",
                Object.assign(context, {receiver}));
            if (type === "input") {
                await listener.call(receiver, {...event, isComposing: true, inputType: "insertCompositionText"});
                assert.deepEqual(calls, []);
            }
            await listener.call(receiver, event);
            assert.deepEqual(calls, consumed ? ["brackets"] : ["brackets", "save"]);
            if (type === "compositionend") {
                calls.length = 0;
                context.compositionRange = {hasRetainedText: () => true};
                context.compositionInputText = data;
                await listener.call(receiver, {...event, data: ""});
                assert.deepEqual(calls, consumed ? ["brackets"] : ["brackets", "save"]);
                context.recoveredComposition = true;
                await listener.call(receiver, event);
                assert.deepEqual(calls, consumed ? ["brackets"] : ["brackets", "save"]);
                context.recoveredComposition = false;
                context.compositionRange = undefined;
                calls.length = 0;
                await listener.call(receiver, {...event, data: ""});
                assert.deepEqual(calls, []);
            }
        }
    }
});

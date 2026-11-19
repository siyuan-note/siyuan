import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {createSourceFile, isCallExpression, ScriptTarget, transpileModule} from "typescript";

const source = createSourceFile("index.ts", readFileSync("src/layout/dock/index.ts", "utf8"), ScriptTarget.Latest, true);
let listener = "";
const visit = (node: import("typescript").Node) => {
    if (isCallExpression(node) && node.expression.getText(source) ===
        'this.layout.element.querySelector(".layout__dockresize").addEventListener') {
        listener = node.arguments[1].getText(source);
    }
    node.forEachChild(visit);
};
visit(source);
assert.ok(listener);
const code = transpileModule(`return (${listener});`, {compilerOptions: {target: ScriptTarget.ES2021}}).outputText;

test("dock resizing clamps overshooting pointer samples to the same minimum on every edge", () => {
    for (const position of ["Left", "Right", "Bottom"]) {
        for (const minimum of position === "Bottom" ? [64] : [180, 240]) {
            for (const samples of [[50, 90, 500], [1000], [20, 180, 300, 1000]]) {
                const document = {onmousemove: undefined as (event: unknown) => void, onmouseup: undefined as () => void};
                const style: Record<string, string> = {};
                let prepared = 0;
                let saves = 0;
                const dock = {position, layout: {element: {clientWidth: 300, clientHeight: 300, style}},
                    getResponsiveMinimumSize: () => minimum,
                    prepareForManualResize: () => prepared++, setSize: () => saves++,
                    elements: [{querySelectorAll: (): unknown[] => []}, {querySelectorAll: (): unknown[] => []}]};
                const handler = new Function("document", code).call(dock, document);
                handler({clientX: 500, clientY: 500});
                assert.equal(prepared, 0);
                for (const delta of samples) {
                    document.onmousemove({clientX: position === "Left" ? 500 - delta : 500 + delta,
                        clientY: 500 + delta, preventDefault() {}, stopPropagation() {}});
                    assert.equal(style[position === "Bottom" ? "height" : "width"], `${Math.max(minimum, 300 - delta)}px`);
                }
                assert.equal(style[position === "Bottom" ? "height" : "width"], `${minimum}px`);
                assert.equal(prepared, 1);
                document.onmouseup();
                assert.equal(saves, 1);
                assert.equal(document.onmousemove, null);
                assert.equal(document.onmouseup, null);
            }
        }
    }
});

test("floating docks return to their initial minimum after growing in the same drag", () => {
    for (const position of ["Left", "Right", "Bottom"]) {
        const minimum = position === "Bottom" ? 64 : 232;
        const document = {onmousemove: undefined as (event: unknown) => void, onmouseup: undefined as () => void};
        const style: Record<string, string> = {};
        const dock = {position, layout: {element: {clientWidth: minimum, clientHeight: minimum, style}},
            getResponsiveMinimumSize: () => minimum, prepareForManualResize() {}, setSize() {},
            elements: [{querySelectorAll: (): unknown[] => []}, {querySelectorAll: (): unknown[] => []}]};
        new Function("document", code).call(dock, document)({clientX: 500, clientY: 500});
        for (const growth of [100, 0, -500]) {
            document.onmousemove({clientX: position === "Left" ? 500 + growth : 500 - growth,
                clientY: 500 - growth, preventDefault() {}, stopPropagation() {}});
            assert.equal(style[position === "Bottom" ? "height" : "width"], `${minimum + Math.max(0, growth)}px`);
        }
        document.onmouseup();
    }
});

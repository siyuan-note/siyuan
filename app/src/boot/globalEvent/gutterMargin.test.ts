import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";

const compiled = transpileModule(readFileSync(__dirname + "/mousemove.ts", "utf8"), {
    compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
}).outputText;

const fixture = (paddingLeft: string, hasBlock = true) => {
    const root = {
        nodeType: 1, style: {},
        classList: {contains: (cls: string) => cls === "protyle-wysiwyg"},
        getBoundingClientRect: () => ({left: 100}),
    };
    const block = {classList: {contains: () => false}, getBoundingClientRect: () => ({left: 196})};
    const hits: number[][] = [];
    const rendered: unknown[] = [];
    const protyle = {wysiwyg: {element: root}, gutter: {render: (_owner: unknown, target: unknown) => rendered.push(target)}};
    const exports = {} as typeof import("./mousemove");
    runInNewContext(compiled, {
        exports,
        window: {siyuan: {layout: {}, blockPanels: []}},
        document: {
            body: {classList: {contains: () => false}},
            getElementById: (): null => null,
            elementFromPoint: (x: number, y: number) => { hits.push([x, y]); return hasBlock ? block : null; },
        },
        getComputedStyle: () => ({paddingLeft}),
        require: () => ({
            hasClosestBlock: (target: unknown) => target,
            getAllModels: () => ({editor: [{editor: {protyle}}], backlink: [] as unknown[]}),
        }),
    });
    const move = (x: number) => exports.windowMouseMove({
        clientX: x, clientY: 210, target: root, composedPath: () => [root],
    } as unknown as MouseEvent);
    return {move, hits, rendered, block};
};

test("hovering either editor margin restores a gutter with stylesheet padding and no inline padding", () => {
    for (const x of [180, 900]) {
        const f = fixture("96px");
        f.move(x);
        assert.deepEqual(f.hits, [[209, 210]]);
        assert.deepEqual(f.rendered, [f.block]);
    }
});

test("margin hit testing preserves fractional and zero computed padding", () => {
    for (const [padding, x] of [["24.5px", 137.5], ["0px", 113]] as const) {
        const f = fixture(padding);
        f.move(101);
        assert.deepEqual(f.hits, [[x, 210]]);
        assert.deepEqual(f.rendered, [f.block]);
    }
});

test("blank space below the last block does not invent a gutter target", () => {
    const f = fixture("96px", false);
    f.move(180);
    assert.deepEqual(f.rendered, []);
});

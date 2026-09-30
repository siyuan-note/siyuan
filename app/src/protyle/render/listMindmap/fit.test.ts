import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {createSourceFile, isClassDeclaration, ScriptTarget, transpileModule} from "typescript";

const source = createSourceFile("view.ts", readFileSync("src/protyle/render/listMindmap/view.ts", "utf8"),
    ScriptTarget.ES2021, true);
const view = source.statements.find(item => isClassDeclaration(item) && item.name?.text === "ListMindmapView");
assert.ok(view && isClassDeclaration(view));
const fit = view.members.find(item => item.name?.getText(source) === "fit");
assert.ok(fit);
const compiled = transpileModule(`class View {
    ${fit.getText(source)}
}
globalThis.View = View;`, {compilerOptions: {target: ScriptTarget.ES2021}}).outputText;

const setup = (right = 200, bottom = 100) => {
    const context: any = {};
    runInNewContext(compiled, context);
    const target = new context.View();
    Object.assign(target, {
        scale: 2.5, offsetX: -200, offsetY: 150,
        viewport: {clientWidth: 800, clientHeight: 420},
        positions: new Map([["root", {}]]),
        contentBounds: () => ({left: 20, top: 10, right, bottom}),
        draw: () => {},
    });
    return target;
};

const transform = (target: ReturnType<typeof setup>) => [target.scale, target.offsetX, target.offsetY];

test("fit restores a small map to its initial scale and centered position", () => {
    const target = setup();
    target.fit(1);
    const initial = transform(target);
    Object.assign(target, {scale: 2.5, offsetX: -200, offsetY: 150});
    target.fit();
    assert.deepEqual(transform(target), initial);
    assert.equal(target.scale, 1);
    assert.equal(target.offsetX, 290);
    assert.equal(target.offsetY, 142);
    target.fit();
    assert.deepEqual(transform(target), initial, "repeated fitting is stable");
});

test("fit still shrinks large maps and adapts to the current viewport", () => {
    const target = setup(2020, 1010);
    target.fit();
    assert.equal(target.scale, .362);
    assert.equal((20 + 2020) / 2 * target.scale + target.offsetX, 400);
    assert.equal((10 + 1010) / 2 * target.scale + target.offsetY, 197);
    target.viewport.clientWidth = 360;
    target.viewport.clientHeight = 300;
    target.fit();
    assert.equal(target.scale, .156);
    assert.equal((20 + 2020) / 2 * target.scale + target.offsetX, 180);
    assert.equal((10 + 1010) / 2 * target.scale + target.offsetY, 137);
});

test("fit keeps the existing minimum zoom and ignores an unavailable canvas", () => {
    const target = setup(10020, 10010);
    target.fit();
    assert.equal(target.scale, .15);
    const fitted = transform(target);
    target.viewport.clientWidth = 0;
    target.fit();
    assert.deepEqual(transform(target), fitted);
    target.viewport.clientWidth = 800;
    target.positions.clear();
    target.fit();
    assert.deepEqual(transform(target), fitted);
});

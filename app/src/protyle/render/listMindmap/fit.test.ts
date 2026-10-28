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
        options: {host: {classList: {contains: () => false}}},
        viewport: {clientWidth: 800, clientHeight: 420, offsetHeight: 420,
            getBoundingClientRect: () => ({left: 0, top: 0, right: 800, bottom: 420, width: 800, height: 420})},
        getToolbarBounds: (): unknown[] => [],
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
    assert.equal(target.offsetY, 155);
    target.fit();
    assert.deepEqual(transform(target), initial, "repeated fitting is stable");
});

test("fit still shrinks large maps and adapts to the current viewport", () => {
    const target = setup(2020, 1010);
    target.fit();
    assert.equal(target.scale, .376);
    assert.equal((20 + 2020) / 2 * target.scale + target.offsetX, 400);
    assert.equal((10 + 1010) / 2 * target.scale + target.offsetY, 210);
    target.viewport.clientWidth = 360;
    target.viewport.clientHeight = 300;
    target.fit();
    assert.equal(target.scale, .156);
    assert.equal((20 + 2020) / 2 * target.scale + target.offsetX, 180);
    assert.equal((10 + 1010) / 2 * target.scale + target.offsetY, 150);
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

test("fullscreen fit centers the whole map below the persistent toolbar and is stable across repeated clicks", () => {
    for (const height of [32, 64]) {
        const target = setup(2020, 1010);
        target.options.host.classList.contains = (name: string) => name === "fullscreen";
        target.getToolbarBounds = (includePopup: boolean) => {
            assert.equal(includePopup, false, "the zoom popup does not reduce the fitting area");
            return [{left: 500, top: 0, right: 780, bottom: height, width: 280, height}];
        };
        target.fit();
        const availableHeight = 420 - height - 16 - 16;
        assert.equal(target.scale, availableHeight / 1000);
        assert.ok(Math.abs(10 * target.scale + target.offsetY - height - 16) < 1e-9);
        assert.ok(Math.abs(1010 * target.scale + target.offsetY - 420 + 16) < 1e-9);
        const fitted = transform(target);
        target.fit();
        assert.deepEqual(transform(target), fitted);
    }
});

test("fit converts scaled toolbar bounds to local canvas coordinates", () => {
    const target = setup(2020, 1010);
    target.options.host.classList.contains = (name: string) => name === "fullscreen";
    target.viewport.getBoundingClientRect = () =>
        ({left: 10, top: 20, right: 410, bottom: 230, width: 400, height: 210});
    target.getToolbarBounds = () => [{left: 260, top: 20, right: 400, bottom: 44, width: 140, height: 24}];
    target.fit();
    assert.equal(target.scale, .34);
    assert.ok(Math.abs(10 * target.scale + target.offsetY - 64) < 1e-9);
    assert.ok(Math.abs(1010 * target.scale + target.offsetY - 404) < 1e-9);
});

test("toolbar controls outside the viewport do not reduce the fitting area", () => {
    const target = setup(2020, 1010);
    target.options.host.classList.contains = (name: string) => name === "fullscreen";
    target.getToolbarBounds = () => [
        {left: 810, top: 0, right: 900, bottom: 64, width: 90, height: 64},
        {left: 500, top: 430, right: 780, bottom: 480, width: 280, height: 50},
    ];
    target.fit();
    assert.equal(target.scale, .376);
    assert.ok(Math.abs(10 * target.scale + target.offsetY - 22) < 1e-9);
});

test("fit at minimum zoom keeps the map top below the toolbar when the map is too tall", () => {
    const target = setup(1020, 5010);
    target.options.host.classList.contains = (name: string) => name === "fullscreen";
    target.getToolbarBounds = () => [{left: 500, top: 0, right: 780, bottom: 48, width: 280, height: 48}];
    target.fit();
    assert.equal(target.scale, .15);
    assert.equal(10 * target.scale + target.offsetY, 64);
});

test("document fit uses the same area with transient toolbars open or closed", () => {
    const target = setup(2020, 1010);
    target.fit();
    const fitted = transform(target);
    target.getToolbarBounds = () => {
        assert.fail("document fitting must not measure transient toolbar bounds");
    };
    target.fit();
    assert.deepEqual(transform(target), fitted);
    assert.ok(Math.abs(10 * target.scale + target.offsetY - 22) < 1e-9,
        "width-limited maps remain vertically centered");
    assert.ok(Math.abs(1010 * target.scale + target.offsetY - 398) < 1e-9);
});

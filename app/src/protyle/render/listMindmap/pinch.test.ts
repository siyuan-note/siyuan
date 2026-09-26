import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {createSourceFile, isClassDeclaration, ScriptTarget, transpileModule} from "typescript";

const source = createSourceFile("view.ts", readFileSync("src/protyle/render/listMindmap/view.ts", "utf8"),
    ScriptTarget.ES2021, true);
const view = source.statements.find(item => isClassDeclaration(item) && item.name?.text === "ListMindmapView");
assert.ok(view && isClassDeclaration(view));
const names = ["pinchStart", "pinchMove", "pinchEnd", "pointerDown", "pointerMove", "zoomAt"];
const methods = view.members.filter(item => item.name && names.includes(item.name.getText(source)));
assert.equal(methods.length, names.length);
const compiled = transpileModule(`class View {
    ${methods.map(item => item.getText(source)).join("\n")}
}
globalThis.View = View;`, {compilerOptions: {target: ScriptTarget.ES2021}}).outputText;

const setup = () => {
    const context: any = {clearTimeout};
    runInNewContext(compiled, context);
    const target = new context.View();
    let cancelled = 0;
    Object.assign(target, {
        scale: 1, offsetX: 0, offsetY: 0, pinching: false,
        viewport: {contains: (element: {outside?: boolean}) => !element.outside,
            getBoundingClientRect: () => ({left: 10, top: 20})},
        cancelPointer: () => { cancelled++; target.pendingPointerId = undefined; },
        boundedPan: (x: number, y: number) => ({x, y}), draw: () => {},
    });
    return {target, cancelled: () => cancelled};
};

const touch = (clientX: number, clientY = 120, excluded = false, outside = false) => ({
    clientX, clientY, target: {closest: () => excluded, outside},
});
const event = (...touches: ReturnType<typeof touch>[]) => ({touches, preventDefault() {}});

test("pinch cancels dragging and zooms around the finger midpoint within existing limits", () => {
    const {target, cancelled} = setup();
    target.pendingPointerId = 1;
    target.pinchStart(event(touch(60), touch(160)));
    assert.equal(cancelled(), 1);
    assert.equal(target.pendingPointerId, undefined);
    assert.equal(target.suppressLinkClick, true);
    target.pinchMove(event(touch(10), touch(210)));
    assert.equal(target.scale, 2);
    assert.equal(target.offsetX, -100);
    assert.equal(target.offsetY, -100);
    target.pinchMove(event(touch(-1000), touch(1000)));
    assert.equal(target.scale, 2.5);
    target.pinchMove(event(touch(100), touch(101)));
    assert.equal(target.scale, .15);
});

test("remaining fingers cannot start a drag and a new gesture starts at the current scale", () => {
    const {target} = setup();
    target.pinchStart(event(touch(60), touch(160)));
    target.pinchMove(event(touch(10), touch(210)));
    target.pinchEnd(event(touch(10)));
    assert.equal(target.pinching, true);
    target.pointerDown({});
    target.pointerMove({});
    target.pinchMove(event(touch(20)));
    assert.equal(target.scale, 2);
    target.pinchEnd(event());
    assert.equal(target.pinching, false);
    target.pinchStart(event(touch(60), touch(160)));
    target.pinchMove(event(touch(85), touch(135)));
    assert.equal(target.scale, 1);
});

test("editing controls and touches outside the map do not activate pinch", () => {
    const {target, cancelled} = setup();
    target.pinchStart(event(touch(60)));
    target.pinchStart(event(touch(60), touch(160, 120, true)));
    target.pinchStart(event(touch(60), touch(160, 120, false, true)));
    target.pointerDown({pointerType: "touch", isPrimary: false});
    assert.equal(target.pinching, false);
    assert.equal(cancelled(), 0);
    target.pinchStart(event(touch(60), touch(60)));
    target.pinchMove(event(touch(50), touch(100)));
    assert.equal(target.scale, 1);
    target.pinchStart(event(touch(50), touch(100), touch(150)));
    target.pinchMove(event(touch(0), touch(100), touch(200)));
    assert.equal(target.scale, 1);
    target.pinchEnd(event());
    assert.equal(target.pinching, false);
});

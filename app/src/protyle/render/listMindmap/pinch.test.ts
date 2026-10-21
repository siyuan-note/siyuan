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
    class Element {
        isContentEditable = false;
        input = false;
        inside = false;
        matches() { return this.input; }
    }
    const document = {activeElement: new Element()};
    const host = {
        ownerDocument: document,
        contains: (element: Element) => element.inside,
        focus: (options: {preventScroll: boolean}) => {
            assert.equal(options.preventScroll, true);
            document.activeElement = Object.assign(new Element(), {inside: true});
        },
    };
    const context: any = {clearTimeout, HTMLElement: Element};
    runInNewContext(compiled, context);
    const target = new context.View();
    let cancelled = 0;
    Object.assign(target, {
        scale: 1, offsetX: 0, offsetY: 0, pinching: false, interactionActive: false,
        options: {host},
        viewport: {contains: (element: {outside?: boolean} | null) => !!element && !element.outside,
            getBoundingClientRect: () => ({left: 10, top: 20})},
        cancelPointer: () => { cancelled++; target.pendingPointerId = undefined; },
        boundedPan: (x: number, y: number) => ({x, y}), draw: () => {},
    });
    return {target, document, cancelled: () => cancelled};
};

const touch = (clientX: number, clientY = 120, excluded = false, outside = false) => ({
    clientX, clientY, target: {closest: () => excluded ? {} : null, outside},
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

test("two fingers pan and zoom a reading canvas without activating single-finger dragging", () => {
    const {target} = setup();
    target.pinchStart(event(touch(60), touch(160)));
    target.pinchMove(event(touch(90, 140), touch(190, 140)));
    assert.equal(target.scale, 1);
    assert.equal(target.offsetX, 30);
    assert.equal(target.offsetY, 20);
    target.pinchMove(event(touch(50, 160), touch(250, 160)));
    assert.equal(target.scale, 2);
    assert.equal(target.offsetX, -60);
    assert.equal(target.offsetY, -60);
    target.pinchEnd(event());
    target.pointerDown({pointerType: "touch", isPrimary: true});
    assert.equal(target.pointer, undefined);
    assert.equal(target.interactionActive, false);
});

test("saved view locks prohibit two-finger gestures", () => {
    const {target, cancelled} = setup();
    target.locked = true;
    target.pinchStart(event(touch(60), touch(160)));
    target.pinchMove(event(touch(10), touch(210)));
    assert.equal(target.scale, 1);
    assert.equal(target.pinching, false);
    assert.equal(cancelled(), 0);
});

test("two-finger panning ignores small distance jitter until a deliberate pinch starts", () => {
    for (const [distance, jitter] of [[100, 6], [400, 12]]) {
        const {target} = setup();
        target.pinchStart(event(touch(60), touch(60 + distance)));
        target.pinchMove(event(touch(80), touch(80 + distance + jitter)));
        assert.equal(target.scale, 1);
        assert.equal(target.offsetX, 20 + jitter / 2);
        target.pinchMove(event(touch(90), touch(90 + distance - jitter)));
        assert.equal(target.scale, 1);
        target.pinchMove(event(touch(90), touch(90 + distance * 1.5)));
        assert.equal(target.scale, 1.5);
        target.pinchMove(event(touch(90), touch(90 + distance + jitter)));
        assert.equal(target.scale, (distance + jitter) / distance);
        target.pinchEnd(event());
        const scale = target.scale;
        target.pinchStart(event(touch(60), touch(60 + distance)));
        target.pinchMove(event(touch(80), touch(80 + distance + jitter)));
        assert.equal(target.scale, scale);
    }
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

test("additional contacts cancel a pending node hold even when a control or third finger prevents pinch", () => {
    for (const contacts of [[touch(60), touch(160, 120, true)], [touch(60), touch(160), touch(260)]]) {
        const {target, cancelled} = setup();
        target.pointer = {touchNode: "child"};
        target.pinchStart(event(...contacts));
        assert.equal(cancelled(), 1);
        assert.equal(target.pinching, false);
    }
});

test("a valid pinch transfers external editing focus to the canvas without restoring it on release", () => {
    for (const property of ["isContentEditable", "input"] as const) {
        const {target, document} = setup();
        const editor = document.activeElement;
        editor[property] = true;
        target.pinchStart(event(touch(60), touch(160)));
        assert.notEqual(document.activeElement, editor);
        assert.equal(document.activeElement.inside, true);
        target.pinchEnd(event(touch(60)));
        target.pinchEnd(event());
        assert.equal(document.activeElement.inside, true);
    }
});

test("pinches preserve internal editing and non-editable focus", () => {
    for (const editing of [false, true]) {
        const {target, document} = setup();
        const active = document.activeElement;
        active.inside = editing;
        active.isContentEditable = editing;
        target.pinchStart(event(touch(60), touch(160)));
        assert.equal(document.activeElement, active);
    }
});

test("single touches, excluded controls, outside contacts and locked maps preserve external editing focus", () => {
    for (const {locked, contacts} of [
        {locked: false, contacts: [touch(60)]},
        {locked: false, contacts: [touch(60), touch(160, 120, true)]},
        {locked: false, contacts: [touch(60), touch(160, 120, false, true)]},
        {locked: true, contacts: [touch(60), touch(160)]},
    ]) {
        const {target, document} = setup();
        const active = document.activeElement;
        active.isContentEditable = true;
        target.locked = locked;
        target.pinchStart(event(...contacts));
        assert.equal(document.activeElement, active);
    }
});

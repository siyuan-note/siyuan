import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {createSourceFile, isClassDeclaration, ScriptTarget, transpileModule} from "typescript";
import {clampMindmapPanOffset} from "./pan";

const source = createSourceFile("view.ts", readFileSync("src/protyle/render/listMindmap/view.ts", "utf8"),
    ScriptTarget.ES2021, true);
const view = source.statements.find(item => isClassDeclaration(item) && item.name?.text === "ListMindmapView");
assert.ok(view && isClassDeclaration(view));
const names = ["wheel", "boundedPan"];
const methods = view.members.filter(item => item.name && names.includes(item.name.getText(source)));
assert.equal(methods.length, names.length);
const compiled = transpileModule(`class View {
    ${methods.map(item => item.getText(source)).join("\n")}
}
globalThis.View = View;`, {compilerOptions: {target: ScriptTarget.ES2021}}).outputText;

const setup = () => {
    const context: any = {clampMindmapPanOffset, WheelEvent: {DOM_DELTA_LINE: 1, DOM_DELTA_PAGE: 2}};
    runInNewContext(compiled, context);
    const target = new context.View();
    let draws = 0;
    const zooms: number[][] = [];
    Object.assign(target, {
        scale: 1, offsetX: 0, offsetY: 0,
        viewport: {
            clientWidth: 400, clientHeight: 300, contains: (element: unknown) => !!element,
            getBoundingClientRect: () => ({left: 10, top: 20}),
        },
        contentBounds: () => ({left: 100, top: 100, right: 300, bottom: 200}),
        draw: () => draws++, zoomAt: (...args: number[]) => zooms.push(args),
    });
    return {target, draws: () => draws, zooms};
};

const wheel = (overrides: Record<string, unknown> = {}) => {
    let prevented = 0;
    let stopped = 0;
    return {
        event: {
            deltaX: 0, deltaY: 20, deltaMode: 0, ctrlKey: false, shiftKey: false, clientX: 110, clientY: 120,
            target: {closest: (): null => null},
            preventDefault: () => prevented++, stopPropagation: () => stopped++, ...overrides,
        },
        prevented: () => prevented, stopped: () => stopped,
    };
};

test("vertical wheel scrolls the document when the embedded mind map is fully visible", () => {
    for (const deltaY of [-1, 1]) {
        for (const deltaMode of [0, 1, 2]) {
            const {target, draws} = setup();
            const event = wheel({deltaY, deltaMode});
            target.wheel(event.event);
            assert.equal(event.prevented(), 0);
            assert.equal(event.stopped(), 0);
            assert.equal(draws(), 0);
            assert.equal(target.offsetX, 0);
            assert.equal(target.offsetY, 0);
        }
    }
});

test("visibility uses scaled content bounds and current offsets, including exact viewport edges", () => {
    const {target, draws} = setup();
    target.contentBounds = () => ({left: 100, top: 50, right: 900, bottom: 650});
    Object.assign(target, {scale: .5, offsetX: -50, offsetY: -25});
    const event = wheel();
    target.wheel(event.event);
    assert.equal(event.prevented(), 0);
    assert.equal(draws(), 0);
    assert.equal(target.offsetX, -50);
    assert.equal(target.offsetY, -25);
});

test("partially clipped content keeps the existing vertical canvas scrolling", () => {
    for (const bounds of [
        {left: -1, top: 100, right: 300, bottom: 200},
        {left: 100, top: 100, right: 401, bottom: 200},
        {left: 100, top: -1, right: 300, bottom: 200},
        {left: 100, top: 100, right: 300, bottom: 301},
    ]) {
        const {target, draws} = setup();
        target.contentBounds = () => bounds;
        const event = wheel();
        target.wheel(event.event);
        assert.equal(event.prevented(), 1);
        assert.equal(event.stopped(), 1);
        assert.equal(draws(), 1);
        assert.equal(target.offsetY, -20);
    }
});

test("fullscreen, horizontal, diagonal and Shift wheel keep canvas panning", () => {
    for (const options of [
        {fullscreenMarker: {}, event: {}},
        {event: {deltaX: 20, deltaY: 0}},
        {event: {deltaX: 20, deltaY: 20}},
        {event: {shiftKey: true}},
    ]) {
        const {target, draws} = setup();
        target.fullscreenMarker = options.fullscreenMarker;
        const event = wheel(options.event);
        target.wheel(event.event);
        assert.equal(event.prevented(), 1);
        assert.equal(event.stopped(), 1);
        assert.equal(draws(), 1);
        assert.equal(target.offsetX, options.fullscreenMarker ? 0 : -20);
        assert.equal(target.offsetY, options.fullscreenMarker || options.event.deltaX && options.event.deltaY ? -20 : 0);
    }
});

test("Ctrl wheel keeps anchored zoom even when all content is visible", () => {
    const {target, draws, zooms} = setup();
    const event = wheel({ctrlKey: true});
    target.wheel(event.event);
    assert.equal(event.prevented(), 1);
    assert.equal(event.stopped(), 1);
    assert.equal(draws(), 0);
    assert.deepEqual(zooms, [[Math.exp(-.2), 100, 100]]);
});

test("locked maps, node editing and relation dragging retain their existing wheel handling", () => {
    for (const editing of [false, true]) {
        const {target, draws} = setup();
        target.locked = !editing;
        const event = wheel({target: {closest: () => editing ? {} : null}});
        target.wheel(event.event);
        assert.equal(event.prevented(), 0);
        assert.equal(draws(), 0);
    }
    const {target, draws} = setup();
    target.pointer = {relation: {}};
    const event = wheel();
    target.wheel(event.event);
    assert.equal(event.prevented(), 1);
    assert.equal(event.stopped(), 1);
    assert.equal(draws(), 0);
});

import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {createSourceFile, isClassDeclaration, ScriptTarget, transpileModule} from "typescript";
import {clampMindmapPanOffset, clampMindmapPanPosition} from "./pan";

const source = createSourceFile("view.ts", readFileSync("src/protyle/render/listMindmap/view.ts", "utf8"),
    ScriptTarget.ES2021, true);
const view = source.statements.find(item => isClassDeclaration(item) && item.name?.text === "ListMindmapView");
assert.ok(view && isClassDeclaration(view));
const names = ["wheel", "boundedPan", "contentRectangles", "contentBounds", "pointerMove", "requestDraw"];
const methods = view.members.filter(item => item.name && names.includes(item.name.getText(source)));
assert.equal(methods.length, names.length);
const compiled = transpileModule(`class View {
    ${methods.map(item => item.getText(source)).join("\n")}
}
globalThis.View = View;`, {compilerOptions: {target: ScriptTarget.ES2021}}).outputText;

const setup = () => {
    const frames: (() => void)[] = [];
    const context: any = {clearTimeout, clampMindmapPanOffset, clampMindmapPanPosition, WheelEvent: {DOM_DELTA_LINE: 1, DOM_DELTA_PAGE: 2},
        requestAnimationFrame: (action: () => void) => frames.push(action)};
    runInNewContext(compiled, context);
    const target = new context.View();
    let draws = 0;
    const zooms: number[][] = [];
    Object.assign(target, {
        scale: 1, offsetX: 0, offsetY: 0, interactionActive: true,
        viewport: {
            clientWidth: 400, clientHeight: 300, contains: (element: unknown) => !!element,
            getBoundingClientRect: () => ({left: 10, top: 20}),
        },
        positions: new Map([["root", {x: 100, y: 101, width: 200, height: 99}]]),
        summaryPositions: new Map(), relationElements: new Map(), relationRoutes: new Map(),
        draw: () => draws++, zoomAt: (...args: number[]) => zooms.push(args),
    });
    return {target, draws: () => draws, zooms, frames};
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

test("inactive maps leave vertical wheel input to the document", () => {
    for (const deltaY of [-1, 1]) {
        for (const deltaMode of [0, 1, 2]) {
            const {target, draws} = setup();
            target.interactionActive = false;
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

test("inactive maps leave scrolling to the document regardless of scale and content clipping", () => {
    const {target, draws} = setup();
    target.positions = new Map([["root", {x: 100, y: 51, width: 800, height: 599}]]);
    Object.assign(target, {scale: .5, offsetX: -50, offsetY: -100, interactionActive: false});
    const event = wheel();
    target.wheel(event.event);
    assert.equal(event.prevented(), 0);
    assert.equal(draws(), 0);
    assert.equal(target.offsetX, -50);
    assert.equal(target.offsetY, -100);
});

test("inactive maps do not capture horizontal, diagonal or Shift wheel input", () => {
    for (const x of [-101, 201]) {
        const {target, draws} = setup();
        target.interactionActive = false;
        target.offsetX = x;
        for (const deltaY of [-20, 20]) {
            const event = wheel({deltaX: 20, deltaY, shiftKey: deltaY < 0});
            target.wheel(event.event);
            assert.equal(event.prevented(), 0);
            assert.equal(event.stopped(), 0);
            assert.equal(draws(), 0);
            assert.equal(target.offsetX, x);
            assert.equal(target.offsetY, 0);
        }
    }
});

test("active maps pan visible and clipped content within the existing bounds", () => {
    for (const bounds of [
        {left: 100, top: 100, right: 300, bottom: 200},
        {left: 100, top: -1, right: 300, bottom: 200},
        {left: 100, top: 100, right: 300, bottom: 301},
    ]) {
        const {target, draws} = setup();
        target.positions = new Map([["root", {x: bounds.left, y: bounds.top + 1,
            width: bounds.right - bounds.left, height: bounds.bottom - bounds.top - 1}]]);
        const event = wheel();
        target.wheel(event.event);
        assert.equal(event.prevented(), 1);
        assert.equal(event.stopped(), 1);
        assert.equal(draws(), 1);
        assert.equal(target.offsetY, -20);
    }
});

test("wheel retains actual visible content when extreme nodes are horizontally clipped", () => {
    const {target} = setup();
    target.positions = new Map([
        ["visible", {x: 100, y: 101, width: 100, height: 79}],
        ["clipped", {x: 600, y: 901, width: 100, height: 99}],
    ]);
    const event = wheel({deltaY: 2000});
    target.wheel(event.event);
    assert.equal(event.prevented(), 1);
    assert.equal(target.offsetX, 0);
    assert.equal(target.offsetY, -116);
    assert.equal(target.positions.get("visible").y + 79 + target.offsetY, 64);
    const next = wheel();
    target.wheel(next.event);
    assert.equal(next.prevented(), 1, "active canvas retains wheel ownership at the pan boundary");
    assert.equal(target.offsetY, -116);
});

test("vertical wheel still pans beyond the content edge until only a small portion remains", () => {
    const {target} = setup();
    target.positions = new Map([["root", {x: 100, y: 101, width: 200, height: 599}]]);
    target.offsetY = -400;
    const event = wheel();
    target.wheel(event.event);
    assert.equal(event.prevented(), 1, "content reaching the viewport edge does not end canvas panning");
    assert.equal(target.offsetY, -420);
    target.wheel(wheel({deltaY: 2000}).event);
    assert.equal(target.offsetY, -636);
    const next = wheel();
    target.wheel(next.event);
    assert.equal(next.prevented(), 1);
});

test("visible relation and summary labels remain reachable as pan references", () => {
    const {target} = setup();
    const relation = {hidden: false, style: {left: "800", top: "900"}, offsetWidth: 100, offsetHeight: 40};
    target.relationElements.set("label", relation);
    target.summaryPositions.set("summary", {x: 600, top: 400, bottom: 500,
        labelX: 600, labelY: 400, width: 100, height: 40});
    assert.deepEqual({...target.boundedPan(-700, -800)}, {x: -700, y: -800});
    assert.deepEqual({...target.boundedPan(-500, -300)}, {x: -500, y: -300});
    relation.hidden = true;
    assert.notDeepEqual({...target.boundedPan(-700, -800)}, {x: -700, y: -800},
        "hidden annotations cannot keep an otherwise empty viewport within range");
});

test("active mobile touch panning retains visible content without scrolling the document", () => {
    const {target} = setup();
    target.positions = new Map([
        ["visible", {x: 100, y: 101, width: 100, height: 79}],
        ["clipped", {x: 600, y: 901, width: 100, height: 99}],
    ]);
    const document = {scrollTop: 0};
    target.pointer = {pointerId: 1, pan: true, x: 0, y: 0, startX: 100, startY: 100};
    target.viewport.classList = {add: () => {}};
    target.options = {host: {closest: () => document}};
    target.setHoveredLine = () => {};
    const event = {pointerId: 1, clientX: 100, clientY: -1900, pointerType: "touch", preventDefault: () => {}};
    target.pointerMove(event);
    assert.equal(target.offsetX, 0);
    assert.equal(target.offsetY, -116);
    assert.equal(document.scrollTop, 0);
    target.pointerMove({...event, clientY: -1920});
    assert.equal(target.offsetY, -116);
    assert.equal(document.scrollTop, 0, "active canvas retains touch ownership at the pan boundary");
});

test("rapid mouse and touch pans draw the latest position once per frame, including after an idle frame", () => {
    for (const pointerType of ["mouse", "touch"]) {
        const {target, draws, frames} = setup();
        target.viewport.classList = {add: () => {}};
        target.setHoveredLine = () => {};
        target.pointer = {pointerId: 1, pan: true, x: 0, y: 0, startX: 100, startY: 100, moved: true};
        for (let gesture = 0; gesture < 2; gesture++) {
            const startX = target.pointer.startX;
            const startY = target.pointer.startY;
            for (let step = 1; step <= 60; step++) {
                target.pointerMove({pointerId: 1, pointerType, clientX: startX + step / 10,
                    clientY: startY + step / 10, preventDefault: () => {}});
            }
            assert.equal(draws(), gesture, "input events do not repeatedly redraw the map");
            assert.equal(frames.length, 1);
            assert.equal(target.offsetX, (gesture + 1) * 6);
            assert.equal(target.offsetY, (gesture + 1) * 6);
            frames.shift()();
            assert.equal(draws(), gesture + 1);
            assert.equal(target.drawFrame, 0);
        }
        target.destroyed = true;
        target.requestDraw();
        assert.equal(frames.length, 0, "destroyed views do not schedule rendering");
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
        target.interactionActive = !options.fullscreenMarker;
        const event = wheel(options.event);
        target.wheel(event.event);
        assert.equal(event.prevented(), 1);
        assert.equal(event.stopped(), 1);
        assert.equal(draws(), 1);
        assert.equal(target.offsetX, options.fullscreenMarker ? 0 : -20);
        assert.equal(target.offsetY, options.fullscreenMarker || options.event.deltaX && options.event.deltaY ? -20 : 0);
    }
});

test("Ctrl and Meta wheel zoom an inactive canvas without activating ordinary wheel capture", () => {
    for (const key of ["ctrlKey", "metaKey"]) {
        const {target, draws, zooms} = setup();
        target.interactionActive = false;
        const event = wheel({[key]: true});
        target.wheel(event.event);
        assert.equal(event.prevented(), 1);
        assert.equal(event.stopped(), 1);
        assert.equal(draws(), 0);
        assert.deepEqual(zooms, [[Math.exp(-.2), 100, 100]]);
        assert.equal(target.interactionActive, false);
    }
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

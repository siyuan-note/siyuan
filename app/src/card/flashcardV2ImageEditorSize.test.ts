import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ScriptTarget, transpileModule} from "typescript";

class Control {
    value = "";
    innerHTML = "";
    disabled = false;
    classList = {contains: () => false, toggle: () => {}};
    listeners = new Map<string, (event?: unknown) => void>();
    addEventListener(type: string, listener: (event?: unknown) => void) { this.listeners.set(type, listener); }
    removeEventListener(type: string) { this.listeners.delete(type); }
    emit(type: string, event?: unknown) { this.listeners.get(type)?.(event); }
}

const setup = () => {
    const draws: number[][] = [];
    const context = {beginPath() {}, closePath() {}, moveTo() {}, lineTo() {}, ellipse() {},
        rect: (...values: number[]) => draws.push(values), fill() {}, stroke() {}, arc() {},
        setTransform() {}, clearRect() {}};
    const image = Object.assign(new Control(), {clientWidth: 600, clientHeight: 300,
        getBoundingClientRect: () => ({width: 480, height: 240})});
    const canvas = Object.assign(new Control(), {width: 0, height: 0, style: {width: "", height: ""},
        getContext: () => context, setPointerCapture() {},
        getBoundingClientRect: () => ({left: 20, top: 30,
            width: parseFloat(canvas.style.width) * .8, height: parseFloat(canvas.style.height) * .8})});
    const controls = new Map<string, Control>([["img", image], ["canvas", canvas]]);
    for (const key of ["imageShape", "imageGroup", "imageFrontMode", "finishPolygon", "undoImageShape"]) {
        controls.set(`[data-type="${key}"]`, new Control());
    }
    controls.get('[data-type="imageShape"]').value = "rectangle";
    const window = Object.assign(new Control(), {devicePixelRatio: 2});
    const document = new Control();
    let resize: () => void;
    let disconnected = false;
    let cancelled = false;
    let frame: () => void;
    let id = 0;
    const initial = {groups: [{id: "group", displayOrder: 0, shapeIDs: ["existing"]}],
        shapes: [{id: "existing", type: "rectangle", x: .1, y: .2, width: .3, height: .4}]};
    const source = readFileSync("src/card/flashcardV2.ts", "utf8");
    const snippet = source.slice(source.indexOf("const bindFlashcardV2ImageEditor ="),
        source.indexOf("const openFlashcardV2AdvancedSourceEditor ="));
    const editor = runInNewContext(transpileModule(snippet +
        '\nbindFlashcardV2ImageEditor(element, "image.png", () => {}, initial);', {
        compilerOptions: {target: ScriptTarget.ES2021},
    }).outputText, {
        window, document, initial, element: {querySelector: (selector: string) => controls.get(selector)},
        escapeAttr: (value: string) => value, genUUID: () => `generated-${++id}`,
        requestAnimationFrame: (callback: () => void) => { frame = callback; return 1; },
        cancelAnimationFrame: () => { cancelled = true; },
        ResizeObserver: class {
            constructor(callback: () => void) { resize = callback; }
            observe(target: unknown) { assert.equal(target, image); }
            disconnect() { disconnected = true; }
        },
    });
    return {editor, image, canvas, draws, window, document, frame: () => frame(), resize: () => resize(),
        disconnected: () => disconnected, cancelled: () => cancelled};
};

test("dialog transform does not shrink the editor canvas twice", () => {
    const state = setup();
    state.frame();
    assert.equal(state.canvas.style.width, "600px");
    assert.equal(state.canvas.style.height, "300px");
    assert.equal(state.canvas.width, 1200);
    assert.equal(state.canvas.height, 600);
    assert.deepEqual(state.draws.at(-1), [60, 60, 180, 120]);
    state.editor.destroy();
});

test("layout resize redraws existing normalized shapes and transformed pointers stay normalized", () => {
    const state = setup();
    state.image.clientWidth = 400;
    state.image.clientHeight = 200;
    state.resize();
    assert.equal(state.canvas.style.width, "400px");
    assert.deepEqual(state.draws.at(-1), [40, 40, 120, 80]);
    state.canvas.emit("pointerdown", {clientX: 100, clientY: 70, pointerId: 1});
    state.canvas.emit("pointerup", {clientX: 260, clientY: 150, pointerId: 1});
    const shape = state.editor.getConfig().shapes[1];
    assert.equal(shape.x, .25);
    assert.equal(shape.y, .25);
    assert.equal(shape.width, .5);
    assert.equal(shape.height, .5);
    state.window.devicePixelRatio = 1;
    state.window.emit("resize");
    assert.equal(state.canvas.width, 400);
    state.image.clientWidth = 200;
    state.image.clientHeight = 100;
    state.window.devicePixelRatio = 2;
    state.resize();
    assert.equal(state.canvas.width, 400);
    assert.equal(state.canvas.style.width, "200px");
    state.editor.destroy();
});

test("destroy removes global hooks and prevents pending resize or animation callbacks drawing", () => {
    const state = setup();
    state.editor.destroy();
    state.frame();
    state.resize();
    state.editor.redraw();
    assert.equal(state.draws.length, 0);
    assert.equal(state.disconnected(), true);
    assert.equal(state.cancelled(), true);
    assert.equal(state.window.listeners.size, 0);
    assert.equal(state.document.listeners.size, 0);
    assert.equal(state.image.listeners.size, 0);
});

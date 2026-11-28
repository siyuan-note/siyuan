import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ScriptTarget, transpileModule} from "typescript";

class Control {
    value = "";
    textContent = "";
    dataset: Record<string, string> = {};
    toggleAttribute() {}
    attributes = new Map<string, string>();
    getAttribute(key: string) { return this.attributes.get(key); }
    setAttribute(key: string, value: string) { this.attributes.set(key, value); }
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
        setTransform() {}, clearRect() {}, strokeRect() {}, fillRect() {}};
    const image = Object.assign(new Control(), {clientWidth: 600, clientHeight: 300, naturalWidth: 600, naturalHeight: 300, style: {width: ""},
        parentElement: {offsetLeft: 0, offsetTop: 0},
        getBoundingClientRect: () => ({width: 480, height: 240})});
    const canvas = Object.assign(new Control(), {width: 0, height: 0, style: {width: "", height: ""},
        getContext: () => context, setPointerCapture() {},
        getBoundingClientRect: () => ({left: 20, top: 30,
            width: parseFloat(canvas.style.width) * .8, height: parseFloat(canvas.style.height) * .8})});
    const viewport = Object.assign(new Control(), {clientWidth: 600, clientHeight: 300, scrollLeft: 0, scrollTop: 0});
    const labelInput = new Control();
    const controls = new Map<string, Control>([["img", image], ["canvas", canvas], [".card__v2-image-viewport", viewport]]);
    for (const key of ["imageShape", "imageGroup", "imageFrontMode", "finishPolygon", "undoImageShape", "deleteImageShape",
        "zoomImageIn", "zoomImageOut", "resetImageZoom", "selectImageShapes", "mergeImageShapes", "splitImageShapes",
        "actualImageSize", "fullscreenImageEditor"]) {
        controls.set(`[data-type="${key}"]`, new Control());
    }
    controls.get('[data-type="imageShape"]').value = "rectangle";
    controls.set('[data-type="imageMaskLabelField"]', Object.assign(new Control(), {querySelector: () => labelInput}));
    const window = Object.assign(new Control(), {devicePixelRatio: 2, innerHeight: 900});
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
        bindFlashcardV2Pinch: () => {}, escapeAttr: (value: string) => value, genUUID: () => `generated-${++id}`,
        requestAnimationFrame: (callback: () => void) => { frame = callback; return 1; },
        cancelAnimationFrame: () => { cancelled = true; },
        ResizeObserver: class {
            constructor(private callback: () => void) {}
            observe(target: unknown) {
                assert.ok(target === image || target === viewport);
                if (target === image) { resize = this.callback; }
            }
            disconnect() { disconnected = true; }
        },
    });
    return {editor, image, canvas, draws, window, document, viewport, labelInput,
        control: (key: string) => controls.get('[data-type="' + key + '"]'), frame: () => frame(), resize: () => resize(),
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
    state.canvas.emit("pointerdown", {clientX: 100, clientY: 70, pointerId: 1, button: 0});
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

test("editing keeps the existing shape and group IDs and deletion is undoable", () => {
    const state = setup();
    state.frame();
    const mode = state.control("imageShape");
    mode.value = "edit";
    mode.emit("change");
    const at = (x: number, y: number) => ({clientX: 20 + x * 480, clientY: 30 + y * 240, pointerId: 1, button: 0});
    state.canvas.emit("pointerdown", at(.25, .4));
    state.canvas.emit("pointerup", at(.35, .5));
    const moved = state.editor.getConfig();
    assert.equal(moved.shapes[0].id, "existing");
    assert.equal(moved.groups[0].id, "group");
    assert.ok(Math.abs(moved.shapes[0].x - .2) < 1e-9);
    state.canvas.emit("pointerdown", at(.5, .7));
    state.canvas.emit("pointerup", at(.55, .8));
    assert.ok(Math.abs(state.editor.getConfig().shapes[0].width - .35) < 1e-9);
    state.control("deleteImageShape").emit("click");
    assert.equal(state.editor.getConfig().groups.length, 0);
    state.control("undoImageShape").emit("click");
    assert.equal(state.editor.getConfig().shapes[0].id, "existing");
    state.editor.destroy();
});

test("zoom and panning leave normalized shape coordinates unchanged", () => {
    const state = setup();
    state.frame();
    const original = state.editor.getConfig();
    state.control("zoomImageIn").emit("click");
    assert.equal(state.image.style.width, "900px");
    assert.equal(state.control("resetImageZoom").textContent, "150%");
    const mode = state.control("imageShape");
    mode.value = "pan";
    mode.emit("change");
    state.canvas.emit("pointerdown", {clientX: 150, clientY: 150, pointerId: 1, button: 0});
    state.canvas.emit("pointermove", {clientX: 100, clientY: 110, pointerId: 1});
    assert.equal(state.viewport.scrollLeft, 50);
    assert.equal(state.viewport.scrollTop, 40);
    assert.deepEqual(state.editor.getConfig(), original);
    state.canvas.emit("pointercancel", {pointerId: 1});
    state.control("resetImageZoom").emit("click");
    assert.equal(state.image.style.width, "");
    state.editor.destroy();
});

test("merging uses the active group ID and splitting assigns new IDs to the other shapes", () => {
    const state = setup();
    state.frame();
    const at = (x: number, y: number, shiftKey = false) => ({
        clientX: 20 + x * 480, clientY: 30 + y * 240, pointerId: 1, button: 0, shiftKey,
    });
    state.canvas.emit("pointerdown", at(.6, .2));
    state.canvas.emit("pointerup", at(.9, .5));
    const added = state.editor.getConfig().groups[1];
    const mode = state.control("imageShape");
    mode.value = "edit";
    mode.emit("change");
    state.canvas.emit("pointerdown", at(.75, .35, true));
    state.canvas.emit("pointerdown", at(.2, .3, true));
    state.control("mergeImageShapes").emit("click");
    const merged = state.editor.getConfig();
    assert.equal(merged.groups.length, 1);
    assert.equal(merged.groups[0].id, "group");
    assert.equal(merged.groups[0].shapeIDs.length, 2);
    state.canvas.emit("pointerdown", at(.2, .3, true));
    state.control("splitImageShapes").emit("click");
    const split = state.editor.getConfig();
    assert.equal(split.groups[0].id, "group");
    assert.equal(split.groups[0].shapeIDs[0], "existing");
    assert.notEqual(split.groups[1].id, added.id);
    assert.equal(split.groups[1].shapeIDs[0], added.shapeIDs[0]);
    state.editor.destroy();
});

test("rotation preserves the shape identity with normalized polygon points", () => {
    const state = setup();
    state.frame();
    const mode = state.control("imageShape");
    mode.value = "edit";
    mode.emit("change");
    const at = (x: number, y: number) => ({
        clientX: 20 + x * 480, clientY: 30 + y * 240, pointerId: 1, button: 0,
    });
    state.canvas.emit("pointerdown", at(.25, .4));
    state.canvas.emit("pointerup", at(.25, .4));
    state.labelInput.value = "External landmark";
    state.labelInput.emit("input");
    state.canvas.emit("pointerdown", at(.25, .2 - 22 / 240));
    state.canvas.emit("pointerup", at(.4, .4));
    const shape = state.editor.getConfig().shapes[0];
    assert.equal(shape.id, "existing");
    assert.equal(shape.type, "polygon");
    assert.equal(shape.points.length, 4);
    assert.equal(shape.label, "External landmark");
    assert.ok(shape.points.every(({x, y}: {x: number, y: number}) => x >= 0 && x <= 1 && y >= 0 && y <= 1));
    state.editor.destroy();
});

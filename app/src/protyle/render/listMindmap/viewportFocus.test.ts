import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {createSourceFile, isClassDeclaration, ScriptTarget, transpileModule} from "typescript";

const source = createSourceFile("view.ts", readFileSync("src/protyle/render/listMindmap/view.ts", "utf8"),
    ScriptTarget.ES2021, true);
const view = source.statements.find(item => isClassDeclaration(item) && item.name?.text === "ListMindmapView");
assert.ok(view && isClassDeclaration(view));
const names = ["focusNode", "getToolbarBounds", "revealNode", "isTemporaryPan", "activatePointer", "isPanTarget", "dismissControls", "closeInspectorPanel", "pointerDown", "preparePointer", "beginPointer", "pointerUp"];
const methods = view.members.filter(item => item.name && names.includes(item.name.getText(source)));
assert.equal(methods.length, names.length);
const compiled = transpileModule(`class View { ${methods.map(item => item.getText(source)).join("\n")} }
globalThis.View = View;`, {compilerOptions: {target: ScriptTarget.ES2021}}).outputText;

const setup = () => {
    const frames: (() => void)[] = [];
    const context: any = {clearTimeout, requestAnimationFrame: (action: () => void) => frames.push(action),
        getComputedStyle: (element: any) => ({display: "block", visibility: "visible", opacity: "1", ...element.style})};
    runInNewContext(compiled, context);
    let focus = "editor";
    let finished = 0;
    let drawn = 0;
    const host = {focus: () => focus = "canvas", contains: () => true};
    const target = Object.assign(new context.View(), {
        options: {host}, editingId: "new", model: {nodes: new Map([["new", {}]])},
        selectedId: "new", tooltip: {}, inspector: {hidden: true},
        inspectorPopover: {hidden: true, contains: () => false},
        toolbar: {hidden: false, querySelectorAll: (): unknown[] => []},
        world: {querySelectorAll: (): HTMLElement[] => []},
        nodeElements: new Map(), summaryElements: new Map(), offsetX: 0, offsetY: 0,
        interactionActive: true, setInteractionActive: (value: boolean) => target.interactionActive = value,
        buttons: new Map(),
        viewport: {contains: (element: unknown) => !!element, setPointerCapture: () => {},
            offsetWidth: 400, offsetHeight: 300,
            getBoundingClientRect: () => ({left: 0, top: 0, right: 400, bottom: 300, width: 400, height: 300})},
        selectNode: () => {}, queueInspectorLayout: () => {}, findLine: (): unknown => undefined, selectLine: () => {},
        focusSelectionInput: () => {},
        clearSelection: () => { target.selectedId = undefined; },
        boundedPan: (x: number, y: number) => ({x, y}), draw: () => drawn++,
        finishThen: (action: () => void) => { finished++; target.editingId = undefined; action(); },
        cancelPointer: () => { target.pointer = undefined; },
    });
    const element = (kind = "background") => ({
        dataset: {mindmapId: "other"},
        closest: (selector: string) => {
            if (selector === ".mindmap-view") {
                return host;
            }
            return kind !== "background" && selector.split(",").some(item => item.trim() === kind) ? element() : null;
        },
    });
    const event = (kind = "background", overrides: Record<string, unknown> = {}) => ({
        target: element(kind), pointerId: 1, pointerType: "mouse", isPrimary: true, button: 0,
        clientX: 20, clientY: 20, defaultPrevented: false,
        preventDefault() { this.defaultPrevented = true; }, ...overrides,
    });
    return {target, frames, event, focus: () => focus, finished: () => finished, drawn: () => drawn};
};

test("focusing a new offscreen node reveals it after the pending layout", () => {
    const {target, frames, drawn} = setup();
    target.frame = 1;
    let rect = {left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0};
    target.nodeElements.set("new", {getBoundingClientRect: () => rect});
    target.focusNode("new");
    assert.equal(drawn(), 0);
    rect = {left: 420, top: 320, right: 500, bottom: 360, width: 80, height: 40};
    frames.forEach(action => action());
    assert.equal(target.offsetX, -116);
    assert.equal(target.offsetY, -76);
    assert.equal(drawn(), 1);
});

test("focusing visible, missing or removed nodes does not pan", () => {
    const {target, drawn} = setup();
    target.nodeElements.set("new", {getBoundingClientRect: () =>
        ({left: 100, top: 100, right: 200, bottom: 140, width: 100, height: 40})});
    target.focusNode("new");
    target.focusNode("missing");
    target.destroyed = true;
    target.focusNode("new");
    assert.equal(drawn(), 0);
});

test("new summary labels are revealed even though they are not source nodes", () => {
    const {target, drawn} = setup();
    target.summaryElements.set("summary", {getBoundingClientRect: () =>
        ({left: 420, top: 320, right: 500, bottom: 360, width: 80, height: 40})});
    target.revealNode("summary");
    assert.equal(target.offsetX, -116);
    assert.equal(target.offsetY, -76);
    assert.equal(drawn(), 1);
});

test("node focus avoids the actual bottom panel bounds after the pending layout", () => {
    for (const top of [250, 210]) {
        const {target, frames, drawn} = setup();
        target.frame = 1;
        target.inspector = {hidden: false, getBoundingClientRect: () =>
            ({left: 80, right: 320, top, bottom: 292, width: 240, height: 292 - top})};
        target.nodeElements.set("new", {getBoundingClientRect: () =>
            ({left: 100, top: 240, right: 180, bottom: 280, width: 80, height: 40})});
        target.focusNode("new");
        assert.equal(drawn(), 0);
        frames.forEach(action => action());
        assert.equal(280 + target.offsetY, top - 16);
        assert.equal(target.offsetX, 0);
        assert.equal(drawn(), 1);
    }
});

test("hidden, unmeasured and non-overlapping panels do not move an unobstructed node", () => {
    for (const bounds of [
        {left: 200, right: 320, top: 250, bottom: 292, width: 120, height: 42},
        {left: 80, right: 320, top: 310, bottom: 352, width: 240, height: 42},
        {left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0},
    ]) {
        const {target, drawn} = setup();
        target.inspector = {hidden: false, getBoundingClientRect: () => bounds};
        target.nodeElements.set("new", {getBoundingClientRect: () =>
            ({left: 100, top: 240, right: 180, bottom: 280, width: 80, height: 40})});
        target.focusNode("new");
        assert.equal(drawn(), 0);
    }
    const {target, drawn} = setup();
    target.inspector = {hidden: true, getBoundingClientRect: () => {
        throw new Error("hidden panels do not need measuring");
    }};
    target.nodeElements.set("new", {getBoundingClientRect: () =>
        ({left: 100, top: 240, right: 180, bottom: 280, width: 80, height: 40})});
    target.focusNode("new");
    assert.equal(drawn(), 0);
});

test("horizontal reveal also avoids a panel at the destination", () => {
    const {target} = setup();
    target.inspector = {hidden: false, getBoundingClientRect: () =>
        ({left: 80, right: 390, top: 250, bottom: 292, width: 310, height: 42})};
    target.nodeElements.set("new", {getBoundingClientRect: () =>
        ({left: 420, top: 240, right: 500, bottom: 280, width: 80, height: 40})});
    target.focusNode("new");
    assert.equal(target.offsetX, -116);
    assert.equal(target.offsetY, -46);
});

test("scaled canvases convert menu clearance into canvas pan coordinates", () => {
    const {target} = setup();
    target.viewport.getBoundingClientRect = () =>
        ({left: 0, top: 0, right: 200, bottom: 150, width: 200, height: 150});
    target.inspector = {hidden: false, getBoundingClientRect: () =>
        ({left: 40, right: 160, top: 125, bottom: 146, width: 120, height: 21})};
    target.nodeElements.set("new", {getBoundingClientRect: () =>
        ({left: 50, top: 120, right: 90, bottom: 140, width: 40, height: 20})});
    target.focusNode("new");
    assert.equal(target.offsetX, 0);
    assert.equal(target.offsetY, -46);
});

test("a node taller than the unobstructed area keeps its top visible", () => {
    const {target} = setup();
    target.inspector = {hidden: false, getBoundingClientRect: () =>
        ({left: 80, right: 320, top: 210, bottom: 292, width: 240, height: 82})};
    target.nodeElements.set("new", {getBoundingClientRect: () =>
        ({left: 100, top: 100, right: 180, bottom: 320, width: 80, height: 220})});
    target.focusNode("new");
    assert.equal(100 + target.offsetY, 16);
});

test("node focus clears visible toolbar controls with their actual heights after layout", () => {
    for (const bottom of [32, 60]) {
        const {target, frames, drawn} = setup();
        target.frame = 1;
        target.toolbar.querySelectorAll = () => [{getBoundingClientRect: () =>
            ({left: 280, top: 0, right: 400, bottom, width: 120, height: bottom})}];
        target.nodeElements.set("new", {getBoundingClientRect: () =>
            ({left: 300, top: 16, right: 380, bottom: 56, width: 80, height: 40})});
        target.focusNode("new");
        assert.equal(drawn(), 0);
        frames.forEach(action => action());
        assert.equal(16 + target.offsetY, bottom + 16);
        assert.equal(target.offsetX, 0);
    }
});

test("hidden toolbar controls and its empty horizontal area do not move a visible node", () => {
    const bounds = {left: 280, top: 0, right: 400, bottom: 48, width: 120, height: 48};
    for (const style of [{opacity: "0"}, {visibility: "hidden"}, {display: "none"}]) {
        for (const hiddenControl of [false, true]) {
            const {target, drawn} = setup();
            const control = {style: hiddenControl ? style : {}, getBoundingClientRect: () => bounds};
            target.toolbar.style = hiddenControl ? {} : style;
            target.toolbar.querySelectorAll = () => [control];
            target.nodeElements.set("new", {getBoundingClientRect: () =>
                ({left: 300, top: 16, right: 380, bottom: 56, width: 80, height: 40})});
            target.focusNode("new");
            assert.equal(drawn(), 0);
        }
    }
    const {target, drawn} = setup();
    target.toolbar.querySelectorAll = () => [{getBoundingClientRect: () => bounds}];
    target.nodeElements.set("new", {getBoundingClientRect: () =>
        ({left: 100, top: 16, right: 180, bottom: 56, width: 80, height: 40})});
    target.focusNode("new");
    assert.equal(drawn(), 0);
});

test("horizontal reveal and outer scaling also clear toolbar controls at the destination", () => {
    const {target} = setup();
    target.viewport.getBoundingClientRect = () =>
        ({left: 0, top: 0, right: 200, bottom: 150, width: 200, height: 150});
    target.toolbar.querySelectorAll = () => [{getBoundingClientRect: () =>
        ({left: 140, top: 0, right: 200, bottom: 24, width: 60, height: 24})}];
    target.nodeElements.set("new", {getBoundingClientRect: () =>
        ({left: 210, top: 8, right: 250, bottom: 28, width: 40, height: 20})});
    target.focusNode("new");
    assert.equal(target.offsetX, -116);
    assert.equal(target.offsetY, 48);
});

test("bottom clearance preserves the node top below the toolbar when the node is too tall", () => {
    const {target} = setup();
    target.toolbar.querySelectorAll = () => [{getBoundingClientRect: () =>
        ({left: 80, top: 0, right: 320, bottom: 48, width: 240, height: 48})}];
    target.inspector = {hidden: false, getBoundingClientRect: () =>
        ({left: 80, right: 320, top: 210, bottom: 292, width: 240, height: 82})};
    target.nodeElements.set("new", {getBoundingClientRect: () =>
        ({left: 100, top: 100, right: 180, bottom: 320, width: 80, height: 220})});
    target.focusNode("new");
    assert.equal(100 + target.offsetY, 64);
});

test("hand-tool, middle-button, right-button and primary touch panning preserve the editing focus", () => {
    for (const overrides of [{}, {button: 1}, {button: 2}, {pointerType: "touch"}]) {
        const {target, event, focus, finished} = setup();
        target.panning = !Object.keys(overrides).length;
        const down = event("background", overrides);
        target.dismissControls(down);
        target.pointerDown(down);
        assert.equal(down.defaultPrevented, true);
        assert.equal(focus(), "editor");
        assert.equal(finished(), 0);
        assert.ok(target.pointer);
        target.pointer.moved = true;
        target.pointerUp(down);
        assert.equal(focus(), "editor");
        assert.equal(finished(), 0);
        assert.equal(target.editingId, "new");
        assert.equal(target.selectedId, "new");
    }
});

test("touch activation waits for a click and ignores an unfinished pinch or a nested map", () => {
    const {target, event} = setup();
    target.interactionActive = false;
    const down = event("background", {type: "pointerdown", pointerType: "touch"});
    target.activatePointer(down);
    assert.equal(target.interactionActive, false);
    const click = event("background", {type: "click", pointerType: "touch"});
    target.activatePointer(click);
    assert.equal(target.interactionActive, true);
    target.interactionActive = false;
    target.pinching = true;
    target.activatePointer(click);
    assert.equal(target.interactionActive, false);
    target.pinching = false;
    target.activatePointer({...click, target: {closest: () => ({})}});
    assert.equal(target.interactionActive, false);
});

test("middle dragging and Ctrl or Meta right dragging preserve reading state, node selection and editor focus", () => {
    for (const overrides of [{button: 1}, {button: 2, ctrlKey: true}, {button: 2, metaKey: true}]) {
        for (const interactionActive of [false, true]) {
            const {target, event, focus, finished} = setup();
            target.interactionActive = interactionActive;
            const down = event("background", overrides);
            target.dismissControls(down);
            target.activatePointer(down);
            target.pointerDown(down);
            assert.equal(target.interactionActive, interactionActive);
            assert.equal(target.selectedId, "new");
            assert.equal(target.pointer.pan, true);
            assert.equal(focus(), "editor");
            assert.equal(finished(), 0);
            target.pointer.moved = true;
            target.pointerUp(down);
            assert.equal(focus(), "editor");
            assert.equal(finished(), 0);
            assert.equal(target.interactionActive, interactionActive);
        }
        const {target, event, finished} = setup();
        target.locked = true;
        target.interactionActive = false;
        const down = event("background", overrides);
        target.activatePointer(down);
        target.pointerDown(down);
        assert.equal(target.pointer, undefined, "temporary gestures cannot bypass a saved view lock");
        assert.equal(target.interactionActive, false);
        assert.equal(finished(), 0);
        for (const mode of ["relationFrom", "multiSelect"]) {
            const {target, event, finished} = setup();
            target[mode] = mode === "relationFrom" ? "new" : true;
            const down = event("background", overrides);
            target.dismissControls(down);
            target.activatePointer(down);
            target.pointerDown(down);
            assert.equal(target.selectedId, "new");
            assert.equal(target[mode], mode === "relationFrom" ? "new" : true);
            assert.equal(target.pointer.pan, true);
            assert.equal(finished(), 0, "temporary panning does not finish a pending annotation");
        }
    }
});

test("middle clicks preserve selection and editing without moving or finishing annotations", () => {
    for (const kind of ["background", ".mindmap-view__node", ".mindmap-view__summary"]) {
        for (const mode of ["normal", "readOnly", "relationFrom"]) {
            const {target, event, finished, focus} = setup();
            if (mode !== "normal") {
                target[mode] = mode === "relationFrom" ? "new" : true;
            }
            const down = event(kind, {button: 1});
            target.dismissControls(down);
            target.activatePointer(down);
            target.pointerDown(down);
            assert.equal(target.pointer.pan, true);
            assert.equal(target.pointer.id, undefined);
            assert.equal(target.pointer.selection, undefined);
            target.pointerUp(down);
            assert.equal(target.selectedId, "new");
            assert.equal(target.editingId, "new");
            assert.equal(finished(), 0);
            assert.equal(focus(), "editor");
        }
    }
});

test("middle panning excludes controls, node editors, nested maps and pinches", () => {
    const {target, event} = setup();
    for (const kind of ["button", "input", "select", "textarea", "audio", "video", "iframe", ".mindmap-view__node--editing"]) {
        const down = event(kind, {button: 1});
        assert.equal(target.isPanTarget(down), false, kind);
        target.pointerDown(down);
        assert.equal(target.pointer, undefined, kind);
    }
    assert.equal(target.isPanTarget(event("background", {button: 1, target: {closest: () => ({})}})), false);
    target.pinching = true;
    target.pointerDown(event("background", {button: 1}));
    assert.equal(target.pointer, undefined);
});

test("a background click still finishes editing while a canceled drag leaves it active", () => {
    const {target, event, focus, finished} = setup();
    const down = event();
    target.pointerDown(down);
    target.pointerUp(down);
    assert.equal(finished(), 2);
    assert.equal(focus(), "canvas");
    target.editingId = "new";
    target.panning = true;
    target.pointerDown(event());
    target.cancelPointer();
    assert.equal(target.editingId, "new");
    assert.equal(finished(), 2);
});

test("nodes, controls, nested maps, lines and non-pan modes retain their own interactions", () => {
    const {target, event} = setup();
    assert.equal(target.isPanTarget(event()), false, "ordinary left dragging cannot pan the background");
    assert.equal(target.isPanTarget(event("background", {pointerType: "touch"})), true);
    for (const kind of [".mindmap-view__node", "button", ".mindmap-view__node--editing", ".mindmap-view__summary"]) {
        assert.equal(target.isPanTarget(event(kind)), false, kind);
    }
    assert.equal(target.isPanTarget(event("background", {pointerType: "touch", isPrimary: false})), false);
    assert.equal(target.isPanTarget(event("background", {target: {closest: () => ({})}})), false);
    target.findLine = () => ({relation: true});
    assert.equal(target.isPanTarget(event()), false);
    target.findLine = (): unknown => undefined;
    for (const key of ["locked", "pinching", "relationFrom"]) {
        target[key] = true;
        assert.equal(target.isPanTarget(event()), false, key);
        target[key] = false;
    }
});

test("clicking a virtual root preserves its selection for title editing", () => {
    const {target, event} = setup();
    target.editingId = undefined;
    target.model.nodes.set("new", {virtual: true});
    const down = event();
    target.beginPointer(down, "new");
    target.pointerUp(down);
    assert.equal(target.selectedId, "new");
});

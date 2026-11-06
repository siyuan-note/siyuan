import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";
import * as gesture from "./mobileSheetGesture";

const source = transpileModule(readFileSync("src/mobile/util/bindBottomSheetDrag.ts", "utf8"), {
    compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
}).outputText;
const setup = (initialHeight = 700) => {
    let time = 0;
    let height = initialHeight;
    let closeCount = 0;
    let permitted = true;
    let exiting = false;
    let close: () => Promise<void | boolean> = async () => false;
    const listeners = new Map<string, (event?: any) => void>();
    const eventTarget = (prefix: string) => ({
        addEventListener: (name: string, callback: () => void) => listeners.set(prefix + name, callback),
        removeEventListener: (name: string) => listeners.delete(prefix + name),
    });
    const window = {...eventTarget("window:"), visualViewport: eventTarget("visual:"), screen: {orientation: eventTarget("orientation:")}};
    const element = {...eventTarget("sheet:"), isConnected: true, style: {transform: "", transition: ""},
        get clientHeight() { return height; }, getBoundingClientRect: () => ({height})};
    const grip = {parentElement: element, closest: (): null => null, contains: (target: unknown) => target === grip};
    const body = {parentElement: element, closest: (): null => null};
    const scrim = {style: {opacity: ""}};
    const api: any = {};
    runInNewContext(source, {exports: api, require: () => gesture, window, performance: {now: () => time},
        console, getComputedStyle: () => ({overflowY: "auto"})});
    const dispose = api.bindBottomSheetDrag(element, scrim, () => { closeCount++; return close(); }, {
        grip, getBounds: () => ({min: 180, max: 800}), resize: (value: number) => { height = value; },
        canStart: () => permitted, isClosing: () => exiting,
    });
    const touch = (y: number, id = 7, x = 100) => ({clientX: x, clientY: y, identifier: id});
    const send = (type: string, y: number, options: {target?: unknown, id?: number, x?: number, multi?: boolean, elapsed?: number} = {}) => {
        time += options.elapsed ?? 100;
        let prevented = false;
        const touches = [touch(y, options.id ?? 7, options.x ?? 100)];
        if (options.multi) touches.push(touch(y, 8));
        listeners.get("sheet:" + type)?.({target: options.target || grip, touches, changedTouches: touches,
            cancelable: true, preventDefault: () => { prevented = true; }});
        return prevented;
    };
    return {element, scrim, grip, body, send, dispose, listeners, height: () => height, closes: () => closeCount,
        allow: (value: boolean) => { permitted = value; },
        closeWith: (value: () => Promise<void | boolean>) => { close = value; },
        markExit: () => { exiting = true; element.style.transform = "translateY(100%)"; },
        click: () => {
            let prevented = false;
            listeners.get("sheet:click")?.({preventDefault: () => { prevented = true; }, stopImmediatePropagation() {}});
            return prevented;
        }};
};
const settle = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };

test("grip continuously resizes an expanded sheet and large shrink alone never closes", async () => {
    const s = setup(800);
    s.send("touchstart", 0);
    assert.equal(s.send("touchmove", 500), true);
    assert.equal(s.height(), 300);
    assert.equal(s.element.style.transform, "translateY(0px)");
    s.send("touchend", 500);
    await settle();
    assert.equal(s.closes(), 0);
    assert.equal(s.height(), 300);
    assert.equal(s.click(), true);
});

test("same gesture beyond minimum requests guarded close and refusal rebounds at minimum", async () => {
    const s = setup();
    s.send("touchstart", 0);
    s.send("touchmove", 580);
    assert.equal(s.height(), 180);
    assert.equal(s.element.style.transform, "translateY(60px)");
    s.send("touchend", 580);
    await settle();
    assert.equal(s.closes(), 1);
    assert.equal(s.element.style.transform, "");
    assert.equal(s.height(), 180);
});

test("accepted void close retains host exit animation and disposal blocks late cleanup", async () => {
    const s = setup();
    s.closeWith(async () => { s.markExit(); });
    s.send("touchstart", 0);
    s.send("touchmove", 600);
    s.send("touchend", 600);
    await settle();
    assert.equal(s.element.style.transform, "translateY(100%)");
    const late = setup();
    let resolve: (value: boolean) => void;
    late.closeWith(() => new Promise(done => { resolve = done; }));
    late.send("touchstart", 0);
    late.send("touchmove", 600);
    late.send("touchend", 600);
    await settle();
    late.dispose();
    late.element.style.transform = "new owner";
    resolve(false);
    await settle();
    assert.equal(late.element.style.transform, "new owner");
    assert.equal(late.listeners.size, 0);
});

test("body keeps downward dismissal without resizing and editable actions stay native", async () => {
    const s = setup();
    s.send("touchstart", 0, {target: s.body});
    s.send("touchmove", 140, {target: s.body});
    assert.equal(s.height(), 700);
    s.send("touchend", 140);
    await settle();
    assert.equal(s.closes(), 1);
    const action = {closest: () => true};
    s.send("touchstart", 0, {target: action});
    assert.equal(s.send("touchmove", 100), false);
    assert.equal(s.height(), 700);
});

test("multitouch, wrong identifier, horizontal direction and viewport changes cancel active gestures", () => {
    for (const cancel of ["multi", "identity", "horizontal", "viewport", "orientation", "touchcancel"]) {
        const s = setup();
        s.send("touchstart", 0);
        s.send("touchmove", 100);
        if (cancel === "multi") s.send("touchmove", 150, {multi: true});
        if (cancel === "identity") s.send("touchmove", 150, {id: 8});
        if (cancel === "horizontal") s.send("touchmove", 150, {x: 900});
        if (cancel === "viewport") s.listeners.get("visual:resize")();
        if (cancel === "orientation") s.listeners.get("orientation:change")();
        if (cancel === "touchcancel") s.send("touchcancel", 100);
        s.send("touchend", 900);
        assert.equal(s.closes(), 0, cancel);
        assert.equal(s.height(), 600, cancel);
        assert.equal(s.element.style.transform, "", cancel);
    }
});

test("unrecognized taps preserve clicks and pending or non-topmost hosts can block initiation", () => {
    const s = setup();
    s.send("touchstart", 0);
    s.send("touchmove", 2);
    s.send("touchend", 2);
    assert.equal(s.click(), false);
    s.allow(false);
    s.send("touchstart", 0);
    s.send("touchmove", 700);
    assert.equal(s.height(), 700);
    assert.equal(s.click(), false);
});


test("an initially clipped short sheet has no phantom excess before reaching its actual starting height", async () => {
    const s = setup(150);
    s.send("touchstart", 0);
    s.send("touchmove", 5, {elapsed: 1000});
    s.send("touchend", 5);
    await settle();
    assert.equal(s.height(), 150);
    assert.equal(s.closes(), 0);
});


test("pending or covered state starting during a drag cancels further resizing and closing", async () => {
    const s = setup();
    s.send("touchstart", 0);
    s.send("touchmove", 100);
    s.allow(false);
    s.send("touchmove", 600);
    s.send("touchend", 600);
    await settle();
    assert.equal(s.height(), 600);
    assert.equal(s.closes(), 0);
});


test("pending or child dialog appearing before touchend cancels without another touchmove", async () => {
    const s = setup();
    s.send("touchstart", 0);
    s.send("touchmove", 100);
    s.allow(false);
    s.send("touchend", 600);
    await settle();
    assert.equal(s.height(), 600);
    assert.equal(s.closes(), 0);
    assert.equal(s.element.style.transform, "");
});


for (const event of ["touchmove", "touchend", "touchcancel"]) {
    test(`external close during a gesture retains exit visuals through ${event}`, async () => {
        const s = setup();
        s.send("touchstart", 0);
        s.send("touchmove", 100);
        s.markExit();
        s.element.style.transition = "exit transition";
        s.scrim.style.opacity = "0";
        s.send(event, 150);
        s.send("touchend", 900);
        await settle();
        assert.equal(s.height(), 600);
        assert.equal(s.element.style.transform, "translateY(100%)");
        assert.equal(s.element.style.transition, "exit transition");
        assert.equal(s.scrim.style.opacity, "0");
        assert.equal(s.closes(), 0);
    });
}

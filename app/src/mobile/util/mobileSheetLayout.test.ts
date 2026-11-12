import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {getMobileSheetBounds} from "./mobileSheetGesture";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";

const source = transpileModule(readFileSync("src/mobile/util/mobileSheetLayout.ts", "utf8"), {
    compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
}).outputText;

const setup = () => {
    const listeners = new Map<string, Set<() => void>>();
    const target = (prefix: string) => ({
        addEventListener: (name: string, callback: () => void) => {
            const key = `${prefix}:${name}`;
            if (!listeners.has(key)) listeners.set(key, new Set());
            listeners.get(key).add(callback);
        },
        removeEventListener: (name: string, callback: () => void) => listeners.get(`${prefix}:${name}`)?.delete(callback),
    });
    const window = {...target("window"), innerHeight: 800,
        screen: {orientation: {...target("orientation"), type: "portrait-primary"}},
        visualViewport: target("visual"),
        siyuan: {mobile: {size: {isLandscape: false, portrait: {height1: 800}, landscape: {height1: 390}}}},
    };
    const viewport = {top: 0, bottom: 800};
    const toolbar = {hidden: true, top: 752, classList: {contains: () => toolbar.hidden},
        getBoundingClientRect: () => ({top: toolbar.top})};
    const classes = () => {
        const values = new Set<string>();
        return {add: (value: string) => values.add(value), contains: (value: string) => values.has(value),
            toggle: (value: string, enabled: boolean) => enabled ? values.add(value) : values.delete(value)};
    };
    const overlay = {isConnected: true, classList: classes(), style: {top: "", bottom: "", height: ""}, paddingTop: 0, paddingBottom: 0};
    const sheet = {querySelectorAll: (): HTMLElement[] => [], scrollTop: 0, scrollLeft: 0, querySelector: () => ({style: {flex: ""}, querySelector: (): null => null,
        getBoundingClientRect: () => ({height: sheet.contentHeight - sheet.chromeHeight})}), classList: classes(), style: {height: "", maxHeight: ""}, contentHeight: 120, chromeHeight: 40,
        getBoundingClientRect: () => ({height: Math.min(sheet.style.height === "auto" ? sheet.contentHeight :
            parseFloat(sheet.style.height), (sheet.style.maxHeight === "none" ? Infinity : parseFloat(sheet.style.maxHeight)))})};
    let observer: () => void;
    let connected = false;
    const exports: any = {};
    runInNewContext(source, {exports, window,
        document: {getElementById: () => toolbar},
        getComputedStyle: () => ({paddingTop: `${overlay.paddingTop}px`, paddingBottom: `${overlay.paddingBottom}px`}),
        MutationObserver: class {
            constructor(callback: () => void) { observer = callback; }
            observe() { connected = true; }
            disconnect() { connected = false; }
        },
        require: () => ({getMobileSheetBounds, getVisibleViewportBounds: () => viewport,
            isMobileLandscape: () => window.screen.orientation.type.startsWith("landscape")}),
    });
    let notifications = 0;
    const layout = exports.bindMobileSheetLayout(overlay, sheet, {onResize: () => notifications++});
    return {window, viewport, toolbar, overlay, sheet, layout, exports,
        emit: (name: string) => listeners.get(name)?.forEach(callback => callback()),
        resizeToolbar: () => observer(), notifications: () => notifications,
        listening: () => Array.from(listeners.values()).reduce((total, callbacks) => total + callbacks.size, 0),
        observed: () => connected};
};

test("standard sheets use natural content height below a shared full-viewport upper limit", () => {
    const s = setup();
    assert.equal(s.sheet.style.height, "auto");
    assert.ok(Math.abs(parseFloat(s.sheet.style.maxHeight) - 448) < .001);
    assert.equal(s.sheet.getBoundingClientRect().height, 120);
    s.sheet.contentHeight = 1000;
    assert.ok(Math.abs(s.sheet.getBoundingClientRect().height - 448) < .001);
    s.window.innerHeight = 300;
    s.viewport.bottom = 300;
    s.emit("visual:resize");
    assert.equal(s.sheet.getBoundingClientRect().height, 300);
    s.sheet.contentHeight = 120;
    assert.equal(s.sheet.getBoundingClientRect().height, 120, "the keyboard never expands short content");
});

test("unclipped sheets anchor to the CSS viewport bottom instead of rounding its height", () => {
    const s = setup();
    assert.equal(s.overlay.style.bottom, "0px");
    assert.equal(s.overlay.style.height, "auto");
    s.viewport.top = 20.25;
    s.layout.resize();
    assert.equal(s.overlay.style.top, "20.25px");
    assert.equal(s.overlay.style.bottom, "0px");
    s.viewport.bottom = 350.25;
    s.layout.resize();
    assert.equal(s.overlay.style.bottom, "auto");
    assert.equal(s.overlay.style.height, "330px");
    s.viewport.bottom = s.window.innerHeight;
    s.toolbar.hidden = false;
    s.toolbar.top = 752.5;
    s.resizeToolbar();
    assert.equal(s.overlay.style.bottom, "auto");
    assert.equal(s.overlay.style.height, "732.25px");
    s.toolbar.hidden = true;
    s.resizeToolbar();
    assert.equal(s.overlay.style.bottom, "0px");
    assert.equal(s.overlay.style.height, "auto");
});

test("toolbar, visible offset and safe areas clip the upper limit once", () => {
    const s = setup();
    s.viewport.top = 30;
    s.viewport.bottom = 350;
    s.overlay.paddingTop = 20;
    s.overlay.paddingBottom = 30;
    s.toolbar.hidden = false;
    s.toolbar.top = 300;
    s.resizeToolbar();
    assert.equal(s.overlay.style.top, "30px");
    assert.equal(s.overlay.style.height, "270px");
    assert.equal(s.sheet.style.maxHeight, "220px");
    s.toolbar.top = 900;
    s.resizeToolbar();
    assert.equal(s.sheet.style.maxHeight, "270px", "an offscreen toolbar cannot extend the visible region");
    s.viewport.bottom = 10;
    s.layout.resize();
    assert.equal(s.sheet.style.maxHeight, "0px");
});

test("direction changes use their own cache even before the toolbar direction flag updates", () => {
    const s = setup();
    s.window.screen.orientation.type = "landscape-primary";
    s.window.innerHeight = 390;
    s.viewport.bottom = 390;
    s.emit("orientation:change");
    assert.equal(s.window.siyuan.mobile.size.isLandscape, false);
    assert.ok(Math.abs(parseFloat(s.sheet.style.maxHeight) - 218.4) < .001);
    s.window.innerHeight = 180;
    s.viewport.bottom = 180;
    s.emit("window:orientationchange");
    assert.equal(s.sheet.style.maxHeight, "180px");
});

test("expanded mode explicitly occupies the available region and can return to natural size", () => {
    const s = setup();
    s.layout.setMode("expanded");
    assert.equal(s.sheet.style.height, "800px");
    s.layout.setMode("standard");
    assert.equal(s.sheet.style.height, "auto");
    assert.equal(s.sheet.getBoundingClientRect().height, 120);
});

test("exit freezes actual clipped height while viewport updates continue", () => {
    const s = setup();
    s.sheet.contentHeight = 1000;
    s.viewport.bottom = 250;
    s.layout.resize();
    s.layout.freeze();
    assert.equal(s.sheet.style.height, "250px");
    s.viewport.bottom = 800;
    s.emit("visual:resize");
    assert.equal(s.overlay.style.bottom, "0px");
    assert.equal(s.overlay.style.height, "auto");
    assert.equal(s.sheet.style.height, "250px");
    assert.equal(s.sheet.style.maxHeight, "250px");
});

test("all viewport changes notify the caller and disposal removes listeners and observers", () => {
    const s = setup();
    const before = s.notifications();
    for (const name of ["window:resize", "visual:resize", "visual:scroll", "orientation:change", "window:orientationchange"]) {
        s.emit(name);
    }
    s.resizeToolbar();
    assert.equal(s.notifications(), before + 6);
    s.layout.dispose();
    s.layout.dispose();
    assert.equal(s.listening(), 0);
    assert.equal(s.observed(), false);
    s.layout.resize();
    assert.equal(s.notifications(), before + 6);
});


test("manual height survives content changes and expand collapse while keyboard clips only rendering", () => {
    const s = setup();
    s.layout.setPreferredHeight(650);
    assert.equal(s.sheet.style.height, "650px");
    s.sheet.contentHeight = 900;
    s.layout.resize();
    assert.equal(s.sheet.style.height, "650px");
    s.layout.setMode("expanded");
    assert.equal(s.sheet.style.height, "800px");
    s.layout.setMode("standard");
    assert.equal(s.sheet.style.height, "650px");
    s.viewport.bottom = 220;
    s.emit("visual:resize");
    assert.equal(s.sheet.style.height, "220px");
    s.viewport.bottom = 800;
    s.emit("visual:resize");
    assert.equal(s.sheet.style.height, "650px");
});

test("minimum measurement restores manual size and remains natural for short content", () => {
    const s = setup();
    s.layout.setPreferredHeight(650);
    assert.equal(s.layout.getBounds().min, 120);
    assert.equal(s.sheet.style.height, "650px");
});


test("new minimum clamps rendered manual height without replacing its preferred height", () => {
    const s = setup();
    s.layout.setPreferredHeight(130);
    assert.equal(s.sheet.style.height, "130px");
    s.sheet.contentHeight = 900;
    s.layout.resize();
    assert.equal(s.sheet.style.height, "160px");
    s.sheet.contentHeight = 120;
    s.layout.resize();
    assert.equal(s.sheet.style.height, "130px");
});


test("footer or header growth raises the rendered minimum without destroying the chosen size", () => {
    const s = setup();
    s.sheet.contentHeight = 900;
    s.layout.setPreferredHeight(300);
    s.sheet.chromeHeight = 240;
    s.layout.resize();
    assert.equal(s.sheet.style.height, "360px");
    s.sheet.chromeHeight = 40;
    s.layout.resize();
    assert.equal(s.sheet.style.height, "300px");
});


test("landscape initial cap below readable minimum does not grow on the first tiny downward resize", () => {
    const s = setup();
    s.window.screen.orientation.type = "landscape-primary";
    s.window.innerHeight = 390;
    s.viewport.bottom = 390;
    s.sheet.contentHeight = 900;
    s.sheet.chromeHeight = 160;
    s.layout.resize();
    const initial = s.sheet.getBoundingClientRect().height;
    assert.ok(initial < 280);
    assert.equal(s.layout.getBounds().min, initial);
    s.layout.setPreferredHeight(initial);
    assert.equal(s.sheet.getBoundingClientRect().height, initial);
    s.sheet.chromeHeight = 240;
    s.layout.resize();
    assert.equal(s.sheet.getBoundingClientRect().height, 240, "essential chrome stays visible when it grows beyond the standard cap");
});


test("visual viewport constraints activate compact chrome even when layout viewport stays tall", () => {
    const s = setup();
    s.viewport.bottom = 100;
    s.emit("visual:resize");
    assert.equal(s.window.innerHeight, 800);
    assert.equal(s.sheet.classList.contains("mobile-sheet-panel--compact"), true);
    s.viewport.bottom = 800;
    s.emit("visual:resize");
    assert.equal(s.sheet.classList.contains("mobile-sheet-panel--compact"), false);
});

test("drag height updates reuse measured bounds until geometry changes", () => {
    const s = setup();
    let scans = 0;
    s.sheet.querySelectorAll = () => { scans++; return []; };
    s.layout.getBounds();
    assert.equal(scans, 1);
    for (let height = 300; height < 400; height++) s.layout.setPreferredHeight(height);
    assert.equal(scans, 1);
    assert.equal(s.sheet.style.height, "399px");
    s.layout.resize();
    assert.equal(scans, 2);
    s.layout.setPreferredHeight(350);
    assert.equal(scans, 2);
});

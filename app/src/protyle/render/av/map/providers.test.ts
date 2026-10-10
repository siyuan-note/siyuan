import * as assert from "node:assert/strict";
import {test} from "node:test";
import {AV_MAP_OPENFREEMAP_STYLE, createAVMapAdapter} from "./providers";
import {AV_MAP_ATTRIBUTION_LINKS} from "./protocol";

const {AJAXError, Evented} = require("maplibre-gl");

// 瓦片数据形状依照 TileManager._loadTile；事件冒泡和 HTTP 异常使用实际 SDK 实现。
const tileError = (status: number) => ({type: "error", sourceId: "fixture",
    error: new AJAXError(status, "Fixture HTTP status", "https://fixture.invalid/tile", new Blob()),
    tile: {state: "errored", tileID: {canonical: {z: 2, x: 1, y: 1}}}});

const fixture = () => {
    const instances: any[] = [];
    const calls: Array<[string, ...any[]]> = [];
    const frames = new Map<number, (now: number) => void>();
    const events = new Map<string, (event: any) => void>();
    const documentEvents = new Map<string, () => void>();
    const classes = new Set<string>();
    let now = 0, nextFrame = 0;
    const rect = {left: 0, top: 0, right: 300, bottom: 24, width: 300, height: 24};
    const attributionText = {textContent: "MapLibre OpenFreeMap OpenStreetMap OpenMapTiles", getClientRects: () => [rect],
        getBoundingClientRect: () => ({left: rect.left + 8, right: rect.right - 28, top: rect.top + 2,
            bottom: rect.bottom - 2, width: rect.width - 36, height: rect.height - 4})};
    const attribution: any = {tagName: "DETAILS", open: true, querySelector: () => attributionText,
        classList: {toggle: (name: string, on: boolean) => on ? classes.add(name) : classes.delete(name),
            contains: (name: string) => classes.has(name)},
        addEventListener: (name: string, callback: (event: any) => void) => events.set(name, callback),
        removeEventListener: (name: string) => events.delete(name),
        getClientRects: () => [rect], getBoundingClientRect: () => rect,
        contains: (target: unknown) => [attribution, attributionText, anchor, summary].includes(target)};
    const anchor = {href: "", getAttribute: () => anchor.href, closest: (selector: string): any => selector === "a" ? anchor : null};
    const summary = {closest: (selector: string): any => selector === "summary" ? summary : null};
    const scope = {innerWidth: 800, innerHeight: 600, navigator: {userActivation: {isActive: true}},
        requestAnimationFrame: (callback: (now: number) => void) => { frames.set(++nextFrame, callback); return nextFrame; },
        cancelAnimationFrame: (id: number) => frames.delete(id)};
    const doc = {documentElement: {dataset: {}}, defaultView: scope, hidden: false,
        elementFromPoint: (() => attribution) as (x: number, y: number) => unknown,
        addEventListener: (name: string, callback: () => void) => documentEvents.set(name, callback),
        removeEventListener: (name: string) => documentEvents.delete(name)};
    class SDKObject {
        callbacks = new Map<string, (...args: any[]) => void>();
        constructor(...args: any[]) { calls.push([new.target.name, ...args]); instances.push(this); }
        on(event: string, callback: (...args: any[]) => void) { this.callbacks.set(event, callback); }
        off(event: string) { this.callbacks.delete(event); }
        addEventListener(event: string, callback: (...args: any[]) => void) { this.on(event, callback); }
        removeEventListener(event: string) { this.off(event); }
        remove() { calls.push(["remove"]); }
        setLngLat(...args: any[]) { calls.push(["setLngLat", ...args]); return this; }
        addTo() { return this; }
        getElement() { return this; }
        fitBounds(...args: any[]) { calls.push(["fitBounds", ...args]); }
        resize() { calls.push(["resize"]); }
        extend(...args: any[]) { calls.push(["extend", ...args]); }
        addControl(control: unknown) { calls.push(["addControl", control]); }
    }
    const sdk = {Map: class Map extends SDKObject {}, Marker: class Marker extends SDKObject {},
        LngLatBounds: class LngLatBounds extends SDKObject {}, AttributionControl: class AttributionControl extends SDKObject {}};
    const container = {ownerDocument: doc, querySelector: () => attribution,
        replaceChildren() { calls.push(["clear"]); }};
    return {sdk, calls, instances, container: container as unknown as HTMLElement, attribution, frames, events, documentEvents, doc, scope, rect,
        load: () => instances[0].callbacks.get("load")(),
        advance: (milliseconds: number) => {
            now += milliseconds;
            const pending = [...frames.values()]; frames.clear(); pending.forEach(callback => callback(now));
        },
        visibility: (hidden: boolean) => { doc.hidden = hidden; documentEvents.get("visibilitychange")?.(); },
        click: (href?: string, values: Record<string, unknown> = {}) => {
            anchor.href = href;
            const event = {target: href === undefined ? summary : anchor, isTrusted: true, button: 0,
                preventDefault() { this.prevented = true; }, stopImmediatePropagation() {}, ...values};
            events.get("click")?.(event);
            return event;
        }};
};

const visibleViewport = {x: 0, y: 0, width: 800, height: 600};

test("OpenFreeMap preserves longitude/latitude, attribution and cleans stale callbacks", () => {
    const {sdk, calls, instances, container} = fixture();
    const clicked: Array<[string, number]> = [];
    const adapter = createAVMapAdapter("openfreemap", sdk, container, {
        onMarkerClick: (id, revision) => clicked.push([id, revision]), onError: () => assert.fail("SDK error"),
    });
    const point = {id: "row-1", longitude: 121, latitude: 31};
    adapter.setPoints([point, {...point, id: "invalid", latitude: 90}], 1);
    const marker = instances.find(instance => instance.callbacks.has("click"));
    const oldClick = marker.callbacks.get("click");
    oldClick();
    assert.deepEqual(clicked, [["row-1", 1]]);
    assert.equal(calls.find(call => call[0] === "Map")[1].style, AV_MAP_OPENFREEMAP_STYLE);
    assert.equal(calls.find(call => call[0] === "Map")[1].attributionControl, false);
    assert.equal(calls.find(call => call[0] === "AttributionControl")[1].compact, true);
    assert.match(calls.find(call => call[0] === "AttributionControl")[1].customAttribution, /https:\/\/maplibre.org\//);
    assert.deepEqual(calls.filter(call => call[0] === "setLngLat"), [["setLngLat", [121, 31]]]);
    adapter.fit();
    adapter.resize();
    adapter.setTheme("dark");
    adapter.setPoints([{...point, id: "row-2"}], 2);
    oldClick();
    assert.equal(clicked.length, 1);
    adapter.setPoints([point], 1);
    adapter.setPoints([], 3);
    adapter.fit();
    adapter.destroy();
    const count = calls.length;
    adapter.destroy();
    adapter.setPoints([point], 4);
    adapter.fit();
    adapter.resize();
    adapter.setTheme("light");
    oldClick();
    assert.equal(calls.length, count);
    assert.equal(clicked.length, 1);
    assert.equal(calls.filter(call => call[0] === "clear").length, 1);
});

test("attribution waits for five continuously visible seconds after load and stays expandable", () => {
    const f = fixture();
    const adapter = createAVMapAdapter("openfreemap", f.sdk, f.container, {onMarkerClick() {}, onError() {}});
    f.advance(10000);
    assert.equal(f.attribution.open, true);
    adapter.setVisible(true, visibleViewport);
    f.advance(10000);
    assert.equal(f.attribution.open, true, "no clock before the map loads");
    f.load(); f.advance(0); f.advance(4999);
    assert.equal(f.attribution.open, true);
    adapter.setVisible(false); f.advance(10000); adapter.setVisible(true, visibleViewport); f.advance(0); f.advance(4999);
    assert.equal(f.attribution.open, true, "hidden native views cannot consume the initial display");
    f.visibility(true); f.advance(10000); f.visibility(false); f.advance(0); f.advance(4999);
    assert.equal(f.attribution.open, true, "background tabs restart the display clock");
    f.rect.bottom = 700; f.advance(1); f.rect.bottom = 24; f.advance(0); f.advance(4999);
    assert.equal(f.attribution.open, true, "cropped attribution cannot consume display time");
    f.advance(1);
    assert.equal(f.attribution.open, false);
    assert.equal(f.frames.size, 0);
    f.click(undefined, {isTrusted: false});
    assert.equal(f.attribution.open, false);
    f.click();
    assert.equal(f.attribution.open, true);
    f.advance(20000);
    f.attribution.open = false;
    f.instances[0].callbacks.get("drag")();
    assert.equal(f.attribution.open, true, "map interaction preserves the user's expanded choice");
    adapter.destroy();
    assert.equal(f.events.size, 0);
    assert.equal(f.frames.size, 0);
});

test("trusted attribution interaction cancels auto-collapse and only exact official links leave the frame", () => {
    const f = fixture();
    const clicked: string[] = [];
    const adapter = createAVMapAdapter("openfreemap", f.sdk, f.container, {
        onMarkerClick() {}, onError() {}, onAttributionClick: link => clicked.push(link),
    });
    f.load(); adapter.setVisible(true, visibleViewport); f.advance(0); f.advance(2000);
    f.events.get("keydown")({isTrusted: true});
    f.advance(10000);
    assert.equal(f.attribution.open, true);
    for (const link of AV_MAP_ATTRIBUTION_LINKS.openfreemap) {
        assert.equal((f.click(link.href) as any).prevented, true);
    }
    assert.deepEqual(clicked, AV_MAP_ATTRIBUTION_LINKS.openfreemap.map(link => link.id));
    for (const href of ["https://maplibre.org/?secret=x", "https://maplibre.org/#secret", "https://maplibre.org:443/",
        "http://maplibre.org/", "javascript:alert(1)", "https://evil.invalid/", "https://maplibre.org.evil.invalid/"]) {
        f.click(href);
    }
    f.click("https://maplibre.org/", {isTrusted: false});
    f.click("https://maplibre.org/", {button: 1});
    f.scope.navigator.userActivation.isActive = false;
    f.click("https://maplibre.org/");
    f.scope.navigator.userActivation.isActive = true;
    adapter.setVisible(false); f.click("https://maplibre.org/");
    assert.equal(clicked.length, 4);
    adapter.destroy();
    f.click("https://maplibre.org/");
    assert.equal(clicked.length, 4);
});

test("rounded attribution corners do not prevent its visible text from completing the display clock", () => {
    const f = fixture();
    const adapter = createAVMapAdapter("openfreemap", f.sdk, f.container, {onMarkerClick() {}, onError() {}});
    f.doc.elementFromPoint = (x: number, y: number) =>
        (x < 8 || x > 292) && (y < 2 || y > 22) ? f.container : f.attribution;
    f.load(); adapter.setVisible(true, visibleViewport); f.advance(0); f.advance(4999);
    assert.equal(f.attribution.open, true);
    assert.equal(f.attribution.classList.contains("maplibregl-compact-show"), true);
    f.advance(1);
    assert.equal(f.attribution.open, false);
    assert.equal(f.attribution.classList.contains("maplibregl-compact-show"), false);
    adapter.destroy();
});

test("trusted local disclosure clicks survive host visibility transitions without permitting external navigation", () => {
    const f = fixture();
    const clicked: string[] = [];
    const adapter = createAVMapAdapter("openfreemap", f.sdk, f.container, {
        onMarkerClick() {}, onError() {}, onAttributionClick: link => clicked.push(link),
    });
    f.load(); adapter.setVisible(true, visibleViewport); f.advance(0);
    f.scope.navigator.userActivation.isActive = false;
    adapter.setVisible(false);
    assert.equal((f.click() as any).prevented, true);
    assert.equal(f.attribution.open, false);
    assert.equal(f.attribution.classList.contains("maplibregl-compact-show"), false);
    f.click("https://maplibre.org/");
    assert.deepEqual(clicked, []);
    f.click(undefined, {isTrusted: false});
    assert.equal(f.attribution.open, false);
    adapter.setVisible(true, visibleViewport);
    f.click();
    assert.equal(f.attribution.open, true);
    f.advance(10000);
    assert.equal(f.attribution.open, true, "the user's disclosure choice cancels automatic collapse");
    f.click("https://maplibre.org/");
    assert.deepEqual(clicked, []);
    f.scope.navigator.userActivation.isActive = true;
    f.click("https://maplibre.org/");
    assert.deepEqual(clicked, ["maplibre"]);
    adapter.destroy();
});

test("attribution display time respects parent clipping and translated native viewport coordinates", () => {
    const f = fixture();
    const adapter = createAVMapAdapter("openfreemap", f.sdk, f.container, {onMarkerClick() {}, onError() {}});
    f.load();
    Object.assign(f.rect, {left: 480, right: 780, top: 560, bottom: 584});
    adapter.setVisible(true, {x: 0, y: 0, width: 800, height: 500});
    f.advance(0); f.advance(10000);
    assert.equal(f.attribution.open, true, "a clipped bottom edge cannot consume display time");
    adapter.setVisible(true, {x: 0, y: 100, width: 800, height: 500});
    f.advance(0); f.advance(4999);
    assert.equal(f.attribution.open, true);
    f.advance(1);
    assert.equal(f.attribution.open, false, "a hidden top edge still permits five seconds of visible attribution");
    adapter.destroy();

    const native = fixture();
    const nativeAdapter = createAVMapAdapter("openfreemap", native.sdk, native.container, {onMarkerClick() {}, onError() {}});
    native.load();
    // DOM 矩形已经包含原生 preload 的 translate(-crop)，此处不再传入或减去 crop。
    Object.assign(native.rect, {left: 280, right: 580, top: 160, bottom: 184});
    native.scope.innerWidth = 600; native.scope.innerHeight = 200;
    nativeAdapter.setVisible(true, {x: 0, y: 0, width: 600, height: 200});
    native.advance(0); native.advance(5000);
    assert.equal(native.attribution.open, false);
    nativeAdapter.destroy();
});

test("removed providers cannot create a map", () => {
    for (const provider of ["amap", "tencent", "baidu"]) {
        const {sdk, calls, container} = fixture();
        assert.throws(() => createAVMapAdapter(provider as any, sdk, container, {onMarkerClick() {}, onError() {}}),
            /invalidConfiguration/);
        assert.equal(calls.length, 0);
    }
});

test("fully visible viewport changes preserve the continuous attribution display clock", () => {
    const f = fixture();
    const adapter = createAVMapAdapter("openfreemap", f.sdk, f.container, {onMarkerClick() {}, onError() {}});
    f.load();
    adapter.setVisible(true, visibleViewport);
    f.advance(0);
    f.advance(4000);
    adapter.setVisible(true, {...visibleViewport, width: 790});
    f.advance(1000);
    assert.equal(f.attribution.open, false, "five uninterrupted visible seconds include a viewport resize");
    adapter.destroy();
});

test("a simulated SDK tile 503 after load preserves the ready map", () => {
    const f = fixture();
    const errors: string[] = [];
    const adapter = createAVMapAdapter("openfreemap", f.sdk, f.container, {
        onMarkerClick() {}, onError: code => { errors.push(code); adapter.destroy(); },
    });
    f.load();
    const source = new Evented();
    const map = new Evented();
    source.setEventedParent(map, {sourceId: "fixture"});
    map.on("error", f.instances[0].callbacks.get("error"));
    const event = tileError(503);
    source.fire("error", {error: event.error, tile: event.tile});
    assert.deepEqual(errors, []);
    assert.equal(f.calls.filter(call => call[0] === "remove").length, 0);
    adapter.destroy();
});

test("only recognized temporary tile HTTP errors after the first load preserve the map", () => {
    for (const status of [408, 429, 500, 502, 503, 504]) {
        const f = fixture();
        const errors: string[] = [];
        const adapter = createAVMapAdapter("openfreemap", f.sdk, f.container, {
            onMarkerClick() {}, onError: code => errors.push(code),
        });
        const error = f.instances[0].callbacks.get("error");
        error(tileError(status));
        assert.deepEqual(errors, ["mapUnavailable"], "the same failure before load is fatal");
        f.load();
        error(tileError(status));
        assert.deepEqual(errors, ["mapUnavailable"]);
        adapter.destroy();
        error(tileError(status));
        assert.deepEqual(errors, ["mapUnavailable"], "late SDK errors cannot resurrect a destroyed map");
    }
});

test("ready maps still report startup, source, worker, authorization and unknown errors safely", () => {
    const variants = [undefined, {}, {error: new Error("private worker failure")},
        ...[0, 401, 403, 404, 501, 505].map(tileError),
        {...tileError(503), tile: undefined}, {...tileError(503), sourceId: ""},
        {...tileError(503), error: {status: "503", message: "private URL"}},
        {...tileError(503), tile: {state: "loaded", tileID: {canonical: {z: 2, x: 1, y: 1}}}},
        ...[{z: -1, x: 0, y: 0}, {z: 26, x: 1, y: 1}, {z: 2.5, x: 1, y: 1},
            {z: 2, x: 4, y: 1}, {z: 2, x: 1, y: Infinity}, {z: "2", x: 1, y: 1}]
            .map(canonical => ({...tileError(503), tile: {state: "errored", tileID: {canonical}}})),
    ];
    for (const event of variants) {
        const f = fixture();
        const errors: string[] = [];
        const adapter = createAVMapAdapter("openfreemap", f.sdk, f.container, {
            onMarkerClick() {}, onError: code => { errors.push(code); adapter.destroy(); },
        });
        f.load();
        f.instances[0].callbacks.get("error")(event);
        assert.deepEqual(errors, ["mapUnavailable"]);
        assert.equal(f.calls.filter(call => call[0] === "remove").length, 1);
    }
});

test("viewport clipping and occlusion reset accumulated time, including between animation frames", () => {
    const f = fixture();
    const adapter = createAVMapAdapter("openfreemap", f.sdk, f.container, {onMarkerClick() {}, onError() {}});
    f.load(); adapter.setVisible(true, visibleViewport); f.advance(0); f.advance(4000);
    adapter.setVisible(true, {...visibleViewport, width: 290});
    adapter.setVisible(true, visibleViewport);
    f.advance(0); f.advance(1000);
    assert.equal(f.attribution.open, true, "brief clipping interrupts continuous display");
    f.doc.elementFromPoint = () => f.container;
    f.advance(0);
    f.doc.elementFromPoint = () => f.attribution;
    f.advance(0); f.advance(4999);
    assert.equal(f.attribution.open, true);
    f.advance(1);
    assert.equal(f.attribution.open, false);
    adapter.destroy();
});

test("destruction cancels pending attribution time and late DOM or SDK callbacks", () => {
    const f = fixture();
    const adapter = createAVMapAdapter("openfreemap", f.sdk, f.container, {onMarkerClick() {}, onError() {}});
    f.load(); adapter.setVisible(true, visibleViewport); f.advance(0); f.advance(4000);
    const tick = [...f.frames.values()][0];
    const click = f.events.get("click");
    const drag = f.instances[0].callbacks.get("drag");
    adapter.destroy();
    assert.equal(f.frames.size, 0);
    assert.equal(f.events.size, 0);
    tick(10000);
    click({target: {closest: (selector: string) => selector === "summary" ? {} : null}, isTrusted: true,
        button: 0, preventDefault() {}, stopImmediatePropagation() {}});
    drag();
    assert.equal(f.attribution.open, true);
    assert.equal(f.frames.size, 0);
});

test("attribution initialization failures clean the already created map and partial listeners", () => {
    for (const stage of ["control", "missingDOM", "eventRegistration", "initialState"]) {
        const f = fixture();
        const failure = () => { throw new Error("fixture initialization failure"); };
        if (stage === "control") f.sdk.Map.prototype.addControl = failure;
        if (stage === "missingDOM") f.container.querySelector = (): null => null;
        if (stage === "eventRegistration") f.sdk.Map.prototype.on = failure;
        if (stage === "initialState") f.attribution.classList.toggle = failure;
        assert.throws(() => createAVMapAdapter("openfreemap", f.sdk, f.container, {onMarkerClick() {}, onError() {}}));
        assert.equal(f.calls.filter(call => call[0] === "remove").length, 1, stage);
        assert.equal(f.calls.filter(call => call[0] === "clear").length, 1, stage);
        assert.equal(f.events.size, 0, stage);
        assert.equal(f.documentEvents.size, 0, stage);
        assert.equal(f.frames.size, 0, stage);
    }
});

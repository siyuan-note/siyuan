import * as assert from "node:assert/strict";
import {test} from "node:test";
import {AV_MAP_OPENFREEMAP_STYLE, createAVMapAdapter} from "./providers";
import {AV_MAP_ATTRIBUTION_LINKS} from "./protocol";

const fixture = () => {
    const instances: any[] = [];
    const calls: Array<[string, ...any[]]> = [];
    const frames = new Map<number, (now: number) => void>();
    const events = new Map<string, (event: any) => void>();
    const documentEvents = new Map<string, () => void>();
    const classes = new Set<string>();
    let now = 0, nextFrame = 0;
    const rect = {left: 0, top: 0, right: 300, bottom: 24, width: 300, height: 24};
    const attribution: any = {open: true, textContent: "MapLibre OpenFreeMap OpenStreetMap OpenMapTiles",
        classList: {toggle: (name: string, on: boolean) => on ? classes.add(name) : classes.delete(name)},
        addEventListener: (name: string, callback: (event: any) => void) => events.set(name, callback),
        removeEventListener: (name: string) => events.delete(name),
        getClientRects: () => [rect], getBoundingClientRect: () => rect,
        contains: (target: unknown) => target === attribution || target === anchor || target === summary};
    const anchor = {href: "", getAttribute: () => anchor.href, closest: (selector: string): any => selector === "a" ? anchor : null};
    const summary = {closest: (selector: string): any => selector === "summary" ? summary : null};
    const scope = {innerWidth: 800, innerHeight: 600, navigator: {userActivation: {isActive: true}},
        requestAnimationFrame: (callback: (now: number) => void) => { frames.set(++nextFrame, callback); return nextFrame; },
        cancelAnimationFrame: (id: number) => frames.delete(id)};
    const doc = {documentElement: {dataset: {}}, defaultView: scope, hidden: false,
        elementFromPoint: (): unknown => attribution,
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
    return {sdk, calls, instances, container: container as unknown as HTMLElement, attribution, frames, events, doc, scope, rect,
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

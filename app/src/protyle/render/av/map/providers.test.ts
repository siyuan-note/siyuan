import * as assert from "node:assert/strict";
import {test} from "node:test";
import {AV_MAP_OPENFREEMAP_STYLE, createAVMapAdapter} from "./providers";

const fixture = () => {
    const instances: any[] = [];
    const calls: Array<[string, ...any[]]> = [];
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
    }
    const sdk = {Map: class Map extends SDKObject {}, Marker: class Marker extends SDKObject {},
        LngLatBounds: class LngLatBounds extends SDKObject {}};
    const container = {ownerDocument: {documentElement: {dataset: {}}}, replaceChildren() { calls.push(["clear"]); }};
    return {sdk, calls, instances, container: container as unknown as HTMLElement};
};

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
    assert.equal(calls.find(call => call[0] === "Map")[1].attributionControl, true);
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

test("removed providers cannot create a map", () => {
    for (const provider of ["amap", "tencent", "baidu"]) {
        const {sdk, calls, container} = fixture();
        assert.throws(() => createAVMapAdapter(provider as any, sdk, container, {onMarkerClick() {}, onError() {}}),
            /invalidConfiguration/);
        assert.equal(calls.length, 0);
    }
});

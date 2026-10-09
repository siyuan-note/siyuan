import * as assert from "node:assert/strict";
import {describe, it} from "node:test";
import {AVMapProvider} from "./protocol";
import {AV_MAP_OPENFREEMAP_STYLE, createAVMapAdapter} from "./providers";

const fixture = () => {
    const instances: any[] = [];
    const calls: Array<[string, ...any[]]> = [];
    class SDKObject {
        callbacks = new Map<string, (...args: any[]) => void>();
        constructor(...args: any[]) {
            calls.push([new.target.name, ...args]);
            instances.push(this);
        }
        on(event: string, callback: (...args: any[]) => void) { this.callbacks.set(event, callback); }
        off(event: string) { this.callbacks.delete(event); }
        addEventListener(event: string, callback: (...args: any[]) => void) { this.on(event, callback); }
        removeEventListener(event: string) { this.off(event); }
        remove() { calls.push(["remove"]); }
        destroy() { calls.push(["destroy"]); }
        dispose() { calls.push(["dispose"]); }
        setMap(...args: any[]) { calls.push(["setMap", ...args]); }
        setLngLat(...args: any[]) { calls.push(["setLngLat", ...args]); return this; }
        addTo() { return this; }
        getElement() { return this; }
        setGeometries(...args: any[]) { calls.push(["setGeometries", ...args]); }
        fitBounds(...args: any[]) { calls.push(["fitBounds", ...args]); }
        setFitView(...args: any[]) { calls.push(["setFitView", ...args]); }
        setViewport(...args: any[]) { calls.push(["setViewport", ...args]); }
        setMapStyle(...args: any[]) { calls.push(["setMapStyle", ...args]); }
        setTheme(...args: any[]) { calls.push(["setTheme", ...args]); }
        centerAndZoom(...args: any[]) { calls.push(["centerAndZoom", ...args]); }
        enableScrollWheelZoom() {}
        disableMapClick() {}
        disableIconInfoWindow() {}
        addOverlay() {}
        removeOverlay() {}
        clearOverlays() {}
        getPosition() { return "sdk-position"; }
        resize() { calls.push(["resize"]); }
        checkResize() { calls.push(["checkResize"]); }
        extend(...args: any[]) { calls.push(["extend", ...args]); }
    }
    const sdk = {
        Map: class Map extends SDKObject {}, Marker: class Marker extends SDKObject {},
        MarkerStyle: class MarkerStyle extends SDKObject {},
        MultiMarker: class MultiMarker extends SDKObject {}, LatLng: class LatLng extends SDKObject {},
        Point: class Point extends SDKObject {}, LngLatBounds: class LngLatBounds extends SDKObject {},
        LatLngBounds: class LatLngBounds extends SDKObject {},
    };
    const container = {ownerDocument: {documentElement: {dataset: {}}}, replaceChildren() { calls.push(["clear"]); }};
    return {sdk, calls, instances, container: container as unknown as HTMLElement};
};

describe("official map provider adapters", () => {
    for (const provider of ["openfreemap", "amap", "tencent", "baidu"] as AVMapProvider[]) {
        it(`${provider} preserves coordinate order, filters systems and cleans stale callbacks`, () => {
            const {sdk, calls, instances, container} = fixture();
            const clicked: Array<[string, number]> = [];
            const adapter = createAVMapAdapter(provider, sdk, container, {
                onMarkerClick: (id, revision) => clicked.push([id, revision]), onError: () => assert.fail("SDK error"),
            }, {bd09: "official-bd09", gcj02: "official-gcj02"});
            const coordinateSystem = provider === "openfreemap" ? "wgs84" : provider === "baidu" ? "bd09" : "gcj02";
            const point = {id: "row-1", longitude: 121, latitude: 31, coordinateSystem} as const;
            adapter.setPoints([point, {...point, id: "unknown", coordinateSystem: "unknown" as any}], 1);
            const marker = instances.find((instance) => instance.callbacks.has("click"));
            const oldClick = marker.callbacks.get("click");
            oldClick({geometry: {id: "row-1"}});
            assert.deepEqual(clicked, [["row-1", 1]]);
            if (provider === "openfreemap") {
                assert.equal(calls.find((call) => call[0] === "Map")[1].style, AV_MAP_OPENFREEMAP_STYLE);
                assert.equal(calls.find((call) => call[0] === "Map")[1].attributionControl, true);
                assert.deepEqual(calls.find((call) => call[0] === "setLngLat"), ["setLngLat", [121, 31]]);
            } else if (provider === "amap") {
                assert.deepEqual(calls.find((call) => call[0] === "Marker")[1].position, [121, 31]);
            } else if (provider === "tencent") {
                assert.ok(calls.some((call) => call[0] === "LatLng" && call[1] === 31 && call[2] === 121));
                assert.deepEqual(calls.find((call) => call[0] === "MarkerStyle")[1],
                    {width: 20, height: 30, anchor: {x: 10, y: 30}});
            } else {
                assert.ok(calls.some((call) => call[0] === "Point" && call[1] === 121 && call[2] === 31));
                assert.deepEqual(calls.find((call) => call[0] === "Marker")[2],
                    {enableDragging: false, coordType: "official-bd09"});
            }
            adapter.fit();
            adapter.resize();
            adapter.setTheme("dark");
            adapter.setPoints([{...point, id: "row-2"}], 2);
            oldClick({geometry: {id: "row-1"}});
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
            oldClick({geometry: {id: "row-1"}});
            assert.equal(calls.length, count);
            assert.equal(clicked.length, 1);
            assert.equal(calls.filter((call) => call[0] === "clear").length, 1);
        });
    }
    it("declares each Baidu marker's BD09 or GCJ02 system without changing global defaults or coordinates", () => {
        const {sdk, calls, container} = fixture();
        Object.defineProperty(sdk, "coordType", {value: "global-default", writable: false});
        const adapter = createAVMapAdapter("baidu", sdk, container, {onMarkerClick() {}, onError() {}},
            {bd09: "official-bd09", gcj02: "official-gcj02"});
        const points = [
            {id: "one", longitude: 121, latitude: 31, coordinateSystem: "gcj02" as const},
            {id: "abroad", longitude: -73, latitude: 40, coordinateSystem: "bd09" as const},
        ];
        adapter.setPoints(points, 1);
        assert.deepEqual(calls.filter((call) => call[0] === "Marker").map((call) => call[2]), [
            {enableDragging: false, coordType: "official-gcj02"},
            {enableDragging: false, coordType: "official-bd09"},
        ]);
        assert.ok(calls.some((call) => call[0] === "Point" && call[1] === -73 && call[2] === 40));
        assert.deepEqual(points[1], {id: "abroad", longitude: -73, latitude: 40, coordinateSystem: "bd09"});
        adapter.fit();
        assert.deepEqual(calls.find((call) => call[0] === "setViewport")[1], ["sdk-position", "sdk-position"]);
        adapter.destroy();
    });
    it("does not silently fall back to Baidu defaults when an explicit coordinate constant is unavailable", () => {
        for (const coordinateSystem of ["bd09", "gcj02"] as const) {
            const {sdk, calls, container} = fixture();
            const errors: string[] = [];
            const adapter = createAVMapAdapter("baidu", sdk, container,
                {onMarkerClick() {}, onError: (code) => errors.push(code)});
            adapter.setPoints([{id: "one", longitude: 121, latitude: 31, coordinateSystem}], 1);
            assert.deepEqual(errors, ["mapUnavailable"]);
            assert.equal(calls.some((call) => call[0] === "Marker"), false);
            adapter.destroy();
        }
    });
});

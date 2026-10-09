import * as assert from "node:assert/strict";
import {test} from "node:test";
import {canLoadMapHost, destroyMap, getMapPoints, getMapSettings, registerMap} from "./state";
import {AV_MAP_MAX_POINTS} from "./protocol";

const table = (locations: IAVCellLocationValue[]) => ({
    rowCount: locations.length,
    map: {serviceID: "saved-service", locationKeyID: "location", showRecordList: false},
    columns: [{id: "primary", type: "block"}, {id: "location", type: "location", hidden: true}],
    rows: locations.map((location, index) => ({id: `row-${index}`, cells: [
        {value: {type: "block", block: {content: "Private title"}}},
        {value: {type: "location", keyID: "location", location}},
    ]})),
}) as IAVTable;

test("map uses hidden selected fields and copies only valid compatible IDs and coordinates", () => {
    const view = table([
        {latitude: 0, longitude: 0, coordinateSystem: "wgs84", name: "Private", originalInput: "Private source"},
        {name: "No coordinates"},
        {latitude: 91, longitude: 0, coordinateSystem: "wgs84"},
        {latitude: 0, longitude: 0, coordinateSystem: "unknown"},
        {latitude: 0, longitude: 0},
        {latitude: 0, longitude: 0, coordinateSystem: "gcj02"},
        {latitude: 0, longitude: 0, coordinateSystem: "bd09"},
        {latitude: 0, longitude: null, coordinateSystem: "wgs84"},
    ]);
    const before = JSON.stringify(view);
    const result = getMapPoints(view, "openfreemap");
    assert.deepEqual(result.points, [{id: "row-0", longitude: 0, latitude: 0, coordinateSystem: "wgs84"}]);
    assert.deepEqual(result.skipped, {empty: 1, invalid: 2, unknown: 2, mismatch: 2, projection: 0});
    assert.equal(JSON.stringify(view), before);
    assert.equal(getMapPoints(view, "amap").points[0].id, "row-5");
    assert.equal(getMapPoints(view, "tencent").points[0].id, "row-5");
    assert.deepEqual(getMapPoints(view, "baidu").points.map(point => point.id), ["row-5", "row-6"]);
});

test("map preserves valid polar coordinates but counts unsupported projection separately", () => {
    const view = table([
        {latitude: 90, longitude: 0, coordinateSystem: "wgs84"},
        {latitude: -90, longitude: 0, coordinateSystem: "wgs84"},
        {latitude: 85.0511287798066, longitude: 180, coordinateSystem: "wgs84"},
    ]);
    const original = JSON.stringify(view);
    const result = getMapPoints(view, "openfreemap");
    assert.equal(result.skipped.projection, 2);
    assert.equal(result.skipped.invalid, 0);
    assert.equal(result.points.length, 1);
    assert.equal(JSON.stringify(view), original);
});

test("missing or changed location fields retain their saved identifiers and do not fall back", () => {
    const view = table([{latitude: 0, longitude: 0, coordinateSystem: "wgs84"}]);
    view.map.locationKeyID = "removed";
    assert.equal(getMapPoints(view, "openfreemap").missingField, true);
    assert.equal(getMapSettings(view).locationKeyID, "removed");
    view.map.locationKeyID = "primary";
    assert.equal(getMapPoints(view, "openfreemap").missingField, true);
    assert.deepEqual(getMapSettings(view), {serviceID: "saved-service", locationKeyID: "primary", showRecordList: false});
    assert.deepEqual(getMapSettings({} as IAVTable), {serviceID: "", locationKeyID: "", showRecordList: true});
});

test("map does not silently truncate the loaded page before the explicit rendering limit", () => {
    const view = table(Array.from({length: AV_MAP_MAX_POINTS + 1}, () => ({
        latitude: 0, longitude: 0, coordinateSystem: "wgs84" as const,
    })));
    assert.equal(getMapPoints(view, "openfreemap").points.length, AV_MAP_MAX_POINTS + 1);
});

test("map document eligibility excludes public, history and non-HTTP contexts before host capability checks", () => {
    const context = {published: false, history: false, protocol: "https:"};
    assert.equal(canLoadMapHost(context), true);
    assert.equal(canLoadMapHost({...context, protocol: "http:"}), true);
    for (const change of [{published: true}, {history: true}, {protocol: "file:"}]) {
        assert.equal(canLoadMapHost({...context, ...change}), false);
    }
});

test("map lifecycle is independent per editor and releases removed or replaced hosts", () => {
    const previousObserver = Object.getOwnPropertyDescriptor(globalThis, "MutationObserver");
    const previousDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
    let removal: () => void;
    let disconnected = 0;
    Object.assign(globalThis, {document: {body: {}}, MutationObserver: class {
        constructor(callback: () => void) { removal = callback; }
        observe() {}
        disconnect() { disconnected++; }
    }});
    const rootA = {isConnected: true} as HTMLElement;
    const rootB = {isConnected: true} as HTMLElement;
    const blockA = {isConnected: true, contains: (root: HTMLElement) => root === rootA} as HTMLElement;
    const blockB = {isConnected: true, contains: (root: HTMLElement) => root === rootB} as HTMLElement;
    let disposedA = 0;
    let disposedB = 0;
    try {
        const first = registerMap(blockA, {root: rootA, destroy: () => disposedA++});
        const second = registerMap(blockB, {root: rootB, destroy: () => disposedB++});
        assert.equal(first(), true);
        assert.equal(second(), true);
        const replacement = registerMap(blockA, {root: rootA, destroy: () => disposedA++});
        assert.equal(disposedA, 1);
        assert.equal(first(), false);
        assert.equal(replacement(), true);
        Object.assign(rootA, {isConnected: false});
        removal();
        assert.equal(disposedA, 2);
        assert.equal(second(), true);
        assert.equal(disposedB, 0);
        destroyMap(blockB);
        assert.equal(disposedB, 1);
        assert.equal(disconnected, 1);
    } finally {
        destroyMap(blockA);
        destroyMap(blockB);
        if (previousObserver) Object.defineProperty(globalThis, "MutationObserver", previousObserver);
        else Reflect.deleteProperty(globalThis, "MutationObserver");
        if (previousDocument) Object.defineProperty(globalThis, "document", previousDocument);
        else Reflect.deleteProperty(globalThis, "document");
    }
});

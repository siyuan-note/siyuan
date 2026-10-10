import * as assert from "node:assert/strict";
import {test} from "node:test";
import {canLoadMapHost, destroyMap, getMapPoints, getMapSettings, registerMap} from "./state";
import {AV_MAP_MAX_POINTS} from "./protocol";

const table = (locations: IAVCellLocationValue[]) => ({
    rowCount: locations.length,
    map: {locationKeyID: "location"},
    columns: [{id: "primary", type: "block"}, {id: "location", type: "location", hidden: true}],
    rows: locations.map((location, index) => ({id: `row-${index}`, cells: [
        {value: {type: "block", block: {content: "Private title"}}},
        {value: {type: "location", keyID: "location", location}},
    ]})),
}) as IAVTable;

test("map uses hidden selected fields and copies only valid WGS84 IDs and coordinates", () => {
    const view = table([
        {latitude: 0, longitude: 0, name: "Private", originalInput: "Private source"},
        {name: "No coordinates"},
        {latitude: 91, longitude: 0},
        {latitude: 0, longitude: null},
    ]);
    const before = JSON.stringify(view);
    const result = getMapPoints(view);
    assert.deepEqual(result.points, [{id: "row-0", longitude: 0, latitude: 0}]);
    assert.deepEqual(result.skipped, {empty: 1, invalid: 2, projection: 0});
    assert.equal(JSON.stringify(view), before);
});

test("map preserves valid polar coordinates but counts unsupported projection separately", () => {
    const view = table([
        {latitude: 90, longitude: 0},
        {latitude: -90, longitude: 0},
        {latitude: 85.0511287798066, longitude: 180},
    ]);
    const original = JSON.stringify(view);
    const result = getMapPoints(view);
    assert.equal(result.skipped.projection, 2);
    assert.equal(result.skipped.invalid, 0);
    assert.equal(result.points.length, 1);
    assert.equal(JSON.stringify(view), original);
});

test("missing or changed location fields retain their saved identifiers and do not fall back", () => {
    const view = table([{latitude: 0, longitude: 0}]);
    view.map.locationKeyID = "removed";
    assert.deepEqual(getMapPoints(view), {points: [], skipped: {empty: 0, invalid: 0, projection: 0}});
    assert.equal(getMapSettings(view).locationKeyID, "removed");
    view.map.locationKeyID = "primary";
    assert.deepEqual(getMapPoints(view), {points: [], skipped: {empty: 0, invalid: 0, projection: 0}});
    assert.deepEqual(getMapSettings(view), {locationKeyID: "primary", height: 480});
    assert.deepEqual(getMapSettings({} as IAVTable), {locationKeyID: "", height: 480});
});

test("map height derives a safe default without changing stored settings", () => {
    for (const height of [undefined, null, 0, 321, "640", 320, 480, 640, 800]) {
        const view = table([]);
        Object.assign(view.map, {height});
        const before = JSON.stringify(view);
        assert.equal(getMapSettings(view).height, [320, 480, 640, 800].includes(height as number) ? height : 480);
        assert.equal(JSON.stringify(view), before);
    }
});

test("unconfigured maps derive the first location in view order without persisting it", () => {
    const view = table([{latitude: 0, longitude: 0}]);
    view.map.locationKeyID = "";
    const before = JSON.stringify(view);
    assert.equal(getMapSettings(view).locationKeyID, "location");
    assert.deepEqual(getMapPoints(view).points, [{id: "row-0", longitude: 0, latitude: 0}]);
    assert.equal(JSON.stringify(view), before);
    view.columns.unshift({id: "other", type: "location", hidden: true});
    assert.equal(getMapSettings(view).locationKeyID, "other");
    view.map.locationKeyID = "location";
    assert.equal(getMapSettings(view).locationKeyID, "location");
    delete view.map;
    assert.equal(getMapSettings(view).locationKeyID, "other");
    view.columns = [];
    assert.equal(getMapSettings(view).locationKeyID, "");
    view.columns.push({id: "added", type: "location"});
    assert.equal(getMapSettings(view).locationKeyID, "added");
});

test("map does not silently truncate the loaded page before the explicit rendering limit", () => {
    const view = table(Array.from({length: AV_MAP_MAX_POINTS + 1}, () => ({
        latitude: 0, longitude: 0,
    })));
    assert.equal(getMapPoints(view).points.length, AV_MAP_MAX_POINTS + 1);
});

test("map host requires an HTTP document protocol", () => {
    assert.equal(canLoadMapHost("https:"), true);
    assert.equal(canLoadMapHost("http:"), true);
    for (const protocol of ["file:", "data:", "siyuan:", ""]) {
        assert.equal(canLoadMapHost(protocol), false);
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

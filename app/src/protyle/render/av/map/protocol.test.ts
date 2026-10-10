import * as assert from "node:assert/strict";
import {describe, it} from "node:test";
import {
    AV_MAP_ATTRIBUTION_LINKS, AV_MAP_MERCATOR_MAX_LATITUDE, AVMapLoadError, getAVMapLoadErrorCode,
    isAVMapHandshake, isAVMapHostErrorCode, isAVMapProjectionSupported,
    parseAVMapCommand, parseAVMapReply, sanitizeAVMapPoints,
} from "./protocol";

describe("isolated map protocol", () => {
    const point = {id: "row-1", longitude: 0, latitude: 0};
    it("keeps attribution destinations in a fixed official allowlist", () => {
        assert.deepEqual(AV_MAP_ATTRIBUTION_LINKS.openfreemap.map((link) => link.href), [
            "https://openfreemap.org", "https://www.openmaptiles.org/", "https://www.openstreetmap.org/copyright",
        ]);
        assert.deepEqual(Object.keys(AV_MAP_ATTRIBUTION_LINKS), ["openfreemap"]);
        Object.values(AV_MAP_ATTRIBUTION_LINKS).flat().forEach((link) => {
            assert.equal(new URL(link.href).protocol, "https:");
            assert.equal(/[<>]/.test(link.label), false);
        });
    });
    it("copies only identifiers and WGS84 coordinates", () => {
        const input = {...point, name: "Private place", title: "Private record", document: "secret", token: "secret",
            originalInput: "sensitive source"};
        assert.deepEqual(sanitizeAVMapPoints([input]), [point]);
    });
    it("rejects obsolete coordinate-system messages instead of reinterpreting their coordinates", () => {
        for (const coordinateSystem of ["wgs84", "gcj02", "bd09", "unknown", "", undefined]) {
            assert.deepEqual(sanitizeAVMapPoints([{...point, coordinateSystem}]), []);
        }
    });
    it("accepts zero and coordinate boundaries, rejects malformed numbers, ranges, ids and duplicates", () => {
        assert.equal(sanitizeAVMapPoints([{...point, longitude: -180, latitude: -AV_MAP_MERCATOR_MAX_LATITUDE}]).length, 1);
        assert.equal(sanitizeAVMapPoints([{...point, longitude: 180, latitude: AV_MAP_MERCATOR_MAX_LATITUDE}]).length, 1);
        for (const invalid of [{longitude: 181}, {latitude: -91}, {longitude: NaN}, {latitude: Infinity},
            {latitude: "0"}, {longitude: null}, {id: ""}, {id: "<script>"}, {id: "x".repeat(129)}]) {
            assert.deepEqual(sanitizeAVMapPoints([{...point, ...invalid}]), []);
        }
        assert.deepEqual(sanitizeAVMapPoints([point, point, null, 1]), [point]);
    });
    it("preserves polar coordinates but refuses Web Mercator points that would be silently clamped", () => {
        for (const latitude of [-90, 90, -85.052, 85.052, -Infinity, Infinity, NaN]) {
            assert.equal(isAVMapProjectionSupported(latitude), false);
            const input = {...point, latitude};
            assert.deepEqual(sanitizeAVMapPoints([input]), []);
            assert.equal(Object.is(input.latitude, latitude), true);
        }
        for (const latitude of [0, -AV_MAP_MERCATOR_MAX_LATITUDE, AV_MAP_MERCATOR_MAX_LATITUDE]) {
            assert.equal(isAVMapProjectionSupported(latitude), true);
            assert.deepEqual(sanitizeAVMapPoints([{...point, latitude}]), [{...point, latitude}]);
        }
    });
    it("accepts only the built-in provider and strips credentials and extra init fields", () => {
        const init = {version: 1, instanceID: "one", type: "init", provider: "openfreemap", theme: "light"};
        assert.deepEqual(parseAVMapCommand({...init, credentials: {apiKey: "secret"}, token: "private"}, "one"), init);
        for (const provider of ["amap", "tencent", "baidu", "", undefined]) {
            assert.equal(parseAVMapCommand({...init, provider}, "one"), undefined);
        }
    });
    it("rejects wrong instances, versions, commands and invalid revisions", () => {
        const input = {version: 1, instanceID: "one", type: "setPoints", revision: 2, points: [point]};
        assert.deepEqual(parseAVMapCommand(input, "one", "openfreemap"), input);
        for (const invalid of [{version: 2}, {instanceID: "old"}, {type: "setLocation"}, {revision: -1},
            {revision: 1.1}, {revision: Infinity}, {revision: Number.MAX_SAFE_INTEGER + 1}, {points: {}}]) {
            assert.equal(parseAVMapCommand({...input, ...invalid}, "one", "openfreemap"), undefined);
        }
        assert.equal(parseAVMapCommand(input, "one"), undefined);
    });
    it("does not expose arbitrary SDK errors, URLs, credentials or extra reply fields", () => {
        const reply = {version: 1, instanceID: "one", type: "error", code: "sdkUnavailable"};
        assert.deepEqual(parseAVMapReply({...reply, message: "https://sdk.example/?key=secret"}, "one"), reply);
        assert.equal(parseAVMapReply({...reply, code: "https://sdk.example/?key=secret"}, "one"), undefined);
        assert.equal(parseAVMapReply({...reply, version: 2}, "one"), undefined);
        assert.equal(parseAVMapReply({...reply, instanceID: "old"}, "one"), undefined);
        assert.equal(parseAVMapReply({...reply, type: "updateRow"}, "one"), undefined);
    });
    it("requires the exact nonce and instance during its one-time handshake", () => {
        const handshake = {version: 1, type: "hello", instanceID: "instance", nonce: "nonce"};
        assert.equal(isAVMapHandshake(handshake, "hello", "instance", "nonce"), true);
        for (const invalid of [{nonce: "old"}, {instanceID: "other"}, {version: 0}, {type: "connect"}]) {
            assert.equal(isAVMapHandshake({...handshake, ...invalid}, "hello", "instance", "nonce"), false);
        }
    });
    it("admits only fixed loading stages and never treats arbitrary SDK exceptions as controlled errors", () => {
        for (const code of ["sdkScriptLoadFailed", "sdkGlobalMissing", "mapCreationFailed", "mapReadyTimeout"] as const) {
            const error = new AVMapLoadError(code);
            assert.equal(getAVMapLoadErrorCode(error), code);
            assert.equal(error.message, "Map loading failed");
            const reply = {version: 1, instanceID: "one", type: "error", code};
            assert.deepEqual(parseAVMapReply({...reply, message: "https://sdk.invalid?key=secret", stack: "secret"}, "one"), reply);
        }
        assert.equal(getAVMapLoadErrorCode(Object.assign(new Error("secret"), {code: "mapCreationFailed"})), undefined);
        assert.equal(getAVMapLoadErrorCode({code: "mapCreationFailed"}), undefined);
        assert.equal(getAVMapLoadErrorCode(Object.assign(new AVMapLoadError("mapCreationFailed"), {code: "secret"})), undefined);
    });
    it("preserves only fixed host failures across the owner and main process boundaries", () => {
        const {parseMapReply} = require("../../../../../electron/mapHostPolicy");
        for (const code of ["hostLimitReached", "hostSetupFailed", "hostAttachFailed", "hostDocumentLoadFailed",
            "hostDocumentLoadTimeout", "hostDocumentReloaded", "hostDocumentMismatch", "hostRendererGone", "hostDestroyed",
            "hostPortSetupFailed", "hostPortClosed", "hostBootstrapFailed", "hostBootstrapTimeout", "hostSDKTimeout",
            "hostOperationFailed", "hostCreateRejected", "hostCreateInvalidResponse", "hostReadyTimeout", "hostOwnerSetupFailed"]) {
            const reply = {version: 1, instanceID: "one", type: "error", code};
            const input = {...reply, message: "https://private.invalid/?key=secret", stack: "secret"};
            assert.equal(isAVMapHostErrorCode(code), true);
            assert.deepEqual(parseAVMapReply(input, "one"), reply);
            assert.deepEqual(parseMapReply(input, "one"), reply);
            assert.equal(parseAVMapReply(input, "other"), undefined);
        }
        for (const code of ["hostSecret", "https://private.invalid/?key=secret", {}, null]) {
            assert.equal(isAVMapHostErrorCode(code), false);
            assert.equal(parseAVMapReply({version: 1, instanceID: "one", type: "error", code}, "one"), undefined);
        }
    });
});

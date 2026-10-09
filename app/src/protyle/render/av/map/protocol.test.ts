import * as assert from "node:assert/strict";
import {describe, it} from "node:test";
import {
    AV_MAP_ATTRIBUTION_LINKS, AV_MAP_MERCATOR_MAX_LATITUDE, AVMapLoadError, AVMapProvider, getAVMapLoadErrorCode,
    isAVMapHandshake, isAVMapProjectionSupported,
    parseAVMapCommand, parseAVMapReply, sanitizeAVMapCredentials, sanitizeAVMapPoints,
} from "./protocol";

describe("isolated map protocol", () => {
    const point = {id: "row-1", longitude: 0, latitude: 0, coordinateSystem: "wgs84"};
    it("keeps attribution destinations in a fixed official allowlist", () => {
        assert.deepEqual(AV_MAP_ATTRIBUTION_LINKS.openfreemap.map((link) => link.href), [
            "https://openfreemap.org", "https://www.openmaptiles.org/", "https://www.openstreetmap.org/copyright",
        ]);
        assert.deepEqual(Object.keys(AV_MAP_ATTRIBUTION_LINKS), ["openfreemap", "amap", "tencent", "baidu"]);
        Object.values(AV_MAP_ATTRIBUTION_LINKS).flat().forEach((link) => {
            assert.equal(new URL(link.href).protocol, "https:");
            assert.equal(/[<>]/.test(link.label), false);
        });
    });
    it("copies only identifiers and coordinates and drops unknown systems without conversion", () => {
        const input = {...point, name: "Private place", title: "Private record", document: "secret", token: "secret",
            originalInput: "sensitive source"};
        assert.deepEqual(sanitizeAVMapPoints([input], "openfreemap"), [point]);
        const systems = {openfreemap: ["wgs84"], amap: ["gcj02"], tencent: ["gcj02"], baidu: ["bd09", "gcj02"]};
        for (const provider of Object.keys(systems) as AVMapProvider[]) {
            for (const system of ["wgs84", "gcj02", "bd09", "unknown", "", undefined]) {
                const result = sanitizeAVMapPoints([{...point, coordinateSystem: system}], provider);
                assert.equal(result.length, systems[provider].includes(system) ? 1 : 0, `${provider}:${system}`);
            }
        }
    });
    it("accepts zero and coordinate boundaries, rejects malformed numbers, ranges, ids and duplicates", () => {
        assert.equal(sanitizeAVMapPoints([{...point, longitude: -180, latitude: -AV_MAP_MERCATOR_MAX_LATITUDE}], "openfreemap").length, 1);
        assert.equal(sanitizeAVMapPoints([{...point, longitude: 180, latitude: AV_MAP_MERCATOR_MAX_LATITUDE}], "openfreemap").length, 1);
        for (const invalid of [{longitude: 181}, {latitude: -91}, {longitude: NaN}, {latitude: Infinity},
            {latitude: "0"}, {longitude: null}, {id: ""}, {id: "<script>"}, {id: "x".repeat(129)}]) {
            assert.deepEqual(sanitizeAVMapPoints([{...point, ...invalid}], "openfreemap"), []);
        }
        assert.deepEqual(sanitizeAVMapPoints([point, point, null, 1], "openfreemap"), [point]);
    });
    it("preserves polar coordinates but refuses Web Mercator points that would be silently clamped", () => {
        for (const provider of ["openfreemap", "amap"] as const) {
            const base = {...point, coordinateSystem: provider === "amap" ? "gcj02" : "wgs84"};
            for (const latitude of [-90, 90, -85.052, 85.052, -Infinity, Infinity, NaN]) {
                assert.equal(isAVMapProjectionSupported(provider, latitude), false);
                const input = {...base, latitude};
                assert.deepEqual(sanitizeAVMapPoints([input], provider), []);
                assert.equal(Object.is(input.latitude, latitude), true);
            }
            for (const latitude of [0, -AV_MAP_MERCATOR_MAX_LATITUDE, AV_MAP_MERCATOR_MAX_LATITUDE]) {
                assert.equal(isAVMapProjectionSupported(provider, latitude), true);
                assert.deepEqual(sanitizeAVMapPoints([{...base, latitude}], provider), [{...base, latitude}]);
            }
        }
    });
    it("limits credentials to explicit bounded strings", () => {
        assert.deepEqual(sanitizeAVMapCredentials({apiKey: "fixture-key", securityCode: "fixture-code", token: "private"}),
            {apiKey: "fixture-key", securityCode: "fixture-code"});
        assert.deepEqual(sanitizeAVMapCredentials({apiKey: "fixture-key", securityCode: "fixture-code"}, "openfreemap"), {});
        for (const provider of ["tencent", "baidu"] as const) {
            assert.deepEqual(sanitizeAVMapCredentials({apiKey: "fixture-key", securityCode: "fixture-code"}, provider),
                {apiKey: "fixture-key"});
        }
        assert.deepEqual(sanitizeAVMapCredentials({apiKey: " fixture-key "}), {apiKey: "fixture-key"});
        assert.deepEqual(sanitizeAVMapCredentials({apiKey: "x".repeat(4096)}), {apiKey: "x".repeat(4096)});
        for (const apiKey of ["", "x".repeat(4097), " ", "\n", "\u4e00".repeat(1366), null, 42]) {
            assert.deepEqual(sanitizeAVMapCredentials({apiKey}), {});
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
        for (const code of ["sdkScriptLoadFailed", "sdkCallbackTimeout", "sdkGlobalMissing", "mapCreationFailed", "mapReadyTimeout"] as const) {
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
});

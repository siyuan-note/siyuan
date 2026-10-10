import * as assert from "node:assert/strict";
import {describe, it} from "node:test";
import {
    AV_MAP_ATTRIBUTION_LINKS, AV_MAP_MERCATOR_MAX_LATITUDE, AVMapLoadError, getAVMapLoadErrorCode,
    isAVMapBootstrapMessage, isAVMapHostErrorCode, isAVMapProjectionSupported,
    parseAVMapCommand, parseAVMapReply, sanitizeAVMapPoints,
} from "./protocol";
import {AV_MAP_BOOTSTRAP_TIMEOUT, AV_MAP_HOST_READY_TIMEOUT, AV_MAP_OWNER_TIMEOUT, AV_MAP_READY_TIMEOUT} from "./loadingBudget";
import {getAVMapLockedPolicy} from "./bootstrap";

describe("isolated map protocol", () => {
    const point = {id: "row-1", longitude: 0, latitude: 0};
    it("keeps attribution destinations in a fixed official allowlist", () => {
        assert.deepEqual(AV_MAP_ATTRIBUTION_LINKS.openfreemap.map((link) => link.href), [
            "https://openfreemap.org", "https://www.openmaptiles.org/", "https://www.openstreetmap.org/copyright", "https://maplibre.org/",
        ]);
        assert.deepEqual(Object.keys(AV_MAP_ATTRIBUTION_LINKS), ["openfreemap"]);
        Object.values(AV_MAP_ATTRIBUTION_LINKS).flat().forEach((link) => {
            assert.equal(new URL(link.href).protocol, "https:");
            assert.equal(/[<>]/.test(link.label), false);
        });
    });
    it("accepts only fixed attribution identifiers across both protocol boundaries", () => {
        const {parseMapReply, parseMapCommand} = require("../../../../../electron/mapHostPolicy");
        for (const {id: link} of AV_MAP_ATTRIBUTION_LINKS.openfreemap) {
            const reply = {version: 1, instanceID: "one", type: "attributionClick", link};
            assert.deepEqual(parseAVMapReply({...reply, href: "https://evil.invalid/", url: "private"}, "one"), reply);
            assert.deepEqual(parseMapReply({...reply, href: "https://evil.invalid/", url: "private"}, "one"), reply);
            assert.equal(parseAVMapReply(reply, "old"), undefined);
        }
        for (const link of ["https://maplibre.org/", "https://evil.invalid/", "maplibre?secret", "", {}, null]) {
            const reply = {version: 1, instanceID: "one", type: "attributionClick", link};
            assert.equal(parseAVMapReply(reply, "one"), undefined);
            assert.equal(parseMapReply(reply, "one"), undefined);
        }
        const visibility = {version: 1, instanceID: "one", type: "visibility", visible: true,
            viewport: {x: 0, y: 50, width: 800, height: 550}};
        assert.deepEqual(parseAVMapCommand(visibility, "one"), visibility);
        assert.equal(parseAVMapCommand({...visibility, viewport: {x: 0, y: 0, width: -1, height: 500}}, "one"), undefined);
        for (const value of [NaN, Infinity, "0", -1, 32769]) {
            assert.equal(parseAVMapCommand({...visibility, viewport: {...visibility.viewport, x: value}}, "one"), undefined);
        }
        assert.deepEqual(parseAVMapCommand({...visibility, viewport: {...visibility.viewport, url: "secret"}}, "one"), visibility);
        assert.equal(parseAVMapCommand({...visibility, visible: "true"}, "one"), undefined);
        assert.equal(parseMapCommand(visibility, "one"), undefined, "the owner cannot override native visibility");
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
        assert.equal(isAVMapBootstrapMessage(handshake, "hello", "instance", "nonce"), true);
        for (const invalid of [{nonce: "old"}, {instanceID: "other"}, {version: 0}, {type: "connect"}]) {
            assert.equal(isAVMapBootstrapMessage({...handshake, ...invalid}, "hello", "instance", "nonce"), false);
        }
        assert.equal(isAVMapBootstrapMessage(structuredClone(Object.assign([], handshake)), "hello", "instance", "nonce"), false);
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

describe("shared owner and runtime protocol corpus", () => {
    const {parseMapCommand, parseMapReply} = require("../../../../../electron/mapHostPolicy");
    const envelope = {version: 1, instanceID: "one"};
    const point = {id: "row-1", longitude: 0, latitude: 0};
    const commands = [
        (value: unknown) => parseAVMapCommand(value, "one", "openfreemap"),
        (value: unknown) => parseMapCommand(value, "one"),
    ];
    const replies = [(value: unknown) => parseAVMapReply(value, "one"), (value: unknown) => parseMapReply(value, "one")];
    it("keeps desktop and web preparation and readiness budgets aligned and finite", () => {
        const {MAP_HOST_BOOTSTRAP_TIMEOUT, MAP_HOST_READY_TIMEOUT} = require("../../../../../electron/mapHostManager");
        assert.equal(MAP_HOST_BOOTSTRAP_TIMEOUT, AV_MAP_BOOTSTRAP_TIMEOUT);
        assert.equal(MAP_HOST_READY_TIMEOUT, AV_MAP_HOST_READY_TIMEOUT);
        assert.ok(AV_MAP_READY_TIMEOUT < AV_MAP_HOST_READY_TIMEOUT);
        assert.ok(AV_MAP_BOOTSTRAP_TIMEOUT + AV_MAP_HOST_READY_TIMEOUT < AV_MAP_OWNER_TIMEOUT);
        assert.ok(Number.isFinite(AV_MAP_OWNER_TIMEOUT));
    });
    it("only removes resource permissions when the initial desktop policy is locked", () => {
        const {createMapContentSecurityPolicy, mapHostFiles} = require("../../../../../electron/mapHostPolicy");
        const origin = "https://fixture.invalid";
        const directives = (policy: string) => new Map(policy.split(";").map(value => value.trim().split(/\s+/))
            .filter(([name]) => name).map(([name, ...values]) => [name, values]));
        const initial = directives(createMapContentSecurityPolicy(origin));
        const locked = directives(getAVMapLockedPolicy("openfreemap"));
        assert.deepEqual(initial.get("sandbox"), ["allow-scripts"]);
        assert.deepEqual(initial.get("frame-ancestors"), ["'none'"]);
        assert.deepEqual(locked.get("script-src"), ["'none'"]);
        assert.deepEqual(locked.get("connect-src"), ["https://tiles.openfreemap.org"]);
        for (const directive of ["script-src", "connect-src", "img-src", "style-src", "font-src", "worker-src",
            "frame-src", "object-src", "base-uri", "form-action"]) {
            const before = initial.get(directive), after = locked.get(directive);
            assert.ok(before && after);
            for (const source of after) assert.ok(source === "'none'" || before.includes(source), `${directive}: ${source}`);
        }
        for (const sources of locked.values()) assert.equal(sources.some(source => source.includes("fixture.invalid")), false);
        const localSources = [...initial.values()].flat().filter(source => source.startsWith(origin));
        assert.equal(localSources.length, 5);
        for (const source of localSources) assert.ok(Object.prototype.hasOwnProperty.call(mapHostFiles, new URL(source).pathname));
        assert.deepEqual(locked.get("frame-src"), ["'none'"], "child-src must not permit subframe navigation");
        assert.deepEqual(locked.get("worker-src"), ["blob:"], "only prepared blob workers remain available");
    });
    it("uses the same cloned command corpus while copying only allowed fields", () => {
        const setPoints = {...envelope, type: "setPoints", revision: 1, points: [point]};
        const valid = [setPoints, {...envelope, type: "theme", theme: "light"}, {...envelope, type: "theme", theme: "dark"},
            {...envelope, type: "resize"}, {...envelope, type: "destroy"}];
        for (const command of valid) {
            for (const parse of commands) {
                assert.deepEqual(parse(structuredClone({...command, secret: "private"})), command);
                for (const malformed of [null, 1, "command", Object.assign([], command), {...command, version: 2},
                    {...command, instanceID: "other"}, {...command, type: "fit"}, {...command, type: "unknown"}]) {
                    assert.equal(parse(structuredClone(malformed)), undefined);
                }
            }
        }
        for (const revision of [-1, 1.5, NaN, Infinity, "1", null, Number.MAX_SAFE_INTEGER + 1]) {
            for (const parse of commands) assert.equal(parse({...setPoints, revision}), undefined);
        }
        for (const points of [null, {}, "points"]) {
            for (const parse of commands) assert.equal(parse({...setPoints, points}), undefined);
        }
        for (const theme of [null, {}, "auto", "LIGHT"]) {
            for (const parse of commands) assert.equal(parse({...envelope, type: "theme", theme}), undefined);
        }
    });
    it("rejects malformed point shapes, duplicates and nonprojectable values identically", () => {
        const valid = [point,
            {id: "west", longitude: -180, latitude: -AV_MAP_MERCATOR_MAX_LATITUDE},
            {id: "east", longitude: 180, latitude: AV_MAP_MERCATOR_MAX_LATITUDE}];
        const malformed = [null, 1, "point", Object.assign([], {...point, id: "array"}),
            ...[{longitude: NaN}, {longitude: Infinity}, {longitude: "0"}, {longitude: 181}, {latitude: null},
                {latitude: -86}, {latitude: 90}, {latitude: -Infinity}, {id: ""}, {id: "x".repeat(129)},
                {id: "<script>"}, {coordinateSystem: undefined}].map(value => ({...point, ...value}))];
        const command = {...envelope, type: "setPoints", revision: 0,
            points: [...valid.map(value => ({...value, name: "private", originalInput: "secret"})), point, ...malformed]};
        for (const parse of commands) {
            assert.deepEqual(parse(structuredClone(command)), {...envelope, type: "setPoints", revision: 0, points: valid});
            const points = Array.from({length: 10001}, (_, i) => ({...point, id: `row-${i}`}));
            assert.deepEqual(parse({...command, points}).points, points.slice(0, 10000));
        }
    });
    it("uses the same reply corpus and keeps privileged bootstrap and visibility directions explicit", () => {
        const valid = [{...envelope, type: "ready"}, {...envelope, type: "markerClick", id: point.id, revision: 0},
            ...AV_MAP_ATTRIBUTION_LINKS.openfreemap.map(({id: link}) => ({...envelope, type: "attributionClick", link})),
            {...envelope, type: "error", code: "mapUnavailable"}];
        for (const reply of valid) {
            for (const parse of replies) {
                assert.deepEqual(parse(structuredClone({...reply, url: "private", message: "secret"})), reply);
                for (const malformed of [null, Object.assign([], reply), {...reply, version: 2}, {...reply, instanceID: "other"},
                    {...reply, type: "unknown"}]) assert.equal(parse(structuredClone(malformed)), undefined);
            }
        }
        for (const parse of replies) {
            assert.equal(parse({...envelope, type: "error", code: "unknown"}), undefined);
            assert.equal(parse({...envelope, type: "markerClick", id: [], revision: 0}), undefined);
            assert.equal(parse({...envelope, type: "markerClick", id: point.id, revision: NaN}), undefined);
        }
        const bootstrapped = {...envelope, type: "bootstrapReady"};
        assert.deepEqual(parseMapReply(bootstrapped, "one"), bootstrapped);
        assert.equal(parseAVMapReply(bootstrapped, "one"), undefined);
        const visibility = {...envelope, type: "visibility", visible: true};
        assert.deepEqual(parseAVMapCommand(visibility, "one"), visibility);
        assert.equal(parseMapCommand(visibility, "one"), undefined);
        const init = {...envelope, type: "init", provider: "openfreemap", theme: "light"};
        assert.deepEqual(parseAVMapCommand(init, "one"), init);
        assert.equal(parseMapCommand(init, "one"), undefined);
    });
});

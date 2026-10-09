import * as assert from "node:assert/strict";
import {describe, it} from "node:test";
import {
    areAVLocationsEqual,
    createAVLocationFromText,
    createAVLocationReplacement,
    formatAVLocationCoordinate,
    getAVLocationText,
    isAVLocationCoordinateInput,
    isAVLocationEmpty,
    parseAVLocationCoordinates,
    validateAVLocation,
} from "./locationValue";

describe("database location values", () => {
    it("supports paired parentheses and explicit longitude-first order without guessing", () => {
        const source = " (102.42,25.04) ";
        assert.equal(parseAVLocationCoordinates(source, "gcj02"), undefined);
        assert.deepEqual(parseAVLocationCoordinates(source, "gcj02", "longitudeLatitude"), {
            latitude: 25.04, longitude: 102.42, coordinateSystem: "gcj02", originalInput: source,
        });
        assert.equal(parseAVLocationCoordinates("(20,30)", "wgs84")?.latitude, 20);
        assert.equal(parseAVLocationCoordinates("(20,30)", "wgs84", "longitudeLatitude")?.latitude, 30);
        for (const text of ["(20,30", "20,30)", "((20,30))", "(20),30", "[20,30]"]) {
            assert.equal(parseAVLocationCoordinates(text), undefined, text);
        }
    });
    it("keeps ordinary text as names without inference and replaces stale coordinates", () => {
        for (const text of ["  Office  ", "https://maps.example.com/?lat=31&lon=121", "geo:31,121"]) {
            assert.deepEqual(createAVLocationFromText(text), {
                name: text.trim(), latitude: null, longitude: null, coordinateSystem: "unknown", originalInput: text,
            });
        }
    });

    it("requires the explicit import flow for coordinate-looking or canonical pasted text", () => {
        for (const source of ["31.2,121.5", "(102.42,25.04)", " (20,30) ", "31,", ",121", "31,121,0", "181,91", "1e-7,-1e-7", "NaN,Infinity", "0,0 [unknown]",
            "Office; 0, 0 [GCJ-02]", "Office; 0, 0 [BD-09]"]) {
            assert.equal(isAVLocationCoordinateInput(source), true, source);
            assert.throws(() => createAVLocationFromText(source));
        }
        assert.equal(isAVLocationCoordinateInput("Cafe, 12 Main Street"), false);
        assert.equal(isAVLocationCoordinateInput("Paris, France"), false);
        assert.equal(isAVLocationCoordinateInput("Office; Cafe"), false);
    });

    it("produces complete replacement payloads for clearing merged backend values", () => {
        assert.deepEqual(createAVLocationReplacement(), {
            name: "", latitude: null, longitude: null, coordinateSystem: "unknown", originalInput: "",
        });
        assert.deepEqual(createAVLocationReplacement({name: "Office", latitude: 0, longitude: 0}), {
            name: "Office", latitude: 0, longitude: 0, coordinateSystem: "unknown", originalInput: "",
        });
    });

    it("validates name-only values and paired, finite coordinates including zero and boundaries", () => {
        for (const value of [undefined, {}, {name: "Office"}, {coordinateSystem: "" as const}, {latitude: null, longitude: null},
            {latitude: 0, longitude: 0}, {latitude: -90, longitude: 180}, {latitude: 90, longitude: -180}]) {
            assert.equal(validateAVLocation(value), true);
        }
        for (const value of [{latitude: 0}, {longitude: 0}, {latitude: null, longitude: 0},
            {latitude: 90.001, longitude: 0}, {latitude: -90.001, longitude: 0},
            {latitude: 0, longitude: 180.001}, {latitude: 0, longitude: -180.001},
            {latitude: NaN, longitude: 0}, {latitude: 0, longitude: Infinity},
            {coordinateSystem: "WGS84"}, {latitude: "0", longitude: 0}]) {
            assert.equal(validateAVLocation(value as IAVCellLocationValue), false);
        }
    });

    it("imports only the explicitly specified latitude, longitude order and exact source", () => {
        const source = "  +31.23040,  121.47370\n";
        assert.deepEqual(parseAVLocationCoordinates(source), {
            latitude: 31.2304, longitude: 121.4737, coordinateSystem: "unknown", originalInput: source,
        });
        assert.deepEqual(parseAVLocationCoordinates("0, -0", "gcj02"), {
            latitude: 0, longitude: -0, coordinateSystem: "gcj02", originalInput: "0, -0",
        });
        assert.equal(parseAVLocationCoordinates("121.4737,31.2304"), undefined);
        assert.equal(parseAVLocationCoordinates(".5,-.25", "bd09")?.latitude, .5);
    });

    it("rejects malformed, out-of-range, partial, nondecimal, and service-link imports", () => {
        for (const source of ["", "31", "31,", ",121", "31,121,0", "90.1,0", "0,-180.1",
            "1e1,2e1", "0x10,20", "NaN,0", "Infinity,0", "31 121", "31;121", "31\u00b0N,121\u00b0E",
            "geo:31,121", "https://example.com/?lat=31&lon=121"]) {
            assert.equal(parseAVLocationCoordinates(source), undefined, source);
        }
        assert.equal(parseAVLocationCoordinates("0,0", "wgs84x" as IAVCellLocationValue["coordinateSystem"]), undefined);
    });

    it("renders the canonical text without interpreting the coordinate system", () => {
        assert.equal(getAVLocationText(), "");
        assert.equal(getAVLocationText({name: "  Office  "}), "Office");
        assert.equal(getAVLocationText({latitude: 0, longitude: 0}), "0, 0 [unknown]");
        for (const system of ["unknown", "wgs84", "gcj02", "bd09"] as const) {
            assert.equal(getAVLocationText({name: "Office", latitude: 31.2, longitude: 121.5, coordinateSystem: system}),
                `Office; 31.2, 121.5 [${{unknown: "unknown", wgs84: "WGS84", gcj02: "GCJ-02", bd09: "BD-09"}[system]}]`);
        }
        assert.equal(getAVLocationText({latitude: 1e-7, longitude: -1e-8}), "0.0000001, -0.00000001 [unknown]");
        assert.equal(formatAVLocationCoordinate(1.234e-7), "0.0000001234");
        assert.equal(formatAVLocationCoordinate(1e21), "1000000000000000000000");
        assert.equal(formatAVLocationCoordinate(-0), "0");
    });

    it("excludes provenance from emptiness, display, and semantic equality", () => {
        const sourceOnly = {originalInput: "private imported source", coordinateSystem: "wgs84" as const};
        assert.equal(isAVLocationEmpty(sourceOnly), true);
        assert.equal(getAVLocationText(sourceOnly), "");
        assert.equal(isAVLocationEmpty({name: "  "}), true);
        assert.equal(isAVLocationEmpty({latitude: 0, longitude: 0}), false);
        assert.equal(isAVLocationEmpty({name: "Office"}), false);
        assert.equal(areAVLocationsEqual({name: "Office", originalInput: "a"},
            {name: "Office", coordinateSystem: "unknown", originalInput: "b"}), true);
        assert.equal(areAVLocationsEqual({latitude: 0, longitude: 0},
            {latitude: 0, longitude: 0, coordinateSystem: "wgs84"}), false);
    });
});

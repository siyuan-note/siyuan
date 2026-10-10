import * as assert from "node:assert/strict";
import {describe, it} from "node:test";
import {
    areAVLocationsEqual,
    createAVLocationFromText,
    createAVLocationReplacement,
    formatAVLocationCoordinate,
    getAVLocationDisplayText,
    getAVLocationText,
    isAVLocationCoordinateInput,
    isAVLocationEmpty,
    parseAVLocationCoordinate,
    validateAVLocation,
} from "./locationValue";

describe("database location values", () => {
    it("rejects explicitly tagged development values without relabeling or mutating them", () => {
        for (const coordinateSystem of ["unknown", "wgs84", "gcj02", "bd09"]) {
            const value = {latitude: 20, longitude: 30, coordinateSystem};
            assert.equal(validateAVLocation(value), false);
            assert.throws(() => createAVLocationReplacement(value), /Invalid WGS84 location/);
            assert.equal(getAVLocationText(value), "");
            assert.deepEqual(value, {latitude: 20, longitude: 30, coordinateSystem});
        }
    });
    it("keeps ordinary text as names without inference and replaces stale coordinates", () => {
        for (const text of ["  Office  ", "https://maps.example.com/?lat=31&lon=121", "geo:31,121"]) {
            assert.deepEqual(createAVLocationFromText(text), {
                name: text.trim(), latitude: null, longitude: null, originalInput: text,
            });
        }
    });

    it("requires the location editor for coordinate-looking or canonical pasted text", () => {
        for (const source of ["31.2,121.5", "(102.42,25.04)", " (20,30) ", "31,", ",121", "31,121,0", "181,91", "1e-7,-1e-7", "NaN,Infinity", "0,0 [WGS84]",
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
            name: "", latitude: null, longitude: null, originalInput: "",
        });
        assert.deepEqual(createAVLocationReplacement({name: "Office", latitude: 0, longitude: 0}), {
            name: "Office", latitude: 0, longitude: 0, originalInput: "",
        });
    });

    it("validates name-only values and paired, finite coordinates including zero and boundaries", () => {
        for (const value of [undefined, {}, {name: "Office"}, {latitude: null, longitude: null},
            {latitude: 0, longitude: 0}, {latitude: -90, longitude: 180}, {latitude: 90, longitude: -180}]) {
            assert.equal(validateAVLocation(value), true);
        }
        for (const value of [[], 0, false, "", {crs: "gcj02", latitude: 20, longitude: 30},
            {CoordinateSystem: "gcj02", latitude: 20, longitude: 30},
            {latitude: 0}, {longitude: 0}, {latitude: null, longitude: 0},
            {latitude: 90.001, longitude: 0}, {latitude: -90.001, longitude: 0},
            {latitude: 0, longitude: 180.001}, {latitude: 0, longitude: -180.001},
            {latitude: NaN, longitude: 0}, {latitude: 0, longitude: Infinity},
            {coordinateSystem: "WGS84"}, {latitude: "0", longitude: 0}] as unknown[]) {
            assert.equal(validateAVLocation(value as IAVCellLocationValue), false);
        }
    });

    it("parses each named coordinate field as a signed decimal including zero and boundaries", () => {
        for (const [source, expected] of [
            ["  +31.23040\n", 31.2304], ["121.47370", 121.4737],
            ["0", 0], ["+0.0", 0], ["-0", -0], [".5", .5], ["-.25", -.25], ["1.", 1],
            ["-90", -90], ["90", 90], ["-180", -180], ["180", 180], ["0.0000001", 1e-7],
        ] as const) {
            assert.equal(parseAVLocationCoordinate(source), expected, source);
        }
    });

    it("rejects pairs, malformed, nondecimal, nonfinite, and service-link coordinate fields", () => {
        for (const source of ["", " ", "+", "-", ".", "--1", "31,", ",121", "31,121", "31,121,0",
            "(20)", "[20]", "(20,30)", "1e1", "0x10", "0b10", "0o10", "NaN", "Infinity", "-Infinity",
            "9".repeat(400), "31 121", "31;121", "31\u00b0N", "geo:31,121", "https://example.com/?lat=31&lon=121"]) {
            assert.equal(parseAVLocationCoordinate(source), undefined, source);
        }
    });

    it("renders the canonical text with a fixed WGS84 label", () => {
        assert.equal(getAVLocationText(), "");
        assert.equal(getAVLocationText({name: "  Office  "}), "Office");
        assert.equal(getAVLocationText({latitude: 0, longitude: 0}), "0, 0 [WGS84]");
        assert.equal(getAVLocationText({name: "Office", latitude: 31.2, longitude: 121.5}),
            "Office; 31.2, 121.5 [WGS84]");
        assert.equal(getAVLocationText({latitude: 1e-7, longitude: -1e-8}), "0.0000001, -0.00000001 [WGS84]");
        assert.equal(formatAVLocationCoordinate(1.234e-7), "0.0000001234");
        assert.equal(formatAVLocationCoordinate(1e21), "1000000000000000000000");
        assert.equal(formatAVLocationCoordinate(-0), "0");
    });

    it("displays longitude first while preserving canonical text, named fields and provenance", () => {
        assert.equal(getAVLocationDisplayText(), "");
        assert.equal(getAVLocationDisplayText({name: "  Office  "}), "Office");
        const location = {name: "Office", latitude: 20, longitude: 30, originalInput: "20,30"};
        const before = {...location};
        const label = "WGS84";
        assert.equal(getAVLocationDisplayText(location), "Office 30, 20");
        assert.equal(getAVLocationText(location), `Office; 20, 30 [${label}]`);
        assert.deepEqual(location, before);
        assert.throws(() => createAVLocationFromText(getAVLocationText(location)));
        assert.equal(getAVLocationDisplayText({latitude: 1e-7, longitude: -1e-8}), "-0.00000001, 0.0000001");
        assert.equal(getAVLocationDisplayText({name: " 昆明 ", latitude: 25.04, longitude: 102.71}), "昆明 102.71, 25.04");
        assert.equal(getAVLocationDisplayText({latitude: 0, longitude: 0}), "0, 0");
    });

    it("excludes provenance from emptiness, display, and semantic equality", () => {
        const sourceOnly = {originalInput: "private imported source"};
        assert.equal(isAVLocationEmpty(sourceOnly), true);
        assert.equal(getAVLocationText(sourceOnly), "");
        assert.equal(isAVLocationEmpty({name: "  "}), true);
        assert.equal(isAVLocationEmpty({latitude: 0, longitude: 0}), false);
        assert.equal(isAVLocationEmpty({name: "Office"}), false);
        assert.equal(areAVLocationsEqual({name: "Office", originalInput: "a"},
            {name: "Office", originalInput: "b"}), true);
        assert.equal(areAVLocationsEqual({latitude: 0, longitude: 0},
            {latitude: 0, longitude: 1}), false);
    });
});

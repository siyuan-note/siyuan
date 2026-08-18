import * as assert from "node:assert/strict";
import test from "node:test";
import {
    getProfileEntryVisibility,
    isEntryVisibilityImportVersionSupported,
    normalizeEntryVisibilityImportProfile,
} from "./profile";

test("custom entry visibility preserves saved values", () => {
    const profile = {entries: {visible: true, hidden: false}};
    assert.equal(getProfileEntryVisibility(profile, "visible"), true);
    assert.equal(getProfileEntryVisibility(profile, "hidden"), false);
});

test("custom entry visibility shows missing entries", () => {
    assert.equal(getProfileEntryVisibility({entries: {}}, "new-entry"), true);
    assert.equal(getProfileEntryVisibility(undefined, "new-entry"), true);
});

test("entry visibility import supports versions 1, 2, and 3", () => {
    assert.equal(isEntryVisibilityImportVersionSupported(1, 3), true);
    assert.equal(isEntryVisibilityImportVersionSupported(2, 3), true);
    assert.equal(isEntryVisibilityImportVersionSupported(3, 3), true);
    assert.equal(isEntryVisibilityImportVersionSupported(4, 3), false);
});

test("legacy entry visibility imports require base without persisting it", () => {
    const profile = normalizeEntryVisibilityImportProfile({
        name: "Legacy",
        base: "simple",
        entries: {visible: true, hidden: false, invalid: "false"},
        orders: {menu: ["known", 1, "plugin"]},
    }, 2, {});
    assert.deepEqual(profile, {
        name: "Legacy",
        entries: {visible: true, hidden: false},
        orders: {menu: ["known", "plugin"]},
    });
    assert.equal(normalizeEntryVisibilityImportProfile({
        name: "Legacy",
        entries: {},
    }, 2, {}), undefined);
});

test("current entry visibility imports do not require base", () => {
    const defaultOrders = {menu: ["default"]};
    assert.deepEqual(normalizeEntryVisibilityImportProfile({
        name: "Current",
        entries: {},
    }, 3, defaultOrders), {
        name: "Current",
        entries: {},
        orders: defaultOrders,
    });
});

test("version 1 entry visibility imports use default orders", () => {
    const defaultOrders = {menu: ["default"]};
    assert.deepEqual(normalizeEntryVisibilityImportProfile({
        name: "Version 1",
        base: "full",
        entries: {},
    }, 1, defaultOrders), {
        name: "Version 1",
        entries: {},
        orders: defaultOrders,
    });
});

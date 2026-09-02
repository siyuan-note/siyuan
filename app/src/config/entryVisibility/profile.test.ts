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

test("entry visibility import supports versions 1 through 4", () => {
    assert.equal(isEntryVisibilityImportVersionSupported(1, 4), true);
    assert.equal(isEntryVisibilityImportVersionSupported(2, 4), true);
    assert.equal(isEntryVisibilityImportVersionSupported(3, 4), true);
    assert.equal(isEntryVisibilityImportVersionSupported(4, 4), true);
    assert.equal(isEntryVisibilityImportVersionSupported(5, 4), false);
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
    }, 4, defaultOrders), {
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

test("version 3 entry visibility imports migrate the edit mode submenu", () => {
    assert.deepEqual(normalizeEntryVisibilityImportProfile({
        name: "Legacy edit mode",
        entries: {
            "document.more.editMode": true,
            "document.more.editMode.wysiwyg": false,
            "document.more.editMode.preview": false,
        },
        orders: {
            "document.more.editMode": ["preview", "wysiwyg"],
        },
    }, 3, {}), {
        name: "Legacy edit mode",
        entries: {"document.more.editMode": false},
        orders: {},
    });
});

test("version 3 entry visibility imports keep the merged mode entry when a legacy child is visible", () => {
    assert.deepEqual(normalizeEntryVisibilityImportProfile({
        name: "Partially visible edit mode",
        entries: {
            "document.more.editMode": true,
            "document.more.editMode.wysiwyg": false,
            "document.more.editMode.preview": true,
        },
    }, 3, {}), {
        name: "Partially visible edit mode",
        entries: {"document.more.editMode": true},
        orders: {},
    });
});

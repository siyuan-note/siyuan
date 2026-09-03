import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {
    COMMAND_PANEL_EDITOR_KEYS,
    DESKTOP_COMMAND_PANEL_GENERAL_KEYS,
    getNativeCommandByLegacyId,
    isNativeCommandSupported,
    MOBILE_COMMAND_PANEL_GENERAL_KEYS,
    NATIVE_COMMAND_CATALOG,
    orderNativeCommands,
    type TNativeCommandEnvironment,
} from "./nativeCatalog";

const expectedDesktopGeneralKeys = [
    "addToDatabase", "fileTree", "outline", "bookmark", "tag", "dailyNote", "inbox", "backlinks",
    "graphView", "globalGraph", "closeAll", "closeLeft", "closeOthers", "closeRight", "closeTab",
    "closeUnmodified", "config", "dataHistory", "editReadonly", "enter", "enterBack", "globalSearch", "goBack",
    "goForward", "goToEditTabNext", "goToEditTabPrev", "goToTab1", "goToTab2", "goToTab3", "goToTab4",
    "goToTab5", "goToTab6", "goToTab7", "goToTab8", "goToTab9", "goToTabNext", "goToTabPrev", "lockScreen",
    "mainMenu", "move", "newFile", "recentDocs", "replace", "riffCard", "search", "selectOpen1", "syncNow",
    "splitLR", "splitMoveB", "splitMoveR", "splitTB", "switchLeftDock", "switchRightDock", "switchBottomDock",
    "tabToWindow", "stickSearch", "toggleDock", "toggleLeftDockPanel", "toggleRightDockPanel",
    "toggleBottomDockPanel", "unsplitAll", "unsplit", "recentClosed", "increaseEditorFontSize",
    "decreaseEditorFontSize", "resetEditorFontSize", "toggleWin",
];

const expectedMobileGeneralKeys = [
    "addToDatabase", "fileTree", "outline", "bookmark", "tag", "dailyNote", "inbox", "backlinks",
    "dataHistory", "editReadonly", "enter", "enterBack", "globalSearch", "lockScreen", "mainMenu", "move",
    "newFile", "recentDocs", "replace", "riffCard", "search", "selectOpen1", "syncNow", "increaseEditorFontSize",
    "decreaseEditorFontSize", "resetEditorFontSize",
];

const getSupportedIds = (environment: TNativeCommandEnvironment) => NATIVE_COMMAND_CATALOG
    .filter(item => isNativeCommandSupported(item, environment))
    .map(item => item.id);

describe("native command catalog", () => {
    it("preserves the existing command panel baseline", () => {
        assert.deepEqual([...DESKTOP_COMMAND_PANEL_GENERAL_KEYS], expectedDesktopGeneralKeys);
        assert.deepEqual([...MOBILE_COMMAND_PANEL_GENERAL_KEYS], expectedMobileGeneralKeys);
        assert.deepEqual([...COMMAND_PANEL_EDITOR_KEYS], ["switchReadonly", "switchAdjust"]);
        assert.equal(DESKTOP_COMMAND_PANEL_GENERAL_KEYS.length, 67);
        assert.equal(MOBILE_COMMAND_PANEL_GENERAL_KEYS.length, 26);
        assert.equal(COMMAND_PANEL_EDITOR_KEYS.length, 2);
        assert.equal(NATIVE_COMMAND_CATALOG.length, 69);
        assert.equal(new Set(NATIVE_COMMAND_CATALOG.map(item => item.id)).size, NATIVE_COMMAND_CATALOG.length);
    });

    it("filters all five frontends without exposing desktop-only commands", () => {
        assert.equal(getSupportedIds("desktop").length, 69);
        assert.equal(getSupportedIds("desktop-window").length, 69);
        assert.equal(getSupportedIds("browser-desktop").length, 68);
        assert.equal(getSupportedIds("mobile").length, 28);
        assert.equal(getSupportedIds("browser-mobile").length, 28);
        assert.equal(getSupportedIds("browser-desktop").includes("core.general.toggleWin"), false);
        assert.equal(getSupportedIds("mobile").includes("core.general.graphView"), false);
    });

    it("maps legacy keys to stable IDs and keymap paths", () => {
        assert.deepEqual(getNativeCommandByLegacyId("fileTree"), {
            id: "core.general.fileTree",
            legacyId: "fileTree",
            keymapPath: ["general", "fileTree"],
            desktop: true,
            mobile: true,
            browser: true,
            requirement: "none",
            order: 1,
        });
        assert.deepEqual(getNativeCommandByLegacyId("switchReadonly")?.keymapPath, [
            "editor",
            "general",
            "switchReadonly",
        ]);
    });

    it("preserves configured native order and keeps editor commands last", () => {
        assert.deepEqual(
            orderNativeCommands(
                ["unknown", "search", "fileTree"],
                ["switchAdjust", "unknown", "switchReadonly"],
            ).map(item => item.legacyId),
            ["search", "fileTree", "switchAdjust", "switchReadonly"],
        );
    });
});

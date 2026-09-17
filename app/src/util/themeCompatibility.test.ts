import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {
    getCurrentAppearanceTheme,
    isCurrentThemeSupported,
    isThemeFrontendSupported,
    shouldUnloadThemeScript
} from "./themeCompatibility";

const appearance = (overrides: Partial<Config.IAppearance> = {}) => ({
    mode: 0,
    themeLight: "light-theme",
    themeDark: "dark-theme",
    themeVer: "1.0.0",
    themeJS: true,
    lightThemes: [{name: "light-theme", label: "Light", frontends: ["desktop"]}],
    darkThemes: [{name: "dark-theme", label: "Dark", frontends: ["mobile"]}],
    ...overrides,
} as Config.IAppearance);

describe("theme frontend compatibility", () => {
    it("requires mobile themes to declare compatible frontends", () => {
        assert.equal(isThemeFrontendSupported(undefined, "mobile"), false);
        assert.equal(isThemeFrontendSupported(null, "browser-mobile"), false);
        assert.equal(isThemeFrontendSupported([], "mobile"), false);
        assert.equal(isThemeFrontendSupported(["all"], "mobile"), true);
        assert.equal(isThemeFrontendSupported(undefined, "desktop"), true);
    });

    it("matches frontends exactly", () => {
        assert.equal(isThemeFrontendSupported(["desktop"], "desktop"), true);
        assert.equal(isThemeFrontendSupported(["desktop"], "browser-desktop"), false);
        assert.equal(isThemeFrontendSupported(["browser-desktop"], "browser-desktop"), true);
    });

    it("selects the theme for the current appearance mode", () => {
        assert.equal(getCurrentAppearanceTheme(appearance())?.name, "light-theme");
        assert.equal(getCurrentAppearanceTheme(appearance({mode: 1}))?.name, "dark-theme");
    });

    it("does not load a missing custom theme while preserving its selection", () => {
        for (const frontend of ["desktop", "desktop-window", "browser-desktop", "mobile", "browser-mobile"]) {
            const missing = appearance({lightThemes: []});
            assert.equal(isCurrentThemeSupported(missing, frontend), false);
            assert.equal(isCurrentThemeSupported(appearance({lightThemes: undefined}), frontend), false);
            assert.equal(isCurrentThemeSupported(appearance({mode: 1, darkThemes: []}), frontend), false);
            assert.equal(missing.themeLight, "light-theme");
        }
    });

    it("keeps built-in themes available without package metadata", () => {
        for (const frontend of ["desktop", "browser-desktop", "mobile", "browser-mobile"]) {
            assert.equal(isCurrentThemeSupported(appearance({themeLight: "daylight", lightThemes: []}), frontend), true);
            assert.equal(isCurrentThemeSupported(appearance({mode: 1, themeDark: "midnight", darkThemes: []}), frontend), true);
        }
    });

    it("uses each mode's frontend declaration", () => {
        assert.equal(isCurrentThemeSupported(appearance(), "desktop"), true);
        assert.equal(isCurrentThemeSupported(appearance(), "mobile"), false);
        assert.equal(isCurrentThemeSupported(appearance({mode: 1}), "mobile"), true);
    });
});

describe("theme script lifecycle", () => {
    it("unloads when the active theme identity changes", () => {
        assert.equal(shouldUnloadThemeScript(appearance(), appearance({mode: 1}), "desktop"), true);
        assert.equal(shouldUnloadThemeScript(appearance(), appearance({themeLight: "other"}), "desktop"), true);
        assert.equal(shouldUnloadThemeScript(appearance(), appearance({themeVer: "2.0.0"}), "desktop"), true);
    });

    it("unloads when the next theme has no script or is incompatible", () => {
        assert.equal(shouldUnloadThemeScript(appearance(), appearance({themeJS: false}), "desktop"), true);
        const previous = appearance({
            lightThemes: [{name: "light-theme", label: "Light", frontends: ["mobile"]}],
        });
        assert.equal(shouldUnloadThemeScript(previous, appearance(), "mobile"), true);
        assert.equal(shouldUnloadThemeScript(appearance(), appearance({lightThemes: []}), "desktop"), true);
    });

    it("keeps a compatible unchanged script", () => {
        assert.equal(shouldUnloadThemeScript(appearance(), appearance(), "desktop"), false);
    });

    it("does not unload when the previous theme script was not loaded", () => {
        assert.equal(shouldUnloadThemeScript(
            appearance({themeJS: false}),
            appearance({mode: 1}),
            "desktop",
        ), false);
        assert.equal(shouldUnloadThemeScript(
            appearance(),
            appearance({mode: 1}),
            "mobile",
        ), false);
    });

    it("loads a newly compatible unchanged script without unloading", () => {
        const previous = appearance({
            lightThemes: [{name: "light-theme", label: "Light", frontends: ["mobile"]}],
        });
        assert.equal(shouldUnloadThemeScript(previous, appearance(), "desktop"), false);
    });
});

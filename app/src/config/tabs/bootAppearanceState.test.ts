import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {shouldShowBootAppearanceSetting, type IBootAppearanceListItem} from "./bootAppearanceState";

const appearance = (frontends: string[]): IBootAppearanceListItem => ({
    provider: "provider",
    appearance: "appearance",
    displayName: "Appearance",
    frontends,
});

describe("boot appearance setting visibility", () => {
    it("hides when no appearance is available", () => {
        assert.equal(shouldShowBootAppearanceSetting([], {provider: "", appearance: ""}, "desktop"), false);
    });

    it("hides when appearances do not support the current frontend", () => {
        assert.equal(shouldShowBootAppearanceSetting(
            [appearance(["mobile"])],
            {provider: "", appearance: ""},
            "desktop",
        ), false);
    });

    it("shows when an appearance supports the current frontend", () => {
        assert.equal(shouldShowBootAppearanceSetting(
            [appearance(["desktop"])],
            {provider: "", appearance: ""},
            "desktop",
        ), true);
    });

    it("shows an incompatible current selection so it can be cleared", () => {
        assert.equal(shouldShowBootAppearanceSetting(
            [appearance(["mobile"])],
            {provider: "provider", appearance: "appearance"},
            "desktop",
        ), true);
    });
});

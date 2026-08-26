import * as assert from "node:assert/strict";
import {describe, it} from "node:test";
import {isMobileMenuSearchMatch} from "./searchFilter";

describe("isMobileMenuSearchMatch", () => {
    it("shows every available item when the query is empty", () => {
        assert.equal(isMobileMenuSearchMatch("", {
            hidden: false,
            label: "editor",
        }), true);
    });

    it("does not reveal conditionally hidden items", () => {
        assert.equal(isMobileMenuSearchMatch("editor", {
            hidden: true,
            label: "editor",
        }), false);
    });

    it("matches ordinary menu item labels", () => {
        assert.equal(isMobileMenuSearchMatch("recent", {
            hidden: false,
            label: "recent documents",
        }), true);
        assert.equal(isMobileMenuSearchMatch("editor", {
            hidden: false,
            label: "recent documents",
        }), false);
    });

    it("uses the complete setting index result for setting tabs", () => {
        assert.equal(isMobileMenuSearchMatch("font", {
            hidden: false,
            label: "editor",
            settingMatches: true,
        }), true);
        assert.equal(isMobileMenuSearchMatch("font", {
            hidden: false,
            label: "editor",
            settingMatches: false,
        }), false);
    });
});

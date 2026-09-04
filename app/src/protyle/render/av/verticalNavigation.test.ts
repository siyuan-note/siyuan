import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {getAVVerticalNavigationAction} from "./verticalNavigation";

describe("database vertical navigation", () => {
    it("moves inside the database when an adjacent item exists", () => {
        assert.equal(getAVVerticalNavigationAction(true), "move");
    });

    it("leaves the database at its logical item boundary", () => {
        assert.equal(getAVVerticalNavigationAction(false), "leave");
    });
});

import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {
    createContextFilter,
    getContextFilterFields,
    getContextFilterKeyID,
    toggleContextFilterKeyID,
} from "./contextFilterState";

describe("database block context filter", () => {
    it("reads only the supported context filter specification", () => {
        assert.equal(getContextFilterKeyID({spec: 1, keyID: "relation-a"}), "relation-a");
        assert.equal(getContextFilterKeyID(null), "");
        assert.equal(getContextFilterKeyID({spec: 2, keyID: "relation-a"} as unknown as IAVContextFilter), "");
    });

    it("offers configured relation fields returned for the whole database", () => {
        const fields = [
            {id: "relation-a", name: "Project", icon: "", targetAvID: "target-a"},
            {id: "relation-other-view", name: "Area", icon: "", targetAvID: "target-b"},
            {id: "relation-unconfigured", name: "Empty", icon: "", targetAvID: ""},
        ];

        assert.deepEqual(getContextFilterFields(fields).map((field) => field.id), [
            "relation-a",
            "relation-other-view",
        ]);
        assert.deepEqual(getContextFilterFields(), []);
    });

    it("normalizes an empty field selection to a disabled filter", () => {
        assert.deepEqual(createContextFilter("relation-a"), {spec: 1, keyID: "relation-a"});
        assert.equal(createContextFilter(""), null);
    });

    it("toggles the selected relation field", () => {
        assert.equal(toggleContextFilterKeyID("", "relation-a"), "relation-a");
        assert.equal(toggleContextFilterKeyID("relation-a", "relation-a"), "");
        assert.equal(toggleContextFilterKeyID("relation-a", "relation-b"), "relation-b");
    });
});

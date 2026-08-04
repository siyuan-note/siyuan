import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {getAVLocateViewChange} from "./locateView";

describe("database item locate view persistence", () => {
    it("persists a requested view once", () => {
        const request = {viewID: "view-b"};

        assert.deepEqual(getAVLocateViewChange(request, "view-a", false), {
            viewID: "view-b",
            previousViewID: "view-a",
        });
        assert.equal(getAVLocateViewChange(request, "view-b", false), undefined);
    });

    it("keeps an explicitly temporary view in the runtime only", () => {
        assert.equal(getAVLocateViewChange({viewID: "view-b", persistView: false}, "view-a", false), undefined);
    });

    it("does not persist views in a read-only editor", () => {
        assert.equal(getAVLocateViewChange({viewID: "view-b"}, "view-a", true), undefined);
    });

    it("does not persist an unchanged or unspecified view", () => {
        assert.equal(getAVLocateViewChange({viewID: "view-a"}, "view-a", false), undefined);
        assert.equal(getAVLocateViewChange({}, "view-a", false), undefined);
    });
});

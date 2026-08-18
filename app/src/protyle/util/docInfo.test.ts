import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {getEmbeddedDocInfoResponse} from "./docInfo";

describe("getEmbeddedDocInfoResponse", () => {
    it("wraps embedded document information as an API response", () => {
        const docInfo = {id: "20260812000000-abcdefg", ial: {title: "Document"}};
        assert.deepEqual(getEmbeddedDocInfoResponse({
            code: 0,
            msg: "",
            data: {docInfo},
        }), {
            code: 0,
            msg: "",
            data: docInfo,
        });
    });

    it("keeps the standalone API fallback when document information is absent", () => {
        assert.equal(getEmbeddedDocInfoResponse({code: 0, msg: "", data: {}}), undefined);
        assert.equal(getEmbeddedDocInfoResponse({code: 0, msg: "", data: {docInfo: null}}), undefined);
    });
});

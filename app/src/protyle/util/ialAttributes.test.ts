import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {isHandlerIALAttribute} from "./ialAttributes";

describe("isHandlerIALAttribute", () => {
    it("rejects event handler attribute names", () => {
        for (const name of ["onclick", "onmouseover", "ONMOUSEOVER", "OnError", "on"]) {
            assert.equal(isHandlerIALAttribute(name), true, name);
        }
    });

    it("keeps ordinary attribute names", () => {
        for (const name of ["id", "updated", "custom-onload", "data-onclick", "title-img", "style"]) {
            assert.equal(isHandlerIALAttribute(name), false, name);
        }
    });
});

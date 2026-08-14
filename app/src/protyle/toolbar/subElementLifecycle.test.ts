import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {closeSubElement, ISubElementLifecycleState} from "./subElementLifecycle";

describe("closeSubElement", () => {
    it("runs a pending close callback exactly once", () => {
        let callCount = 0;
        const state: ISubElementLifecycleState = {
            subElementCloseCB: () => {
                callCount++;
            },
            subElementResizeCB: () => undefined,
        };

        closeSubElement(state);
        closeSubElement(state);

        assert.equal(callCount, 1);
        assert.equal(state.subElementCloseCB, undefined);
        assert.equal(state.subElementResizeCB, undefined);
    });

    it("clears the callback before invoking it to prevent reentrant commits", () => {
        let callCount = 0;
        const state: ISubElementLifecycleState = {};
        state.subElementCloseCB = () => {
            callCount++;
            closeSubElement(state);
        };

        closeSubElement(state);

        assert.equal(callCount, 1);
    });

    it("preserves replacement callbacks installed while closing", () => {
        const replacementClose: () => void = () => undefined;
        const replacementResize: () => void = () => undefined;
        const state: ISubElementLifecycleState = {};
        state.subElementCloseCB = () => {
            state.subElementCloseCB = replacementClose;
            state.subElementResizeCB = replacementResize;
        };

        closeSubElement(state);

        assert.equal(state.subElementCloseCB, replacementClose);
        assert.equal(state.subElementResizeCB, replacementResize);
    });

    it("keeps lifecycle state cleared when the close handler throws", () => {
        const state: ISubElementLifecycleState = {
            subElementCloseCB: () => {
                throw new Error("close failed");
            },
            subElementResizeCB: () => undefined,
        };

        assert.throws(() => closeSubElement(state), /close failed/);
        assert.equal(state.subElementCloseCB, undefined);
        assert.equal(state.subElementResizeCB, undefined);
    });
});

import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {
    closeSubElement,
    ISubElementLifecycleState,
    SELECTION_TOOLBAR_SUB_ELEMENT_SOURCE,
    setSubElementSource,
} from "./subElementLifecycle";

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

    it("clears the sub-element source before invoking its close handler", () => {
        const subElement = {dataset: {}} as HTMLElement;
        const state: ISubElementLifecycleState = {
            subElement,
            subElementCloseCB: () => {
                assert.equal(subElement.dataset.subElementSource, undefined);
            },
        };
        setSubElementSource(state, SELECTION_TOOLBAR_SUB_ELEMENT_SOURCE);

        closeSubElement(state);

        assert.equal(subElement.dataset.subElementSource, undefined);
    });

    it("preserves a replacement sub-element source installed while closing", () => {
        const subElement = {dataset: {}} as HTMLElement;
        const state: ISubElementLifecycleState = {
            subElement,
            subElementCloseCB: () => {
                setSubElementSource(state, "replacement");
            },
        };
        setSubElementSource(state, SELECTION_TOOLBAR_SUB_ELEMENT_SOURCE);

        closeSubElement(state);

        assert.equal(subElement.dataset.subElementSource, "replacement");
    });
});

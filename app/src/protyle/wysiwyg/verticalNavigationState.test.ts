import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {
    isAtomicVerticalNavigationRange,
    VERTICAL_NAVIGATION_ATOMIC_CLASS,
} from "./verticalNavigationState";

const element = (atomic: boolean) => ({
    nodeType: 1,
    classList: {
        contains: (className: string) => atomic && className === VERTICAL_NAVIGATION_ATOMIC_CLASS,
    },
}) as unknown as Element;

describe("vertical navigation state", () => {
    it("recognizes only the collapsed range placed on the atomic owner", () => {
        const owner = element(true);

        assert.equal(isAtomicVerticalNavigationRange({
            collapsed: true,
            startContainer: owner,
            startOffset: 0,
        } as unknown as Range), true);
        assert.equal(isAtomicVerticalNavigationRange({
            collapsed: true,
            startContainer: owner,
            startOffset: 1,
        } as unknown as Range), false);
        assert.equal(isAtomicVerticalNavigationRange({
            collapsed: true,
            startContainer: element(false),
            startOffset: 0,
        } as unknown as Range), false);
        assert.equal(isAtomicVerticalNavigationRange({
            collapsed: false,
            startContainer: owner,
            startOffset: 0,
        } as unknown as Range), false);
    });
});

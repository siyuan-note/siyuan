import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {
    isAtomicVerticalNavigationRange,
    shouldKeepAtomicVerticalNavigationTarget,
    VERTICAL_NAVIGATION_ATOMIC_CLASS,
} from "./verticalNavigationState";

class AtomicElement {
    nodeType = 1;
    children = new Set<Node>();
    constructor(private atomic: boolean, private folded = false) {}
    classList = {
        contains: (className: string) => this.atomic && className === VERTICAL_NAVIGATION_ATOMIC_CLASS,
    };
    getAttribute(name: string) {
        return name === "fold" && this.folded ? "1" : null;
    }
    contains(node: Node) {
        return node === this as unknown as Node || this.children.has(node);
    }
}

const element = (atomic: boolean, folded = false) => new AtomicElement(atomic, folded) as unknown as Element;

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

    it("keeps a folded atomic position until the selection actually moves", () => {
        const owner = element(true, true);
        const range = {
            collapsed: true,
            startContainer: owner,
            startOffset: 0,
        } as unknown as Range;

        assert.equal(shouldKeepAtomicVerticalNavigationTarget(owner, range), true);
        assert.equal(shouldKeepAtomicVerticalNavigationTarget(owner, {
            ...range,
            startOffset: 1,
        } as unknown as Range), false);
        assert.equal(shouldKeepAtomicVerticalNavigationTarget(owner, {
            ...range,
            startContainer: element(false),
        } as unknown as Range), false);
    });

    it("keeps a non-folded atomic target while the selection remains inside it", () => {
        const owner = element(true) as unknown as AtomicElement;
        const child = element(false) as unknown as Node;
        owner.children.add(child);

        assert.equal(shouldKeepAtomicVerticalNavigationTarget(owner as unknown as Element, {
            collapsed: true,
            startContainer: child,
            startOffset: 0,
        } as unknown as Range), true);
        assert.equal(shouldKeepAtomicVerticalNavigationTarget(owner as unknown as Element, {
            collapsed: false,
            startContainer: child,
            startOffset: 0,
        } as unknown as Range), false);
    });
});

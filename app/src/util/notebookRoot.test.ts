import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {updateNotebookRootForBoxDoc} from "./notebookRoot";

const createRoot = () => {
    const attributes = new Map<string, string>();
    const toggleClasses = new Set<string>();
    const arrowClasses = new Set(["b3-list-item__arrow--open"]);
    let childRemoved = false;
    const arrowElement = {
        classList: {
            remove: (name: string) => arrowClasses.delete(name),
        },
    };
    const toggleElement = {
        classList: {
            toggle(name: string, force: boolean) {
                if (force) {
                    toggleClasses.add(name);
                } else {
                    toggleClasses.delete(name);
                }
            },
        },
        querySelector: () => arrowElement,
    };
    const childElement = {
        tagName: "UL",
        remove: () => {
            childRemoved = true;
        },
    };
    const rootElement = {
        nextElementSibling: childElement,
        setAttribute: (name: string, value: string) => attributes.set(name, value),
        querySelector: () => toggleElement,
    } as unknown as HTMLElement;
    return {
        rootElement,
        attributes,
        toggleClasses,
        arrowClasses,
        childRemoved: () => childRemoved,
    };
};

describe("updateNotebookRootForBoxDoc", () => {
    it("enables an empty notebook document without rebuilding its root", () => {
        const root = createRoot();

        const count = updateNotebookRootForBoxDoc(root.rootElement, {
            id: "20260814120000-abcdefg",
            subFileCount: 0,
        }, true);

        assert.equal(count, 0);
        assert.equal(root.attributes.get("data-node-id"), "20260814120000-abcdefg");
        assert.equal(root.attributes.get("data-count"), "0");
        assert.equal(root.toggleClasses.has("fn__hidden"), true);
        assert.equal(root.arrowClasses.has("b3-list-item__arrow--open"), false);
        assert.equal(root.childRemoved(), true);
    });

    it("disables a notebook document while preserving its expanded children", () => {
        const root = createRoot();

        updateNotebookRootForBoxDoc(root.rootElement, {
            id: "20260814120000-abcdefg",
            subFileCount: 0,
        }, false);

        assert.equal(root.attributes.get("data-node-id"), "");
        assert.equal(root.toggleClasses.has("fn__hidden"), false);
        assert.equal(root.arrowClasses.has("b3-list-item__arrow--open"), true);
        assert.equal(root.childRemoved(), false);
    });

    it("keeps the expand control for a notebook document with children", () => {
        const root = createRoot();

        const count = updateNotebookRootForBoxDoc(root.rootElement, {
            id: "20260814120000-abcdefg",
            subFileCount: 3,
        }, true);

        assert.equal(count, 3);
        assert.equal(root.attributes.get("data-count"), "3");
        assert.equal(root.toggleClasses.has("fn__hidden"), false);
        assert.equal(root.childRemoved(), false);
    });
});

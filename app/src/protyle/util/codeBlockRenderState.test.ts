import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {resetCodeBlockRenderState} from "./codeBlockRenderState";

const createCodeBlock = (renderNode = false) => {
    const removedAttributes: string[] = [];
    const hljsRemovedAttributes: string[] = [];
    const icons = {
        removed: false,
        remove() {
            this.removed = true;
        },
    };
    const spin = {innerHTML: "rendered"};
    const element = {
        classList: {
            contains(className: string) {
                return renderNode && className === "render-node";
            },
        },
        getAttribute(attribute: string) {
            return attribute === "data-type" ? "NodeCodeBlock" : null;
        },
        querySelector(selector: string) {
            if (selector === ".hljs") {
                return {
                    removeAttribute(attribute: string) {
                        hljsRemovedAttributes.push(attribute);
                    },
                };
            }
            if (selector === ".protyle-icons") {
                return icons;
            }
            if (selector === '[spin="1"]') {
                return spin;
            }
            return null;
        },
        querySelectorAll(): Element[] {
            return [];
        },
        removeAttribute(attribute: string) {
            removedAttributes.push(attribute);
        },
    } as unknown as Element;
    return {element, hljsRemovedAttributes, icons, spin, removedAttributes};
};

describe("resetCodeBlockRenderState", () => {
    it("invalidates a regular code block without clearing block attributes", () => {
        const codeBlock = createCodeBlock();

        resetCodeBlockRenderState(codeBlock.element);

        assert.deepEqual(codeBlock.hljsRemovedAttributes, ["data-render"]);
        assert.deepEqual(codeBlock.removedAttributes, []);
        assert.equal(codeBlock.icons.removed, false);
        assert.equal(codeBlock.spin.innerHTML, "rendered");
    });

    it("invalidates nested regular and rendered code blocks", () => {
        const regularCodeBlock = createCodeBlock();
        const renderedCodeBlock = createCodeBlock(true);
        const container = {
            getAttribute(): null {
                return null;
            },
            querySelectorAll(): Element[] {
                return [regularCodeBlock.element, renderedCodeBlock.element];
            },
        } as unknown as Element;

        resetCodeBlockRenderState(container);

        assert.deepEqual(regularCodeBlock.hljsRemovedAttributes, ["data-render"]);
        assert.deepEqual(renderedCodeBlock.hljsRemovedAttributes, ["data-render"]);
        assert.deepEqual(renderedCodeBlock.removedAttributes, ["data-render"]);
        assert.equal(renderedCodeBlock.icons.removed, true);
        assert.equal(renderedCodeBlock.spin.innerHTML, "");
    });
});

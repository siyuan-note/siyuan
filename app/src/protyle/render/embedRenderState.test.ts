import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {finishCustomEmbedRender} from "./embedRenderState";

describe("finishCustomEmbedRender", () => {
    it("clears the loading state and invokes the completion callback", () => {
        const classes = new Set(["fn__rotate"]);
        const rotateElement = {
            classList: {
                remove: (name: string) => classes.delete(name),
            },
        } as unknown as Element;
        const item = {style: {height: "120px"}} as HTMLElement;
        let callbackCount = 0;

        finishCustomEmbedRender(item, {rotateElement, height: "120px"}, () => {
            callbackCount++;
        });

        assert.equal(classes.has("fn__rotate"), false);
        assert.equal(item.style.height, "");
        assert.equal(callbackCount, 1);
    });

    it("preserves a height set by the custom renderer", () => {
        const item = {style: {height: "240px"}} as HTMLElement;

        finishCustomEmbedRender(item, {rotateElement: null, height: "120px"});

        assert.equal(item.style.height, "240px");
    });
});

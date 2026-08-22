import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {finishCustomEmbedRender, finishEmptyEmbedRender} from "./embedRenderState";

const createClassList = (...names: string[]) => {
    const classes = new Set(names);
    return {
        classes,
        classList: {
            contains: (name: string) => classes.has(name),
            remove: (name: string) => classes.delete(name),
        },
    };
};

describe("finishEmptyEmbedRender", () => {
    it("clears rendered content and loading state while preserving the frame", () => {
        const rotateElement = createClassList("fn__rotate");
        const icons = createClassList("protyle-icons");
        const cursor = createClassList("protyle-cursor");
        const result = {...createClassList("protyle-wysiwyg__embed"), remove() {
            children.splice(children.indexOf(result), 1);
        }};
        const attr = createClassList("protyle-attr");
        const children = [icons, result, cursor, attr];
        const item = {
            children,
            querySelector: () => rotateElement,
            style: {height: "120px"},
        } as unknown as HTMLElement;
        let callbackCount = 0;

        finishEmptyEmbedRender(item, () => {
            callbackCount++;
        });

        assert.equal(rotateElement.classes.has("fn__rotate"), false);
        assert.deepEqual(children, [icons, cursor, attr]);
        assert.equal(item.style.height, "");
        assert.equal(callbackCount, 1);
    });
});

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

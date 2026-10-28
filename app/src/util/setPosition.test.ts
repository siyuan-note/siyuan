import * as assert from "node:assert/strict";
import {test} from "node:test";
import {loadModule} from "../testSupport/loadModule";

test("sticky menus retain their anchor while staying inside a resized viewport", () => {
    const viewport = {innerWidth: 1000, innerHeight: 800};
    const methods = loadModule<typeof import("./setPosition")>("src/util/setPosition.ts", {
        require: () => ({getTopBarHeight: () => 30}),
        window: viewport,
    });
    let height = 400;
    const element = {
        style: {left: "0px", top: "0px"},
        dataset: {} as Record<string, string>,
        getBoundingClientRect() {
            const top = parseFloat(this.style.top);
            const left = parseFloat(this.style.left);
            return {top, left, right: left + 300, bottom: top + height, width: 300, height};
        },
    };
    const position = () => methods.setPosition(element as unknown as HTMLElement, 650, 750, 30, 0, true);
    position();
    assert.equal(element.style.top, "320px");
    height = 500;
    position();
    assert.equal(element.style.top, "220px");
    assert.equal(element.style.left, "650px");
    viewport.innerWidth = 360;
    viewport.innerHeight = 640;
    position();
    assert.equal(element.style.top, "140px");
    assert.equal(element.style.left, "60px");
    assert.equal(element.dataset.positionBottom, "640");
    height = 620;
    position();
    assert.equal(element.style.top, "30px");
});

import {strict as assert} from "node:assert";
import {describe, it} from "node:test";
import {getPageScrollTop, scrollPageWithLoading} from "./page";

describe("getPageScrollTop", () => {
    it("keeps a 60-pixel overlap between pages", () => {
        assert.equal(getPageScrollTop(1_000, 5_000, 800, "up"), 260);
        assert.equal(getPageScrollTop(1_000, 5_000, 800, "down"), 1_740);
    });

    it("limits scrolling to the content boundaries", () => {
        assert.equal(getPageScrollTop(100, 5_000, 800, "up"), 0);
        assert.equal(getPageScrollTop(4_000, 5_000, 800, "down"), 4_200);
    });

    it("does not reverse direction when the viewport is shorter than the overlap", () => {
        assert.equal(getPageScrollTop(100, 500, 40, "up"), 100);
        assert.equal(getPageScrollTop(100, 500, 40, "down"), 100);
    });
});

const pageFixture = (scrollTop: number, scrollHeight = 5000, clientHeight = 800) => {
    const attributes = new Set<string>();
    const firstAttributes = new Map<string, string>();
    const loads: Array<{mode: number, options: {
        suppressFocus: boolean, beforeApply: () => void, onFinish: (success: boolean) => void,
    }}> = [];
    const contentElement = {scrollTop, scrollHeight, clientHeight};
    const protyle = {
        contentElement,
        element: {isConnected: true},
        block: {rootID: "document", scroll: true, showAll: false},
        wysiwyg: {element: {
            hasAttribute: (name: string) => attributes.has(name),
            firstElementChild: {getAttribute: (name: string) => firstAttributes.get(name)},
        }},
        scroll: {
            lastScrollTop: scrollTop,
            loadDynamic: (_protyle: IProtyle, mode: number, options: typeof loads[number]["options"]) => {
                attributes.add("data-top");
                loads.push({mode, options});
                return true;
            },
        },
    };
    const scroll = (direction: "up" | "down") => scrollPageWithLoading(protyle as unknown as IProtyle, direction);
    const complete = (addedHeight = 1000, success = true) => {
        const load = loads[loads.length - 1];
        load.options.beforeApply();
        if (success) {
            contentElement.scrollHeight += addedHeight;
            if (load.mode === 1) {
                contentElement.scrollTop += addedHeight;
            }
        }
        attributes.delete("data-top");
        load.options.onFinish(success);
    };
    return {protyle, contentElement, loads, attributes, firstAttributes, scroll, complete};
};

describe("page scroll buttons", () => {
    it("scrolls one screen with overlap without loading in the middle", () => {
        const fixture = pageFixture(1000);
        fixture.scroll("down");
        assert.equal(fixture.contentElement.scrollTop, 1740);
        fixture.scroll("up");
        assert.equal(fixture.contentElement.scrollTop, 1000);
        assert.equal(fixture.loads.length, 0);
    });

    it("loads previous blocks at zero and completes only the remaining distance", () => {
        const fixture = pageFixture(100);
        fixture.scroll("up");
        assert.equal(fixture.contentElement.scrollTop, 0);
        assert.equal(fixture.loads[0].mode, 1);
        assert.equal(fixture.loads[0].options.suppressFocus, true);
        fixture.complete();
        assert.equal(fixture.contentElement.scrollTop, 360);
    });

    it("loads next blocks at the boundary even when no scroll event can occur", () => {
        for (const height of [800, 500]) {
            const fixture = pageFixture(0, height);
            fixture.protyle.scroll.lastScrollTop = -1;
            fixture.scroll("down");
            assert.equal(fixture.loads[0].mode, 2);
            fixture.complete();
            assert.equal(fixture.contentElement.scrollTop, Math.min(740, height + 1000 - 800));
        }
    });

    it("finishes a partially scrolled page after appending blocks", () => {
        const fixture = pageFixture(4000);
        fixture.scroll("down");
        assert.equal(fixture.contentElement.scrollTop, 4200);
        fixture.complete();
        assert.equal(fixture.contentElement.scrollTop, 4740);
    });

    it("does not load beyond document boundaries or focused blocks", () => {
        const fixture = pageFixture(100);
        fixture.firstAttributes.set("data-eof", "1");
        fixture.scroll("up");
        assert.equal(fixture.loads.length, 0);
        fixture.attributes.add("data-bottom-eof");
        fixture.contentElement.scrollTop = 4100;
        fixture.scroll("down");
        assert.equal(fixture.contentElement.scrollTop, 4200);
        assert.equal(fixture.loads.length, 0);
        fixture.attributes.delete("data-bottom-eof");
        fixture.protyle.block.showAll = true;
        fixture.scroll("down");
        assert.equal(fixture.loads.length, 0);
    });

    it("does not move during loading or apply pending movement after navigation or failure", () => {
        for (const action of ["switch", "disconnect", "failure", "user-scroll"]) {
            const fixture = pageFixture(4000);
            fixture.scroll("down");
            fixture.scroll("up");
            assert.equal(fixture.contentElement.scrollTop, 4200);
            assert.equal(fixture.loads.length, 1);
            if (action === "switch") fixture.protyle.block.rootID = "another-document";
            if (action === "disconnect") fixture.protyle.element.isConnected = false;
            if (action === "user-scroll") fixture.contentElement.scrollTop = 1000;
            const previousTop = fixture.contentElement.scrollTop;
            fixture.complete(1000, action !== "failure");
            assert.equal(fixture.contentElement.scrollTop, previousTop);
        }
    });
});

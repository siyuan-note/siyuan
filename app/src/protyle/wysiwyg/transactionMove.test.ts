import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {cloneMoveElements, getVisibleMoveElements} from "./transactionMove";
import {DOMElement, DOMFixture} from "../render/av/map/testDOM";

class TestMoveElement {
    nextElementSibling?: TestMoveElement;

    constructor(readonly id?: string) {
    }

    getAttribute(name: string) {
        return name === "data-node-id" ? this.id ?? null : null;
    }
}

const asElement = (element: TestMoveElement) => element as unknown as Element;

const linkElements = (...elements: TestMoveElement[]) => {
    elements.forEach((element, index) => {
        element.nextElementSibling = elements[index + 1];
    });
};

describe("getVisibleMoveElements", () => {
    it("collects the visible members of a stored move group in order", () => {
        const heading = new TestMoveElement("heading");
        const first = new TestMoveElement("first");
        const second = new TestMoveElement("second");
        const target = new TestMoveElement("target");
        linkElements(heading, first, second, target);

        assert.deepEqual(
            getVisibleMoveElements(asElement(heading), ["first", "second"]),
            [heading, first, second],
        );
    });

    it("allows folded descendants to be absent from the DOM", () => {
        const heading = new TestMoveElement("heading");
        const first = new TestMoveElement("first");
        const third = new TestMoveElement("third");
        const target = new TestMoveElement("target");
        linkElements(heading, first, third, target);

        assert.deepEqual(
            getVisibleMoveElements(asElement(heading), ["first", "hidden", "third"]),
            [heading, first, third],
        );
    });

    it("does not absorb destination blocks when all original children are hidden", () => {
        const heading = new TestMoveElement("heading");
        const target = new TestMoveElement("target");
        linkElements(heading, target);

        assert.deepEqual(getVisibleMoveElements(asElement(heading), ["hidden"]), [heading]);
        assert.deepEqual(getVisibleMoveElements(asElement(heading), []), [heading]);
    });
});

it("move clones rebuild only map hosts and preserve database configuration and other layouts", () => {
    const document = new DOMFixture();
    const create = (html: string) => {
        const wrapper = document.createElement("div");
        wrapper.innerHTML = html;
        return wrapper.firstElementChild;
    };
    const mapHTML = '<div data-type="NodeAttributeView" data-node-id="carrier" data-av-id="database" data-av-type="map" custom-sy-av-view="view" data-render="true"><div class="av__container"><div class="av__map"><webview partition="temporary"></webview></div><div class="av__scroll"></div></div></div>';
    const tableHTML = '<div data-type="NodeAttributeView" data-av-type="table" data-render="true"><div class="av__container">table</div></div>';
    for (const html of [mapHTML, `<div data-type="NodeSuperBlock">${mapHTML}${tableHTML}</div>`]) {
        const source = create(html);
        Object.assign(source, {cloneNode: () => create(html)});
        const pending = new Set<Element>();
        const [clone] = cloneMoveElements([source as unknown as Element], pending);
        assert.equal(pending.size, 1);
        const map = [...pending][0] as unknown as DOMElement;
        assert.equal(map.getAttribute("data-render"), null);
        assert.equal(map.querySelector(".av__map"), null);
        assert.equal(map.getAttribute("custom-sy-av-view"), "view");
        assert.equal(map.getAttribute("data-av-id"), "database");
        assert.ok(map.querySelector(".av__scroll"));
        assert.ok(source.querySelector("webview"));
        const table = clone.querySelector('[data-av-type="table"]');
        if (table) {
            assert.equal(table.getAttribute("data-render"), "true");
            assert.equal(table.textContent, "table");
        }
    }
});

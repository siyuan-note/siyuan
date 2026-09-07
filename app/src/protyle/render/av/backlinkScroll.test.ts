import * as assert from "node:assert/strict";
import {describe, it} from "node:test";
import {getBacklinkScrollElement, revealBacklinkReference, scrollBacklinkTarget} from "./backlinkScroll";

const element = (classes: string[], parent?: HTMLElement): HTMLElement => {
    const node = {
        parentElement: parent,
        classList: {contains: (name: string) => classes.includes(name)},
        contains(target: HTMLElement) {
            let current = target;
            while (current) {
                if (current === this as unknown as HTMLElement) {
                    return true;
                }
                current = current.parentElement;
            }
            return false;
        },
        closest(selector: string) {
            let current = this as unknown as HTMLElement;
            while (current) {
                if (selector.split(",").some(item => current.classList.contains(item.trim().slice(1)))) {
                    return current;
                }
                current = current.parentElement;
            }
            return null;
        },
    };
    return node as unknown as HTMLElement;
};

describe("database backlink scrolling", () => {
    it("uses the database viewport inside the dock without selecting the list", () => {
        const panel = element(["sy__backlink"]);
        const list = element(["backlinkList"], panel);
        const innerEditor = element(["protyle-content"], list);
        const database = element(["av", "av--backlink"], innerEditor);
        assert.equal(getBacklinkScrollElement(database), database);
        assert.equal(getBacklinkScrollElement(element([], database)), database);
    });

    it("uses the database viewport in bottom backlinks without selecting the owning document", () => {
        const ownerEditor = element(["protyle-content"]);
        const panel = element(["sy__backlink", "sy__backlink--bottom"], ownerEditor);
        const list = element(["backlinkList"], panel);
        const innerEditor = element(["protyle-content"], list);
        const database = element(["av", "av--backlink"], innerEditor);
        assert.equal(getBacklinkScrollElement(database), database);
    });

    it("keeps ordinary database locating on the existing editor scroll path", () => {
        const editor = element(["protyle-content"]);
        assert.equal(getBacklinkScrollElement(element(["av"], editor)), undefined);
    });

    it("locates each database independently while preserving the outer reading position", () => {
        const outer = element(["backlinkList"]);
        outer.scrollTop = 240;
        const first = element(["av", "av--backlink"], outer);
        const second = element(["av", "av--backlink"], outer);
        [first, second].forEach(database => {
            Object.assign(database, {
                scrollTop: 0, clientHeight: 400,
                getBoundingClientRect: () => ({top: 100}),
            });
        });
        const reference = element([], first);
        reference.getBoundingClientRect = () => ({top: 1300}) as DOMRect;
        assert.equal(scrollBacklinkTarget(first, reference), true);
        assert.equal(first.scrollTop, 1000);
        assert.equal(second.scrollTop, 0);
        assert.equal(outer.scrollTop, 240);
        assert.equal(scrollBacklinkTarget(second, reference), false);
        assert.equal(second.scrollTop, 0);
        const secondReference = element([], second);
        secondReference.getBoundingClientRect = reference.getBoundingClientRect;
        assert.equal(scrollBacklinkTarget(second, secondReference), true);
        assert.equal(second.scrollTop, 1000);
        assert.equal(outer.scrollTop, 240);
    });

    it("reveals a clipped reference inside a long field without scrolling outside the cell", () => {
        const cell = element(["av__cell"]);
        Object.assign(cell, {
            scrollLeft: 0, scrollTop: 0,
            clientWidth: 100, scrollWidth: 1000,
            clientHeight: 30, scrollHeight: 300,
            contains: (node: HTMLElement) => node === cell,
            getBoundingClientRect: () => ({left: 0, right: 100, top: 0, bottom: 30}),
        });
        const reference = element([], cell);
        reference.getBoundingClientRect = () => ({left: 500, right: 550, top: 120, bottom: 140}) as DOMRect;
        revealBacklinkReference(reference, cell);
        assert.equal(cell.scrollLeft, 500);
        assert.equal(cell.scrollTop, 120);
    });
});

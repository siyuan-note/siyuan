import * as assert from "node:assert/strict";
import {test} from "node:test";
import {closeInlineFilterDropdowns} from "./filterDropdown";

test("inline dropdown dismissal isolates editors and paths and preserves internal interaction", () => {
    for (const [type, selector] of [
        ["selectDropdown", '[data-type="selectTrigger"]'],
        ["relationFilterDropdown", '[data-type="relationFilterTrigger"]'],
        ["relList", '[data-type-rel="relation"]'],
    ]) {
        const firstEditor = {};
        const secondEditor = {};
        const makeDropdown = (editor: object, path: string) => ({
            dataset: {path, selected: '["kept"]'}, style: {display: "block"},
            contains: (target: object) => target === inside,
            closest: () => editor,
        });
        const inside = {};
        const dropdown = makeDropdown(firstEditor, "0");
        const sibling = {...makeDropdown(firstEditor, "1"), contains: () => false};
        const foreign = {...makeDropdown(secondEditor, "0"), contains: () => false};
        const dropdowns = [dropdown, sibling, foreign];
        const root = {querySelectorAll: (query: string) => query === `[data-type="${type}"]` ? dropdowns : []};
        const click = (target: object) => closeInlineFilterDropdowns(root as unknown as HTMLElement, target as HTMLElement);
        const trigger = (editor: object, path: string) => ({closest: (query: string) => query === selector ? {
            dataset: {path}, closest: () => editor,
        } : null});
        const reset = () => dropdowns.forEach(item => { item.style.display = "block"; });
        click(trigger(firstEditor, "0"));
        assert.equal(dropdown.style.display, "block", `${type}: leave trigger toggling to its editor`);
        assert.equal(sibling.style.display, "none", `${type}: close another path in the same editor`);
        assert.equal(foreign.style.display, "none", `${type}: close the same path in another editor`);
        reset();
        Object.assign(inside, {closest: (): null => null});
        click(inside);
        assert.equal(dropdown.style.display, "block", `${type}: keep internal choices and search open`);
        assert.equal(foreign.style.display, "none");
        reset();
        click({closest: (): null => null});
        assert.ok(dropdowns.every(item => item.style.display === "none"), `${type}: close on blank areas`);
        assert.ok(dropdowns.every(item => item.dataset.selected === '["kept"]'), `${type}: dismissal preserves selections`);
    }
});

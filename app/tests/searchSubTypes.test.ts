import assert from "node:assert/strict";
import {test} from "node:test";
import {bindSearchSubtypeFilters} from "../src/search/subTypes";

class Input extends EventTarget {
    constructor(public checked = false) {
        super();
    }

    toggle() {
        this.checked = !this.checked;
        this.dispatchEvent(new Event("change"));
    }
}

const createFilters = (enabled = false, selected = false) => {
    const groups = ["heading", "list", "listItem"].map((name, index) => ({
        name,
        parent: new Input(enabled),
        children: Array.from({length: index === 0 ? 6 : 3}, (_, i) => new Input(selected && i === 0)),
    }));
    const find = (selector: string) => groups.find((group) => selector.includes(`"${group.name}"`));
    const element = {
        querySelector: (selector: string) => find(selector).parent,
        querySelectorAll: (selector: string) => find(selector).children,
    };
    bindSearchSubtypeFilters(element as unknown as HTMLElement);
    return groups;
};

test("unrestricted enabled groups display all subtypes; disabled groups clear stale selections", () => {
    for (const enabled of [false, true]) {
        for (const selected of [false, true]) {
            for (const group of createFilters(enabled, selected)) {
                assert.equal(group.parent.checked, enabled);
                assert.deepEqual(group.children.map((child) => child.checked),
                    group.children.map((_, i) => enabled && (!selected || i === 0)));
            }
        }
    }
});

test("each reachable selection and each next operation preserve independent symmetric cascading", () => {
    for (let groupIndex = 0; groupIndex < 3; groupIndex++) {
        const size = groupIndex === 0 ? 6 : 3;
        for (let mask = 0; mask < 1 << size; mask++) {
            for (let operation = -1; operation < size; operation++) {
                const groups = createFilters();
                const target = groups[groupIndex];
                target.children.forEach((child, i) => {
                    if (mask & (1 << i)) {
                        child.toggle();
                    }
                });
                const before = groups.map((group) => [group.parent.checked, ...group.children.map((child) => child.checked)]);
                if (operation === -1) {
                    target.parent.toggle();
                    assert.ok(target.children.every((child) => child.checked === target.parent.checked));
                } else {
                    target.children[operation].toggle();
                    target.children.forEach((child, i) => {
                        assert.equal(child.checked, i === operation ? !before[groupIndex][i + 1] : before[groupIndex][i + 1]);
                    });
                }
                groups.forEach((group, i) => {
                    assert.equal(group.parent.checked, group.children.some((child) => child.checked));
                    if (i !== groupIndex) {
                        assert.deepEqual([group.parent.checked, ...group.children.map((child) => child.checked)], before[i]);
                    }
                });
            }
        }
    }
});

import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {updateMenuGroupsOnMutation, updateMenuItemGroupClasses} from "./menuGroup";

const element = (...classes: string[]) => {
    const values = new Set(classes);
    return {
        classList: {
            add: (...names: string[]) => names.forEach(name => values.add(name)),
            remove: (...names: string[]) => names.forEach(name => values.delete(name)),
            contains: (name: string) => values.has(name),
        },
    } as unknown as HTMLElement;
};

const items = (...children: HTMLElement[]) => Object.assign(element(), {children});

describe("menu groups", () => {
    it("updates rounded edges after deleting the first and last history entries", () => {
        const clear = element("b3-menu__item");
        const first = element("b3-menu__item");
        const middle = element("b3-menu__item");
        const last = element("b3-menu__item");
        const container = items(clear, element("b3-menu__separator"), first, middle, last);
        container.classList.add("b3-menu__items");
        updateMenuItemGroupClasses(container);
        const mutation = {type: "childList", target: container} as unknown as MutationRecord;

        container.children.splice(2, 1);
        updateMenuGroupsOnMutation([mutation]);
        assert.equal(middle.classList.contains("b3-menu__item--group-first"), true);
        assert.equal(middle.classList.contains("b3-menu__item--group-last"), false);

        container.children.pop();
        updateMenuGroupsOnMutation([mutation]);
        assert.equal(middle.classList.contains("b3-menu__item--group-first"), true);
        assert.equal(middle.classList.contains("b3-menu__item--group-last"), true);
        assert.equal(clear.classList.contains("b3-menu__item--group-first"), true);
        assert.equal(clear.classList.contains("b3-menu__item--group-last"), true);
    });

    it("keeps database navigation titles outside rounded action groups", () => {
        const title = element("b3-menu__item", "b3-menu__title");
        const first = element("b3-menu__item");
        const last = element("b3-menu__item");
        updateMenuItemGroupClasses(items(title, first, last));
        assert.equal(title.classList.contains("b3-menu__item--group-first"), false);
        assert.equal(first.classList.contains("b3-menu__item--group-first"), true);
        assert.equal(last.classList.contains("b3-menu__item--group-last"), true);
    });

    it("moves rounded edges when the final action is hidden and restored", () => {
        const first = element("b3-menu__item");
        const last = element("b3-menu__item");
        const container = items(first, last);
        updateMenuItemGroupClasses(container);
        last.classList.add("fn__none");
        updateMenuItemGroupClasses(container);
        assert.equal(first.classList.contains("b3-menu__item--group-last"), true);
        assert.equal(last.classList.contains("b3-menu__item--group-last"), false);
        last.classList.remove("fn__none");
        updateMenuItemGroupClasses(container);
        assert.equal(first.classList.contains("b3-menu__item--group-last"), false);
        assert.equal(last.classList.contains("b3-menu__item--group-last"), true);
    });

    it("preserves separate action groups across separators", () => {
        const first = element("b3-menu__item");
        const second = element("b3-menu__item");
        updateMenuItemGroupClasses(items(first, element("b3-menu__separator"), second));
        for (const item of [first, second]) {
            assert.equal(item.classList.contains("b3-menu__item--group-first"), true);
            assert.equal(item.classList.contains("b3-menu__item--group-last"), true);
        }
    });
});

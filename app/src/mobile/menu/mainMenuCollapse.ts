import {Constants} from "../../constants";
import {setStorageVal} from "../../protyle/util/compatibility";

const getCollapsedGroups = (): string[] => {
    const value = window.siyuan.storage[Constants.LOCAL_MOBILE_MENU_COLLAPSED];
    return Array.isArray(value) ? value.filter(item => typeof item === "string") : [];
};

export const syncMainMenuGroupCollapse = (element: Element, searching: boolean) => {
    const collapsed = getCollapsedGroups();
    element.querySelectorAll<HTMLElement>("[data-menu-group]").forEach(group => {
        const hidden = !searching && collapsed.includes(group.dataset.menuGroup);
        group.querySelector(":scope > .b3-menu__group-items").classList.toggle("fn__none", hidden);
        const button = group.querySelector<HTMLButtonElement>('[data-type="toggle-menu-group"]');
        button.disabled = searching;
        button.setAttribute("aria-expanded", String(!hidden));
        button.setAttribute("aria-label", `${window.siyuan.languages[hidden ? "expand" : "collapse"]} - ${group.querySelector(".b3-menu__group-title > span").textContent}`);
        button.querySelector("use").setAttribute("xlink:href", hidden ? "#iconRight" : "#iconDown");
    });
};

export const toggleMainMenuGroup = (button: HTMLElement) => {
    if (button.hasAttribute("disabled")) {
        return;
    }
    const group = button.closest<HTMLElement>("[data-menu-group]");
    const menu = group?.closest("#menu");
    if (!menu) {
        return;
    }
    const collapsed = new Set(getCollapsedGroups());
    if (collapsed.has(group.dataset.menuGroup)) {
        collapsed.delete(group.dataset.menuGroup);
    } else {
        collapsed.add(group.dataset.menuGroup);
    }
    const value = Array.from(collapsed);
    window.siyuan.storage[Constants.LOCAL_MOBILE_MENU_COLLAPSED] = value;
    setStorageVal(Constants.LOCAL_MOBILE_MENU_COLLAPSED, value);
    syncMainMenuGroupCollapse(menu, false);
};

import {toggleMenu} from "../../menus/menuToggle";
import {bindMenuKeydown} from "../../menus/Menu";
import {setMenuInputCurrent} from "../../menus/menuKeyboard";
import {showMessage} from "../../dialog/message";
import {bazaarConfigApi} from "./runtime";
import {getBazaarTypeByTab} from "./packageConfig";

const FILTER_KEYS = ["hideUnsupportedVersion", "hideIncompatiblePlatform"] as const;

const getFilterType = (button: HTMLElement) =>
    getBazaarTypeByTab(button.closest(".config-bazaar__panel")?.getAttribute("data-type"));

export const closeBazaarFilterMenu = (root: HTMLElement) => {
    const menu = window.siyuan.menus?.menu;
    const target = menu?.data;
    if (target instanceof HTMLElement && target.hasAttribute("data-bazaar-filter-menu") && root?.contains(target)) {
        menu.remove();
    }
};

export const refreshBazaarFilterMenu = (root: HTMLElement) => {
    root.querySelectorAll<HTMLElement>("[data-bazaar-filter-menu]").forEach(button => {
        const type = getFilterType(button);
        const filters = type && window.siyuan.config.bazaar.compatibilityFilters?.[type];
        button.classList.toggle("block__icon--active",
            filters?.hideUnsupportedVersion === true || filters?.hideIncompatiblePlatform === true);
    });
    const menu = window.siyuan.menus?.menu;
    const target = menu?.data;
    if (target instanceof HTMLElement && target.hasAttribute("data-bazaar-filter-menu") && root.contains(target)) {
        const type = getFilterType(target);
        const filters = type && window.siyuan.config.bazaar.compatibilityFilters?.[type];
        if (FILTER_KEYS.some(filter => menu.element.querySelector(`[data-bazaar-filter="${filter}"]`)
            ?.getAttribute("aria-checked") !== String(filters?.[filter] === true))) {
            menu.remove();
        }
    }
};

export const bindBazaarFilterMenu = (root: HTMLElement) => {
    let lastFocusedButton: HTMLButtonElement;
    root.querySelectorAll<HTMLButtonElement>("[data-bazaar-filter-menu]").forEach(button => {
        button.addEventListener("click", event => {
            const type = getFilterType(button);
            if (button.disabled || !type) return;
            lastFocusedButton = button;
            toggleMenu({
                target: button,
                build: menu => {
                    menu.element.classList.add("config-bazaar__filter-menu");
                    const items = menu.element.lastElementChild as HTMLElement;
                    const focusItem = (event: FocusEvent) => setMenuInputCurrent(menu.element, event.target as Element);
                    const keydown = (event: KeyboardEvent) => {
                        if (event.isComposing || event.ctrlKey || event.metaKey || event.altKey) return;
                        if (event.key === "Tab") {
                            menu.remove();
                            return;
                        }
                        if (event.shiftKey) return;
                        if (event.key === "ArrowUp" || event.key === "ArrowDown") {
                            bindMenuKeydown(event);
                            menu.element.querySelector<HTMLButtonElement>(".b3-menu__item--current")?.focus();
                            event.preventDefault();
                            event.stopPropagation();
                        } else if (event.key === " " || event.key === "Enter") {
                            event.stopPropagation();
                        }
                    };
                    menu.removeCB = () => {
                        menu.element.classList.remove("config-bazaar__filter-menu");
                        button.setAttribute("aria-expanded", "false");
                        if (items.contains(document.activeElement) && button.isConnected && !button.disabled) {
                            button.focus();
                        }
                        items.removeEventListener("focusin", focusItem);
                        items.removeEventListener("keydown", keydown);
                        button.removeEventListener("keydown", keydown);
                        items.removeAttribute("role");
                    };
                    items.setAttribute("role", "menu");
                    items.addEventListener("focusin", focusItem);
                    items.addEventListener("keydown", keydown);
                    button.addEventListener("keydown", keydown);
                    FILTER_KEYS.forEach(filter => {
                        const checked = window.siyuan.config.bazaar.compatibilityFilters?.[type]?.[filter] === true;
                        menu.addItem({
                            iconHTML: "",
                            label: window.siyuan.languages[filter === "hideUnsupportedVersion" ?
                                "bazaarHideUnsupportedVersion" : "bazaarHideIncompatiblePlatform"],
                            checked,
                            bind: item => {
                                item.classList.add("b3-menu__item--wrap");
                                item.dataset.bazaarFilter = filter;
                                item.setAttribute("role", "menuitemcheckbox");
                                item.setAttribute("aria-checked", String(checked));
                            },
                            click: async () => {
                                if (button.disabled || !button.isConnected) return;
                                const restoreFocus = document.activeElement === button ||
                                    menu.element.contains(document.activeElement);
                                lastFocusedButton = button;
                                button.disabled = true;
                                try {
                                    await bazaarConfigApi.patch(`compatibilityFilters.${type}.${filter}`, !checked);
                                } catch (error) {
                                    showMessage(error instanceof Error ? error.message : String(error));
                                } finally {
                                    button.disabled = false;
                                    if (restoreFocus && lastFocusedButton === button && button.isConnected &&
                                        document.activeElement === document.body &&
                                        window.siyuan.menus.menu.element.classList.contains("fn__none")) {
                                        button.focus();
                                    }
                                }
                            },
                        });
                    });
                },
                show: menu => {
                    button.setAttribute("aria-expanded", "true");
                    const rect = button.getBoundingClientRect();
                    menu.popup({x: rect.left, y: rect.bottom, h: rect.height, target: button});
                    menu.element.querySelector<HTMLButtonElement>(".b3-menu__item")?.focus();
                },
            });
            event.stopPropagation();
        });
    });
};

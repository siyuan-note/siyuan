import {Menu} from "../../plugin/Menu";
import {escapeHtml} from "../../util/escape";

let activeMenu: Menu | undefined;

export const getMobileSelectMenuElement = () => activeMenu?.element;

const getSelect = (target: EventTarget) => {
    const select = target instanceof Element ? target.closest<HTMLSelectElement>("select.b3-select, select.b3-text-field") : null;
    return select && !select.matches(":disabled") && !select.multiple && select.size <= 1 ? select : undefined;
};

const openSelect = (select: HTMLSelectElement) => {
    activeMenu?.close();
    // 菜单内的选择器使用独立菜单，保留原表单节点及其保存事件。
    const menu = new Menu(undefined, () => {
        if (activeMenu === menu) {
            activeMenu = undefined;
        }
    }, Boolean(select.closest(".b3-menu")));
    const addOption = (option: HTMLOptionElement, groupDisabled = false) => {
        if (option.hidden) {
            return;
        }
        menu.addItem({
            label: escapeHtml(option.label),
            current: option.selected,
            disabled: option.disabled || groupDisabled,
            click: () => {
                if (!select.isConnected || !select.contains(option) || select.matches(":disabled") ||
                    option.disabled || groupDisabled) {
                    return true;
                }
                if (!option.selected) {
                    select.selectedIndex = option.index;
                    select.dispatchEvent(new Event("input", {bubbles: true}));
                    select.dispatchEvent(new Event("change", {bubbles: true}));
                }
                if (activeMenu === menu) {
                    // 复用移动端返回事件，等待菜单收起过渡完成后再清理。
                    menu.element.dispatchEvent(new CustomEvent("click", {detail: "back"}));
                }
                return true;
            },
        });
    };
    Array.from(select.children).forEach(child => {
        if (child instanceof HTMLOptGroupElement) {
            if (child.hidden) {
                return;
            }
            menu.addItem({type: "readonly", label: escapeHtml(child.label)});
            Array.from(child.children).forEach(option => addOption(option as HTMLOptionElement, child.disabled));
        } else if (child instanceof HTMLOptionElement) {
            addOption(child);
        }
    });
    activeMenu = menu;
    const rect = select.getBoundingClientRect();
    menu.open({x: rect.left, y: rect.bottom, h: rect.height, w: rect.width, target: select});
};

export const initMobileSelect = () => {
    document.addEventListener("pointerdown", event => {
        if (getSelect(event.target)) {
            event.preventDefault();
        }
    }, true);
    document.addEventListener("click", event => {
        const select = getSelect(event.target);
        if (!select) {
            return;
        }
        event.preventDefault();
        event.stopImmediatePropagation();
        openSelect(select);
    }, true);
    document.addEventListener("keydown", event => {
        const select = getSelect(event.target);
        if (!select || !["Enter", " ", "ArrowDown", "ArrowUp"].includes(event.key)) {
            return;
        }
        event.preventDefault();
        event.stopImmediatePropagation();
        openSelect(select);
    }, true);
};

import {getAnchoredMenuPosition} from "../menus/menuPosition";

const activeSubmenus = new WeakMap<HTMLElement, () => void>();

export const createMarkdownSubmenu = (options: {
    element: HTMLElement;
    label: string;
    icon: string;
    onClose?(): void;
}) => {
    const {element} = options;
    const events = new AbortController();
    const {signal} = events;
    let disabled = false;
    const children = Array.from(element.childNodes);
    element.className = "b3-menu__item markdown-choice";
    element.tabIndex = 0;
    element.setAttribute("role", "menuitem");
    element.setAttribute("aria-haspopup", "menu");
    element.setAttribute("aria-expanded", "false");
    element.innerHTML = `<svg class="b3-menu__icon" aria-hidden="true"><use href="#${options.icon}"></use></svg><span class="b3-menu__label"></span><svg class="b3-menu__icon b3-menu__icon--small" aria-hidden="true"><use href="#iconRight"></use></svg><div class="b3-menu__submenu markdown-choice__menu" role="menu"></div>`;
    element.querySelector(".b3-menu__label").textContent = options.label;
    const menu = element.querySelector<HTMLElement>(".b3-menu__submenu");
    menu.append(...children);
    const close = () => {
        if (element.parentElement && activeSubmenus.get(element.parentElement) === close) {
            activeSubmenus.delete(element.parentElement);
        }
        element.classList.remove("b3-menu__item--show");
        element.setAttribute("aria-expanded", "false");
        options.onClose?.();
    };
    const open = () => {
        if (disabled) return;
        if (element.parentElement) {
            const previous = activeSubmenus.get(element.parentElement);
            if (previous !== close) previous?.();
            activeSubmenus.set(element.parentElement, close);
        }
        element.classList.add("b3-menu__item--show");
        element.setAttribute("aria-expanded", "true");
        const anchor = element.getBoundingClientRect();
        // 按实际边框盒高度计算可用空间，保留缩放产生的亚像素边框。
        menu.style.maxHeight = "none";
        const bounds = menu.getBoundingClientRect();
        const firstItem = menu.firstElementChild?.getBoundingClientRect();
        const top = Math.max(8, anchor.top - (firstItem ? firstItem.top - bounds.top : 0));
        const position = getAnchoredMenuPosition(top, 0, Math.ceil(bounds.height), innerHeight - 8, 8);
        menu.style.top = `${Math.max(8, position.top)}px`;
        menu.style.maxHeight = `${position.height}px`;
        const parentMenu = element.parentElement?.closest<HTMLElement>(".markdown-choice__menu");
        const parentItem = parentMenu?.parentElement;
        const preferLeft = parentItem && parentMenu.getBoundingClientRect().left < parentItem.getBoundingClientRect().left;
        const fitsLeft = anchor.left - bounds.width >= 8;
        const fitsRight = anchor.right + bounds.width <= innerWidth - 8;
        const left = preferLeft && fitsLeft || !fitsRight ? anchor.left - bounds.width : anchor.right;
        menu.style.left = `${Math.max(8, Math.min(innerWidth - bounds.width - 8, left))}px`;
    };
    element.addEventListener("click", event => {
        if (menu.contains(event.target as Node)) return;
        if (element.getAttribute("aria-expanded") === "true") close(); else open();
    }, {signal});
    element.addEventListener("pointerenter", event => {
        if (event.pointerType !== "mouse") return;
        open();
    }, {signal});
    element.addEventListener("pointerleave", event => {
        if (event.pointerType !== "mouse") return;
        if (menu.contains(document.activeElement)) return;
        close();
    }, {signal});
    element.addEventListener("keydown", event => {
        const buttons = Array.from(menu.children) as HTMLElement[];
        const index = buttons.indexOf(document.activeElement as HTMLElement);
        if (event.key === "ArrowRight" || (event.target === element && ["Enter", " ", "ArrowDown"].includes(event.key))) {
            if (disabled) return;
            open(); (menu.querySelector<HTMLElement>(':scope > [aria-checked="true"]') || buttons[0])?.focus();
        } else if (event.key === "ArrowLeft" || event.key === "Escape") {
            if (event.target === element && element.getAttribute("aria-expanded") !== "true") return;
            close(); element.focus();
        }
        else if (index >= 0 && ["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
            const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 :
                (index + (event.key === "ArrowDown" ? 1 : buttons.length - 1)) % buttons.length;
            buttons[next].focus();
        } else return;
        event.preventDefault(); event.stopPropagation();
    }, {signal});
    document.addEventListener("pointerdown", event => {if (!element.contains(event.target as Node)) close();}, {signal});
    document.addEventListener("focusin", event => {
        if (!element.contains(event.target as Node)) close();
    }, {signal});
    window.addEventListener("resize", close, {signal});
    element.closest(".markdown-menu")?.addEventListener("scroll", close, {signal});
    return {
        menu, close,
        setDisabled(value: boolean) {disabled = value; element.setAttribute("aria-disabled", String(value)); element.tabIndex = value ? -1 : 0; if (value) close();},
        destroy() {close(); events.abort();},
    };
};

export const createMarkdownChoice = (options: {
    element: HTMLElement;
    label: string;
    icon: string;
    values: Array<{value: string; label: string}>;
    value: string;
    onChange(value: string): void;
}) => {
    const submenu = createMarkdownSubmenu(options);
    const events = new AbortController();
    for (const item of options.values) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "b3-menu__item";
        button.dataset.value = item.value;
        button.setAttribute("role", "menuitemradio");
        button.innerHTML = '<svg class="b3-menu__icon" aria-hidden="true"><use href="#iconSelect"></use></svg><span class="b3-menu__label"></span>';
        button.querySelector(".b3-menu__label").textContent = item.label;
        button.addEventListener("click", event => {
            event.stopPropagation();
            if (options.element.getAttribute("aria-disabled") === "true") return;
            submenu.close(); options.onChange(item.value);
        }, {signal: events.signal});
        submenu.menu.append(button);
    }
    const setValue = (value: string) => {
        submenu.menu.querySelectorAll<HTMLButtonElement>("button").forEach(button => {
            const checked = button.dataset.value === value;
            button.setAttribute("aria-checked", String(checked));
            button.classList.toggle("b3-menu__item--selected", checked);
            button.querySelector<SVGElement>("svg").style.visibility = checked ? "visible" : "hidden";
        });
    };
    setValue(options.value);
    return {...submenu, setValue, destroy() {events.abort(); submenu.destroy();}};
};

export type MarkdownChoice = ReturnType<typeof createMarkdownChoice>;

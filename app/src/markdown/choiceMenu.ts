import {getAnchoredMenuPosition} from "../menus/menuPosition";

export const createMarkdownChoice = (options: {
    element: HTMLElement;
    label: string;
    values: Array<{value: string; label: string}>;
    value: string;
    onChange(value: string): void;
}) => {
    const {element} = options;
    const events = new AbortController();
    const {signal} = events;
    let disabled = false;
    element.className = "b3-menu__item markdown-choice";
    element.tabIndex = 0;
    element.setAttribute("role", "menuitem");
    element.setAttribute("aria-haspopup", "menu");
    element.setAttribute("aria-expanded", "false");
    element.innerHTML = '<span class="b3-menu__label"></span><svg class="b3-menu__icon b3-menu__icon--arrow" aria-hidden="true"><use href="#iconRight"></use></svg><div class="b3-menu__submenu markdown-choice__menu" role="menu"></div>';
    element.querySelector(".b3-menu__label").textContent = options.label;
    const menu = element.querySelector<HTMLElement>(".b3-menu__submenu");
    const close = () => {element.classList.remove("b3-menu__item--show"); element.setAttribute("aria-expanded", "false");};
    const setValue = (value: string) => {
        menu.querySelectorAll<HTMLButtonElement>("button").forEach(button => {
            const checked = button.dataset.value === value;
            button.setAttribute("aria-checked", String(checked));
            button.classList.toggle("b3-menu__item--selected", checked);
            button.querySelector<SVGElement>("svg").style.visibility = checked ? "visible" : "hidden";
        });
    };
    const open = () => {
        if (disabled) return;
        element.classList.add("b3-menu__item--show");
        element.setAttribute("aria-expanded", "true");
        const anchor = element.getBoundingClientRect();
        const bounds = menu.getBoundingClientRect();
        const position = getAnchoredMenuPosition(anchor.top, 0, menu.scrollHeight, innerHeight - 8, 8);
        menu.style.top = `${Math.max(8, position.top)}px`;
        menu.style.maxHeight = `${position.height}px`;
        const right = anchor.right;
        const left = right + bounds.width <= innerWidth - 8 ? right : anchor.left - bounds.width;
        menu.style.left = `${Math.max(8, Math.min(innerWidth - bounds.width - 8, left))}px`;
    };
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
            if (disabled) return;
            close(); options.onChange(item.value);
        }, {signal});
        menu.append(button);
    }
    element.addEventListener("click", event => {
        if (menu.contains(event.target as Node)) return;
        if (element.getAttribute("aria-expanded") === "true") close(); else open();
    }, {signal});
    element.addEventListener("pointerenter", event => {if (event.pointerType === "mouse") open();}, {signal});
    element.addEventListener("pointerleave", event => {if (event.pointerType === "mouse") close();}, {signal});
    element.addEventListener("keydown", event => {
        const buttons = Array.from(menu.querySelectorAll<HTMLButtonElement>("button"));
        const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
        if (event.key === "ArrowRight" || (event.target === element && ["Enter", " ", "ArrowDown"].includes(event.key))) {
            open(); (menu.querySelector<HTMLButtonElement>('[aria-checked="true"]') || buttons[0]).focus();
        } else if (event.key === "ArrowLeft" || event.key === "Escape") {close(); element.focus();}
        else if (index >= 0 && ["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
            const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 :
                (index + (event.key === "ArrowDown" ? 1 : buttons.length - 1)) % buttons.length;
            buttons[next].focus();
        } else return;
        event.preventDefault(); event.stopPropagation();
    }, {signal});
    document.addEventListener("pointerdown", event => {if (!element.contains(event.target as Node)) close();}, {signal});
    document.addEventListener("focusin", event => {if (!element.contains(event.target as Node)) close();}, {signal});
    window.addEventListener("resize", close, {signal});
    element.closest(".markdown-menu")?.addEventListener("scroll", close, {signal});
    setValue(options.value);
    return {
        setValue, close,
        setDisabled(value: boolean) {disabled = value; element.setAttribute("aria-disabled", String(value)); element.tabIndex = value ? -1 : 0; if (value) close();},
        destroy() {events.abort();},
    };
};

export type MarkdownChoice = ReturnType<typeof createMarkdownChoice>;

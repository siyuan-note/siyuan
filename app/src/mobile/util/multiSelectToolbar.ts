export const insertMobileMultiSelectMenu = (itemsElement: Element, menuItem: HTMLElement) => {
    const openInNewTab = Array.from(itemsElement.children).find(item => item.getAttribute("data-id") === "openInNewTab");
    if (openInNewTab) {
        openInNewTab.after(menuItem);
    } else {
        itemsElement.prepend(menuItem);
    }
};

export const updateMultiSelectToolbar = (element: HTMLElement, count: number) => {
    element.querySelector(".multiSelectCount").textContent = count.toString();
    (element.querySelector('[data-type="menu"]') as HTMLButtonElement).disabled = count === 0;
};

export const renderMultiSelectToolbar = (element: HTMLElement, count: number, onMenu: () => void, onExit: () => void,
                                        onSelectAll?: () => void) => {
    element.style.padding = "0";
    element.innerHTML = `<div class="block__icons">
    <div class="block__logo">
        <svg class="block__logoicon"><use xlink:href="#iconCheck"></use></svg>
        <span class="multiSelectCount"></span>
    </div>
    <span class="fn__flex-1"></span>
    ${onSelectAll ? `<button class="block__icon block__icon--show" data-type="selectAll" aria-label="${window.siyuan.languages.selectAll}"><svg><use xlink:href="#iconSelectAll"></use></svg></button><span class="fn__space"></span>` : ""}
    <button class="block__icon block__icon--show" data-type="menu" data-menu="true" aria-label="${window.siyuan.languages.more}"><svg><use xlink:href="#iconMore"></use></svg></button>
    <span class="fn__space"></span>
    <button class="block__icon block__icon--show" data-type="exitMultiSelectMode" aria-label="${window.siyuan.languages.close}"><svg><use xlink:href="#iconClose"></use></svg></button>
</div>`;
    updateMultiSelectToolbar(element, count);
    element.firstElementChild.addEventListener("click", (event) => {
        const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button[data-type]");
        if (button && !button.disabled) {
            if (button.dataset.type === "menu") {
                onMenu();
            } else if (button.dataset.type === "exitMultiSelectMode") {
                onExit();
            } else if (button.dataset.type === "selectAll") {
                onSelectAll?.();
            }
        }
        event.preventDefault();
        event.stopPropagation();
    });
};

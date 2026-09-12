export const bindSearchSubtypeFilters = (element: HTMLElement) => {
    ["heading", "list", "listItem"].forEach((group) => {
        const parent = element.querySelector<HTMLInputElement>(`input[data-type="${group}"]`);
        const children = Array.from(element.querySelectorAll<HTMLInputElement>(`input[data-group="${group}"]`));
        // 未限制子类型时全选该组，使父类型与子类型的显示保持一致。
        const unrestricted = !children.some((child) => child.checked);
        children.forEach((child) => {
            child.checked = parent.checked && (unrestricted || child.checked);
            child.addEventListener("change", () => {
                parent.checked = children.some((input) => input.checked);
            });
        });
        parent.addEventListener("change", () => {
            children.forEach((child) => {
                child.checked = parent.checked;
            });
        });
    });
};

export const updateNotebookRootForBoxDoc = (
    rootElement: HTMLElement,
    notebook: Pick<INotebook, "id" | "subFileCount">,
    enabled: boolean,
) => {
    const subFileCount = notebook.subFileCount || 0;
    rootElement.setAttribute("data-node-id", enabled ? notebook.id : "");
    rootElement.setAttribute("data-count", subFileCount.toString());
    const toggleElement = rootElement.querySelector<HTMLElement>(".b3-list-item__toggle");
    const hideToggle = enabled && subFileCount === 0;
    toggleElement?.classList.toggle("fn__hidden", hideToggle);
    if (hideToggle) {
        toggleElement?.querySelector(".b3-list-item__arrow")?.classList.remove("b3-list-item__arrow--open");
        if (rootElement.nextElementSibling?.tagName === "UL") {
            rootElement.nextElementSibling.remove();
        }
    }
    return subFileCount;
};

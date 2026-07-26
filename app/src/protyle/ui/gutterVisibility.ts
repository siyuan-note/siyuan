export const hideGutterElements = (elements: HTMLElement[], hidden: boolean) => {
    elements.forEach(item => {
        if (hidden) {
            item.classList.add("fn__none");
        }
        item.innerHTML = "";
    });
};

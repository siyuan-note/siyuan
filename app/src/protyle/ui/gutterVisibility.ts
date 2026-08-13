export const hideGutterElements = (elements: HTMLElement[], hidden: boolean) => {
    elements.forEach(item => {
        if (hidden) {
            item.classList.add("fn__none");
        }
        item.innerHTML = "";
    });
};

export const shouldHideGutterAfterFold = (foldStatus: number) => foldStatus !== 0;

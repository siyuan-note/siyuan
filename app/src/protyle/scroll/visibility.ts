export const updateScrollVisibility = (parentElement: HTMLElement, barElement: HTMLElement, visible: boolean) => {
    parentElement.classList.toggle("fn__none", !visible);
    barElement.classList.toggle("fn__none", !visible);
};

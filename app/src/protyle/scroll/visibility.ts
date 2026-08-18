export const updateScrollVisibility = (
    parentElement: HTMLElement,
    barElement: HTMLElement,
    containerVisible: boolean,
    barVisible: boolean,
) => {
    parentElement.classList.toggle("fn__none", !containerVisible);
    barElement.classList.toggle("fn__none", !barVisible);
};

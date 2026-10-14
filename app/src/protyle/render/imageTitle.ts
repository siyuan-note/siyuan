export const getImageTitle = (image: HTMLImageElement) =>
    image.getAttribute("data-title") ?? image.getAttribute("title") ?? "";

export const setImageTitle = (image: HTMLImageElement, title: string) => {
    if (title) {
        image.setAttribute("data-title", title);
    } else {
        image.removeAttribute("data-title");
    }
    image.removeAttribute("title");
};

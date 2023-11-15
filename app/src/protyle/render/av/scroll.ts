import {stickyScrollY} from "../../scroll/stickyScroll";

export const avScroll = (
    contentElement: HTMLElement,
    nodeElement: HTMLElement,
) => {
    const bodyElement = nodeElement.querySelector(".av__body") as HTMLElement;

    if (bodyElement) {
        const headerElement = bodyElement.querySelector(".av__row--header") as HTMLElement;
        const footerElement = bodyElement.querySelector(".av__row--footer") as HTMLElement;

        stickyScrollY(
            contentElement,
            bodyElement,
            headerElement ? [{element: headerElement}] : [],
            footerElement ? [{element: footerElement}] : [],
        );
    }
}

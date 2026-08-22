export interface IEmbedRenderLoadingState {
    rotateElement: Element | null;
    height?: string;
}

export const finishEmptyEmbedRender = (item: HTMLElement, onEmbedRender?: () => void) => {
    item.querySelector(":scope > .protyle-icons .protyle-action__reload .fn__rotate")?.classList.remove("fn__rotate");
    Array.from(item.children).forEach(child => {
        if (!child.classList.contains("protyle-icons") && !child.classList.contains("protyle-cursor") &&
            !child.classList.contains("protyle-attr")) {
            child.remove();
        }
    });
    item.style.height = "";
    onEmbedRender?.();
};

export const finishCustomEmbedRender = (item: HTMLElement, loadingState: IEmbedRenderLoadingState,
                                        onEmbedRender?: () => void) => {
    loadingState.rotateElement?.classList.remove("fn__rotate");
    if (loadingState.height !== undefined && item.style.height === loadingState.height) {
        item.style.height = "";
    }
    onEmbedRender?.();
};

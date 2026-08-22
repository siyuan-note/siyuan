export interface IEmbedRenderLoadingState {
    rotateElement: Element | null;
    height?: string;
}

export const finishCustomEmbedRender = (item: HTMLElement, loadingState: IEmbedRenderLoadingState,
                                        onEmbedRender?: () => void) => {
    loadingState.rotateElement?.classList.remove("fn__rotate");
    if (loadingState.height !== undefined && item.style.height === loadingState.height) {
        item.style.height = "";
    }
    onEmbedRender?.();
};

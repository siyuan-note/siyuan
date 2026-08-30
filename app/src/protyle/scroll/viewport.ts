interface IViewportBlock {
    id: string | null;
    top: number;
    bottom: number;
}

export const getVisibleRootBlockID = (blocks: IViewportBlock[], viewportTop: number, viewportBottom: number) => {
    return blocks.find((block) => block.id && block.bottom > viewportTop && block.top < viewportBottom)?.id;
};

export const isScrolledToBottom = (scrollTop: number, scrollHeight: number, clientHeight: number) => {
    return scrollHeight - scrollTop - clientHeight <= 1;
};

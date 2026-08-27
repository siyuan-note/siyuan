export interface IUploadInsertPosition {
    range: Range;
    startContainer: Node;
    endContainer: Node;
    context?: Record<string, string>;
}

export const createUploadInsertPosition = (range: Range, context?: Record<string, string>): IUploadInsertPosition => {
    const insertRange = range.cloneRange();
    return {
        range: insertRange,
        startContainer: insertRange.startContainer,
        endContainer: insertRange.endContainer,
        context,
    };
};

export const isUploadInsertPositionAvailable = (editorElement: Element, position?: IUploadInsertPosition) => {
    return editorElement.isConnected && !!position &&
        editorElement.contains(position.startContainer) &&
        editorElement.contains(position.endContainer) &&
        editorElement.contains(position.range.startContainer) &&
        editorElement.contains(position.range.endContainer);
};

export const getAvailableUploadInsertRange = (editorElement: Element, position?: IUploadInsertPosition) => {
    if (isUploadInsertPositionAvailable(editorElement, position)) {
        return position.range.cloneRange();
    }
};

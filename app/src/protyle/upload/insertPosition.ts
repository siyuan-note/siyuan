export interface IUploadDocument {
    rootID: string;
    notebookID: string;
}

export const captureUploadDocument = (protyle: IProtyle): IUploadDocument => ({
    rootID: protyle.block?.rootID,
    notebookID: protyle.notebookId,
});

export const isUploadDocumentAvailable = (protyle: IProtyle, target: IUploadDocument) => {
    return protyle.element.isConnected && target?.rootID === protyle.block?.rootID &&
        target?.notebookID === protyle.notebookId;
};

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

export const getAvailableUploadInsertRange = (editorElement: Element, position?: IUploadInsertPosition,
                                             restore?: (context: Record<string, string>) => Range | undefined) => {
    if (isUploadInsertPositionAvailable(editorElement, position)) {
        return position.range.cloneRange();
    }
    if (editorElement.isConnected && position?.context && restore) {
        return restore(position.context);
    }
};

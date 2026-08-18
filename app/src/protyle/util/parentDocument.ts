export const getParentDocumentID = (options: {
    path: string,
    notebookID: string,
    rootID: string,
    boxDocEnabled: boolean,
}) => {
    const ids = options.path.split("/");
    if (ids.length > 2) {
        return ids[ids.length - 2];
    }
    if (options.boxDocEnabled && options.rootID !== options.notebookID) {
        return options.notebookID;
    }
};

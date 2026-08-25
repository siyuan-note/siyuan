export const getLastDailyNoteNotebookId = (
    notebooks: readonly {id: string, closed: boolean}[],
    storedNotebookId: unknown,
) => {
    if (typeof storedNotebookId !== "string" || !storedNotebookId) {
        return undefined;
    }
    return notebooks.some(item => item.id === storedNotebookId && !item.closed) ? storedNotebookId : undefined;
};

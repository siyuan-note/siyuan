export interface CreateTargetContext {
    notebookId: string;
    path: string;
}

export const getCreateTargetContext = (protyle: Pick<IProtyle, "notebookId" | "path">): CreateTargetContext => ({
    notebookId: protyle.notebookId || "",
    path: protyle.path || "",
});

export const isSameCreateTargetContext = (
    context: CreateTargetContext,
    protyle: Pick<IProtyle, "notebookId" | "path">,
) => {
    const current = getCreateTargetContext(protyle);
    return context.notebookId === current.notebookId && context.path === current.path;
};

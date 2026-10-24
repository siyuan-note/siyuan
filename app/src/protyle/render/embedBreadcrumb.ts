export const resolveEmbedBreadcrumbPreference = (value: string | null, fallback: boolean) =>
    value === "true" ? true : value === "false" ? false : fallback;

export const getEmbedBreadcrumbPaths = (paths: IBreadcrumb[], rootID: string, parentPath: boolean) => {
    if (parentPath || !rootID) {
        return paths;
    }
    const documentIndex = paths.findIndex(item => item.id === rootID);
    // 不完整的历史响应保留已有上下文，文档标题使用独立字段以保留标题中的斜杠。
    if (documentIndex < 0) return paths;
    const result = paths.slice(documentIndex);
    if (typeof result[0].documentTitle === "string") {
        result[0] = {...result[0], name: result[0].documentTitle};
    }
    return result;
};

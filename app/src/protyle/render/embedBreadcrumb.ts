export const EMBED_BREADCRUMB_PARENT_PATH = "custom-sy-embed-breadcrumb-parent-path";

export const getEmbedBreadcrumbPaths = (paths: IBreadcrumb[], rootID: string, parentPath: string | null) => {
    if (parentPath !== "false" || !rootID) {
        return paths;
    }
    const documentIndex = paths.findIndex(item => item.id === rootID);
    // Preserve legacy or incomplete responses instead of dropping their available context.
    return documentIndex < 0 ? paths : paths.slice(documentIndex);
};

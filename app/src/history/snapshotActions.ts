const actions: Record<string, {icon: string, label: string}> = {
    downloadSnapshot: {icon: "Download", label: "download"},
    downloadRollback: {icon: "Undo", label: "downloadRollback"},
    removeCloudRepoTagSnapshot: {icon: "Trashcan", label: "remove"},
    uploadSnapshot: {icon: "Upload", label: "upload"},
    rollback: {icon: "Undo", label: "rollback"},
    removeRepoTagSnapshot: {icon: "Trashcan", label: "remove"},
    genTag: {icon: "Tag", label: "tagSnapshot"},
    editSnapshotMemo: {icon: "Edit", label: "editSnapshotMemo"},
};

const snapshotActions: Record<string, string[]> = {
    getCloudRepoTagSnapshots: ["downloadSnapshot", "downloadRollback", "removeCloudRepoTagSnapshot"],
    getCloudRepoSnapshots: ["downloadSnapshot", "downloadRollback"],
    getRepoTagSnapshots: ["uploadSnapshot", "rollback", "removeRepoTagSnapshot"],
    getRepoSnapshots: ["genTag", "rollback"],
};

export const renderSnapshotActions = (type: string, languages: Record<string, string>, mobile: boolean, readonly: boolean) => {
    const entries = [...(snapshotActions[type] || [])];
    if (["getRepoTagSnapshots", "getRepoSnapshots"].includes(type) && !readonly) {
        entries.unshift("editSnapshotMemo");
    }
    return entries.map(id => {
        const {icon, label} = actions[id];
        const tooltip = !mobile || id === "editSnapshotMemo";
        const menuAction = mobile && !["rollback", "downloadRollback"].includes(id);
        return `<span class="b3-list-item__action${menuAction ? " history__snapshot-menu-action" : ""}${tooltip ? " b3-tooltips b3-tooltips__w" : ""}" data-type="${id}"${tooltip ? ` aria-label="${languages[label]}"` : ""}><svg><use xlink:href="#icon${icon}"></use></svg>${tooltip ? "" : `<span class="fn__space"></span>${languages[label]}`}</span>`;
    }).join("\n");
};

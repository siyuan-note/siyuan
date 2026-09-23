const windowWorkspaceCommands = Object.freeze({
    SET: "setWindowWorkspace",
    FOCUS: "focusWindowWorkspace",
    GET_OPEN: "getOpenWindowWorkspaces",
    FLUSH_ALL: "flushWindowWorkspaces",
    FLUSH: "flushWindowWorkspace",
});

const windowWorkspaceSavedChannel = "siyuan-window-workspace-saved";

module.exports = {windowWorkspaceCommands, windowWorkspaceSavedChannel};

const {contextBridge, ipcRenderer, webUtils} = require("electron");

const invoke = (action, payload) => ipcRenderer.invoke("siyuan-markdown:request", action, payload);
const host = {};
for (const method of ["read", "write", "reconcileWrite", "reserveSaveAs", "prepareSaveAs", "commitSaveAs",
    "releaseSaveAs", "putDraft", "clearDraft", "releaseSession"]) {
    host[method] = request => invoke("host:" + method, request);
}
contextBridge.exposeInMainWorld("siyuanMarkdown", Object.freeze({
    window: Object.freeze({
        state: () => invoke("window-state"),
        control: action => invoke("window-control", action),
        overlay: style => invoke("window-overlay", style),
    }),
    host: Object.freeze(host),
    tree: Object.freeze({
        state: () => invoke("tree-state"),
        list: location => invoke("tree-list", location),
        chooseRoot: () => invoke("tree-choose-root"),
        saveView: view => invoke("tree-save-view", view),
        prepareOpen: location => invoke("tree-prepare-open", location),
        commitOpen: ticket => invoke("tree-commit-open", ticket),
        cancelOpen: ticket => invoke("tree-cancel-open", ticket),
    }),
    bootstrap: () => invoke("bootstrap"),
    newDocument: () => invoke("new"),
    openDocument: () => invoke("open"),
    chooseSaveAs: format => invoke("save-as", format),
    cancelSaveAs: handle => invoke("cancel-save-as", handle),
    authorizeResources: () => invoke("authorize-resources"),
    insertImage: () => invoke("insert-image"),
    resolveResource: reference => invoke("resource", reference),
    openLink: url => invoke("link", url),
    preferences: patch => invoke("preferences", patch),
    confirm: action => invoke("confirm", action),
    confirmClose: () => invoke("confirm-close"),
    recoveries: () => invoke("recoveries"),
    recover: id => invoke("recover", id),
    discardRecovery: id => invoke("discard-recovery", id),
    state: state => invoke("state", state),
    respond: (id, accepted) => invoke("response", {id, accepted}),
    onCommand(listener) {
        const callback = (_event, command) => listener(command);
        ipcRenderer.on("siyuan-markdown:command", callback);
        return () => ipcRenderer.removeListener("siyuan-markdown:command", callback);
    },
}));

// 只有真实系统拖放的 File 才能由 Electron 提取路径，普通脚本构造的文件没有路径权限。
window.addEventListener("dragover", event => {
    if (event.dataTransfer?.types.includes("Files")) event.preventDefault();
}, true);
window.addEventListener("drop", event => {
    if (!event.dataTransfer?.files.length) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const files = [...event.dataTransfer.files].map(file => webUtils.getPathForFile(file))
        .filter(file => /\.(md|markdown)$/i.test(file));
    if (files.length) invoke("drop", files).catch(() => undefined);
}, true);

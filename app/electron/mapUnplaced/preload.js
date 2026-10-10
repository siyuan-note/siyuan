const {contextBridge, ipcRenderer} = require("electron");
const CHANNEL = "siyuan-map-unplaced-menu";
const sessionID = process.argv.find(value => value.startsWith("--unplaced-session="))?.slice(19);
let revision = 0, subscribed = false, listener, themeListener;
const send = (type, data = {}) => {
    if (/^[a-f0-9]{48}$/.test(sessionID)) ipcRenderer.send(CHANNEL + "-action", {sessionID, revision, type, ...data});
};
ipcRenderer.on(CHANNEL + "-state", (_event, value) => {
    if (value?.sessionID !== sessionID || !Number.isSafeInteger(value.state?.revision) || value.state.revision < revision) return;
    revision = value.state.revision;
    listener?.(value.state);
});
ipcRenderer.on(CHANNEL + "-theme", (_event, value) => {
    if (value?.sessionID !== sessionID || !["light", "dark"].includes(value.theme?.mode) ||
        !Number.isInteger(value.theme.fontSize) || value.theme.fontSize < 12 || value.theme.fontSize > 32) return;
    themeListener?.({mode: value.theme.mode, fontSize: value.theme.fontSize});
});
contextBridge.exposeInMainWorld("unplacedMenu", Object.freeze({
    subscribe(callback, onTheme) {
        if (subscribed || typeof callback !== "function") return;
        subscribed = true;
        listener = callback;
        if (typeof onTheme === "function") themeListener = onTheme;
        send("ready");
    },
    search(query) { if (typeof query === "string" && query.length <= 256) send("search", {query}); },
    editing() { send("editing"); },
    more() { send("more"); },
    previous() { send("previous"); },
    retry() { send("retry"); },
    select(id) { if (typeof id === "string" && id.length <= 128) send("select", {id}); },
    close(reason) { if (["escape", "button"].includes(reason)) send("close", {reason}); },
}));

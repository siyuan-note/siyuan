const {contextBridge, ipcRenderer} = require("electron");
const CHANNEL = "siyuan-unplaced-fixture";
const sessionID = process.argv.find(value => value.startsWith("--unplaced-session="))?.slice(19);
let revision = 0, subscribed = false, listener;
const send = (type, data = {}) => {
    if (/^[a-f0-9]{48}$/.test(sessionID)) ipcRenderer.send(CHANNEL + "-action", {sessionID, revision, type, ...data});
};
ipcRenderer.on(CHANNEL + "-state", (_event, value) => {
    if (value?.sessionID !== sessionID || !Number.isSafeInteger(value.state?.revision) || value.state.revision < revision) return;
    revision = value.state.revision;
    listener?.(value.state);
});
contextBridge.exposeInMainWorld("unplacedMenu", Object.freeze({
    subscribe(callback) {
        if (subscribed || typeof callback !== "function") return;
        subscribed = true;
        listener = callback;
        send("ready");
    },
    search(query) { if (typeof query === "string" && query.length <= 256) send("search", {query}); },
    editing() { send("editing"); },
    more() { send("more"); },
    select(id) { if (typeof id === "string" && id.length <= 128) send("select", {id}); },
    close(reason) { if (["escape", "button"].includes(reason)) send("close", {reason}); },
}));

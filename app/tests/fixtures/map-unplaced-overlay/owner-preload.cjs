const {contextBridge, ipcRenderer} = require("electron");
const PREFIX = "unplaced-fixture-owner-";
contextBridge.exposeInMainWorld("fixtureOwner", Object.freeze({
    open(value) { return ipcRenderer.invoke(PREFIX + "open", value); },
    update(value) { ipcRenderer.send(PREFIX + "update", value); },
    anchor(value) { ipcRenderer.send(PREFIX + "anchor", value); },
    theme(value) { ipcRenderer.send(PREFIX + "theme", value); },
    close(value) { ipcRenderer.send(PREFIX + "close", value); },
    zoom() { ipcRenderer.send(PREFIX + "zoom"); },
    permission() { ipcRenderer.send(PREFIX + "permission"); },
    subscribe(callback) {
        if (typeof callback === "function") ipcRenderer.on(PREFIX + "event", (_event, value) => callback(value));
    },
}));

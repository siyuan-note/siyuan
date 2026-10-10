const {ipcRenderer} = require("electron");
const menu = document.getElementById("menu");
const status = document.getElementById("status");
window.ownerFixture = {ready: 0, menuActions: 0, errors: [], replies: [], changes: 0, dismissals: 0};
window.setFixtureMenu = open => { menu.hidden = !open; };
document.getElementById("toggle-menu").addEventListener("click", () => window.setFixtureMenu(menu.hidden));
document.getElementById("menu-action").addEventListener("click", () => { window.ownerFixture.menuActions++; });
document.getElementById("menu-input").addEventListener("input", () => { window.ownerFixture.changes++; });
document.addEventListener("keydown", event => {
    if (event.key === "Escape" && !event.isComposing) window.setFixtureMenu(false);
});
document.addEventListener("pointerdown", event => {
    if (!menu.contains(event.target) && event.target.id !== "toggle-menu") window.setFixtureMenu(false);
});
let instanceID, mode;
const envelope = () => ({version: 1, instanceID});
const send = value => ipcRenderer.send("siyuan-map-command", {...envelope(), ...value});
const report = value => ipcRenderer.send("map-webview-fixture-state", {...envelope(), ...value});
const fail = code => {
    window.ownerFixture.errors.push(code);
    status.textContent = "Map failed: " + code;
    report({type: "error", code});
};
ipcRenderer.once("map-webview-fixture-start", async (_event, settings) => {
    instanceID = settings.instanceID;
    mode = settings.mode;
    try {
        const response = await ipcRenderer.invoke("siyuan-map-create", {...envelope(), provider: "openfreemap", theme: "light"});
        if (response?.version !== 1 || response.instanceID !== instanceID || response.mode !== "webview" || response.error) {
            fail(response?.error || "hostCreateInvalidResponse");
            return;
        }
        const guest = document.createElement("webview");
        guest.id = "map-guest";
        guest.setAttribute("partition", response.partition);
        guest.setAttribute("src", response.src);
        report({type: "attached", src: response.src, partition: response.partition});
        document.getElementById("map-slot").appendChild(guest);
        window.fixtureGuest = guest;
        status.textContent = mode === "real" ? "Loading real OpenFreeMap..." : "Loading synthetic boundary adapter...";
    } catch (_error) { fail("hostCreateRejected"); }
});
ipcRenderer.on("siyuan-map-reply", (_event, value) => {
    if (value?.version !== 1 || value.instanceID !== instanceID) return;
    if (value.type === "ready") {
        window.ownerFixture.ready++;
        send({type: "setPoints", revision: 1, points: [{id: "synthetic-row-1", longitude: 121.4737, latitude: 31.2304},
            {id: "synthetic-row-2", longitude: 121.5037, latitude: 31.2404}]});
        send({type: "visibility", visible: true, viewport: {x: 0, y: 0, width: 720, height: 360}});
        status.textContent = mode === "real" ? "Real OpenFreeMap ready" : "Synthetic boundary adapter ready";
        report({type: "ready"});
    } else if (value.type === "dismissMenu" && window.ownerFixture.ready) {
        window.ownerFixture.dismissals++;
        window.setFixtureMenu(false);
    } else if (value.type === "error") fail(value.code);
    else if (value.type === "markerClick") {
        window.ownerFixture.replies.push(value);
        report(value);
    }
});
window.addEventListener("pagehide", () => ipcRenderer.send("siyuan-map-destroy", envelope()), {once: true});

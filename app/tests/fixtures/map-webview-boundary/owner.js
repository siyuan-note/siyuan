const {ipcRenderer} = require("electron");
const menu = document.getElementById("menu");
const status = document.getElementById("status");
window.ownerFixture = {ready: 0, menuActions: 0, errors: [], replies: [], changes: 0};
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
ipcRenderer.once("map-webview-fixture-start", (_event, settings) => {
    const guest = document.createElement("webview");
    guest.id = "map-guest";
    guest.setAttribute("partition", settings.partition);
    guest.setAttribute("src", settings.src);
    document.getElementById("map-slot").appendChild(guest);
    window.fixtureGuest = guest;
    status.textContent = settings.mode === "real" ? "Loading real OpenFreeMap..." : "Loading synthetic boundary adapter...";
});
ipcRenderer.on("map-webview-fixture-state", (_event, value) => {
    if (value.type === "ready") {
        window.ownerFixture.ready++;
        status.textContent = value.mode === "real" ? "Real OpenFreeMap ready" : "Synthetic boundary adapter ready";
    } else if (value.type === "error") {
        window.ownerFixture.errors.push(value.code);
        status.textContent = "Map failed: " + value.code;
    } else window.ownerFixture.replies.push(value);
});

(() => {
    if (location.pathname.endsWith("/boot.html") && !new URLSearchParams(location.search).has("remote")) {
        return;
    }
    const {ipcRenderer} = require("electron");
    const fs = require("node:fs");
    const path = require("node:path");
    const button = document.createElement("button");
    button.type = "button";
    button.className = "b3-button";
    const langSelect = document.querySelector(".lang");
    const language = () => langSelect?.value || new URLSearchParams(location.search).get("lang") || "en";
    const update = () => {
        let lang = language();
        if (!/^[a-z]{2}(?:-[A-Z]{2})?$/.test(lang)) {
            lang = "en";
        }
        try {
            button.textContent = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "appearance", "langs", lang + ".json"),
                "utf8")).connectRemoteKernel;
        } catch (error) {
            button.textContent = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "appearance", "langs", "en.json"),
                "utf8")).connectRemoteKernel;
        }
    };
    button.style.cssText = "position:fixed;bottom:16px;right:16px;z-index:1000;-webkit-app-region:no-drag;width:auto";
    button.addEventListener("click", () => ipcRenderer.send("siyuan-manage-connections", {lang: language()}));
    langSelect?.addEventListener("change", update);
    update();
    document.body.append(button);
})();

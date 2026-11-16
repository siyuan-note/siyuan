(() => {
    const params = new URLSearchParams(location.search);
    if (location.pathname.endsWith("/boot.html") && !params.has("remote")) {
        return;
    }
    const {ipcRenderer} = require("electron");
    const languages = require("./window-languages.json");
    const crashActions = params.get("crash") === "1" ? document.querySelector(".crash-actions") : null;
    const inlineButton = crashActions ? null : document.getElementById("remoteKernelConnect");
    const button = inlineButton || document.createElement("button");
    if (!inlineButton) {
        button.type = "button";
        button.className = "b3-button";
        if (crashActions) {
            button.classList.add("b3-button--outline");
            crashActions.append(button);
        } else {
            button.style.cssText = "position:fixed;bottom:16px;right:16px;z-index:1000;-webkit-app-region:no-drag;width:auto";
            document.body.append(button);
        }
    }
    const langSelect = document.querySelector(".lang");
    const language = () => langSelect?.value || params.get("lang") || "en";
    const update = () => {
        let lang = language();
        if (!/^[a-z]{2}(?:-[A-Z]{2})?$/.test(lang)) {
            lang = "en";
        }
        const labels = languages[lang] || languages.en;
        button.textContent = inlineButton ? labels.connect : labels.connectRemoteKernel;
    };
    button.addEventListener("click", () => ipcRenderer.send("siyuan-manage-connections", {lang: language()}));
    langSelect?.addEventListener("change", update);
    update();
})();

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
    // 安装包的页面位于资源目录的 app/electron 下，语言文件位于资源目录的 appearance 下；源码运行时两者都位于 app 下。
    const languageDir = [path.join(__dirname, "..", "..", "appearance", "langs"),
        path.join(__dirname, "..", "appearance", "langs")].find(dir => fs.existsSync(dir));
    const language = () => langSelect?.value || new URLSearchParams(location.search).get("lang") || "en";
    const update = () => {
        let lang = language();
        if (!/^[a-z]{2}(?:-[A-Z]{2})?$/.test(lang)) {
            lang = "en";
        }
        try {
            button.textContent = JSON.parse(fs.readFileSync(path.join(languageDir, lang + ".json"),
                "utf8")).connectRemoteKernel;
        } catch (error) {
            button.textContent = JSON.parse(fs.readFileSync(path.join(languageDir, "en.json"),
                "utf8")).connectRemoteKernel;
        }
    };
    button.addEventListener("click", () => ipcRenderer.send("siyuan-manage-connections", {lang: language()}));
    langSelect?.addEventListener("change", update);
    update();
    const crashActions = new URLSearchParams(location.search).get("crash") === "1" ?
        document.querySelector(".crash-actions") : null;
    if (crashActions) {
        button.classList.add("b3-button--outline");
        crashActions.append(button);
    } else {
        button.style.cssText = "position:fixed;bottom:16px;right:16px;z-index:1000;-webkit-app-region:no-drag;width:auto";
        document.body.append(button);
    }
})();

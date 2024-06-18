/// #if !BROWSER
import {shell} from "electron";
import * as path from "path";
/// #endif
import {Constants} from "../constants";
import {exportLayout, resetLayout} from "../layout/util";
import {isBrowser} from "../util/functions";
import {fetchPost} from "../util/fetch";
import {genLangOptions, genOptions} from "../util/genOptions";
import {openSnippets} from "./util/snippets";
import {loadAssets} from "../util/assets";
import {resetFloatDockSize} from "../layout/dock/util";
import {confirmDialog} from "../dialog/confirmDialog";

export const appearance = {
    element: undefined as Element,
    genHTML: () => {
        return `<div class="fn__flex b3-label config__item">
    <div class="fn__flex-1">
        ${window.siyuan.languages.appearance4}
        <div class="b3-label__text">${window.siyuan.languages.appearance5}</div>
    </div>
    <span class="fn__space"></span>
    <select class="b3-select fn__flex-center fn__size200" id="mode">
      <option value="0" ${(window.siyuan.config.appearance.mode === 0 && !window.siyuan.config.appearance.modeOS) ? "selected" : ""}>${window.siyuan.languages.themeLight}</option>
      <option value="1" ${(window.siyuan.config.appearance.mode === 1 && !window.siyuan.config.appearance.modeOS) ? "selected" : ""}>${window.siyuan.languages.themeDark}</option>
      <option value="2" ${window.siyuan.config.appearance.modeOS ? "selected" : ""}>${window.siyuan.languages.themeOS}</option>
    </select>
</div>
<div class="b3-label">
    <div class="fn__flex">
        <div class="fn__flex-center">${window.siyuan.languages.theme}</div>
        <span class="fn__space"></span>
        <a href="javascript:void(0)" ${isBrowser() ? " class='fn__none'" : ""} id="appearanceOpenTheme" class="fn__flex-center">${window.siyuan.languages.appearance9}</a>
    </div>
    <div class="fn__hr"></div>
    <div class="fn__flex config__item">
        <div class="fn__flex-center fn__flex-1 ft__on-surface">
            ${window.siyuan.languages.theme11}
        </div>
        <span class="fn__space"></span>
        <select class="b3-select fn__flex-center fn__size200" id="themeLight">
          ${genOptions(window.siyuan.config.appearance.lightThemes, window.siyuan.config.appearance.themeLight)}
        </select>
    </div>
    <div class="fn__hr"></div>
    <div class="fn__flex config__item">
        <div class="fn__flex-center fn__flex-1 ft__on-surface">
            ${window.siyuan.languages.theme12}
        </div>
        <span class="fn__space"></span>
        <select class="b3-select fn__flex-center fn__size200" id="themeDark">
           ${genOptions(window.siyuan.config.appearance.darkThemes, window.siyuan.config.appearance.themeDark)}
        </select>
    </div>
</div>
<div class="fn__flex b3-label config__item">
    <div class="fn__flex-1">
        <div class="fn__flex">
            ${window.siyuan.languages.icon}
            <span class="fn__space"></span>
            <a href="javascript:void(0)"${isBrowser() ? " class='fn__none'" : ""} id="appearanceOpenIcon">${window.siyuan.languages.appearance8}</a>
        </div>
        <div class="b3-label__text">${window.siyuan.languages.theme2}</div>
    </div>
    <span class="fn__space"></span>
    <select class="b3-select fn__flex-center fn__size200" id="icon">
        ${genOptions(window.siyuan.config.appearance.icons, window.siyuan.config.appearance.icon)}
    </select>
</div>
<div class="b3-label fn__flex"><div class="fn__block">
    <div>
        ${window.siyuan.languages.appearance1}
    </div>
    <div class="fn__hr"></div>
    <div class="fn__flex config__item">
        <div class="fn__flex-center fn__flex-1 ft__on-surface">${window.siyuan.languages.appearance2}</div>
        <span class="fn__space"></span>
        <select id="codeBlockThemeLight" class="b3-select fn__size200">
            ${genOptions(Constants.SIYUAN_CONFIG_APPEARANCE_LIGHT_CODE, window.siyuan.config.appearance.codeBlockThemeLight)}
        </select>
    </div>
    <div class="fn__hr"></div>
    <div class="fn__flex config__item">
        <div class="fn__flex-center fn__flex-1 ft__on-surface">${window.siyuan.languages.appearance3}</div>
        <span class="fn__space"></span>
        <select id="codeBlockThemeDark" class="b3-select fn__size200">
            ${genOptions(Constants.SIYUAN_CONFIG_APPEARANCE_DARK_CODE, window.siyuan.config.appearance.codeBlockThemeDark)}
        </select>
    </div>
</div></div>
<div class="fn__flex b3-label config__item">
    <div class="fn__flex-1">
        ${window.siyuan.languages.language}
        <div class="b3-label__text">${window.siyuan.languages.language1}</div>
    </div>
    <span class="fn__space"></span>
    <select id="lang" class="b3-select fn__flex-center fn__size200">${genLangOptions(window.siyuan.config.langs, window.siyuan.config.appearance.lang)}</select>
</div>
<div class="b3-label config__item${isBrowser() ? " fn__none" : " fn__flex"}">
    <div class="fn__flex-1">
        ${window.siyuan.languages.customEmoji}
        <div class="b3-label__text">${window.siyuan.languages.customEmojiTip}</div>
    </div>
    <span class="fn__space"></span>
    <button class="b3-button b3-button--outline fn__flex-center fn__size200" id="appearanceOpenEmoji">
        <svg><use xlink:href="#iconFolder"></use></svg>
        ${window.siyuan.languages.showInFolder}
    </button>
</div>
<div class="b3-label fn__flex config__item">
   <div class="fn__flex-1">
        ${window.siyuan.languages.resetLayout}
        <div class="b3-label__text">${window.siyuan.languages.appearance6}</div>
    </div>
    <span class="fn__space"></span>
    <button class="b3-button b3-button--outline fn__flex-center fn__size200" id="resetLayout">
        <svg><use xlink:href="#iconUndo"></use></svg>${window.siyuan.languages.reset}
    </button>
</div>
<div class="b3-label fn__flex config__item">
    <div class="fn__flex-1 fn__flex-center">
        ${window.siyuan.languages.codeSnippet}
    </div>
    <span class="fn__space"></span>
    <button class="b3-button b3-button--outline fn__flex-center fn__size200" id="codeSnippet">
        <svg><use xlink:href="#iconSettings"></use></svg>${window.siyuan.languages.config}
    </button>
</div>
<label class="fn__flex b3-label">
    <div class="fn__flex-1">
        ${window.siyuan.languages.appearance16}
        <div class="b3-label__text">${window.siyuan.languages.appearance17}</div>
    </div>
    <span class="fn__space"></span>
    <input class="b3-switch fn__flex-center" id="hideStatusBar" type="checkbox"${window.siyuan.config.appearance.hideStatusBar ? " checked" : ""}>
</label>
<label class="fn__flex b3-label">
    <div class="fn__flex-1">
        ${window.siyuan.languages.appearance10}
        <div class="b3-label__text">${window.siyuan.languages.appearance11}</div>
    </div>
    <span class="fn__space"></span>
    <input class="b3-switch fn__flex-center" id="closeButtonBehavior" type="checkbox"${window.siyuan.config.appearance.closeButtonBehavior === 0 ? "" : " checked"}>
</label>`;
    },
    _send: () => {
        const themeLight = (appearance.element.querySelector("#themeLight") as HTMLSelectElement).value;
        const themeDark = (appearance.element.querySelector("#themeDark") as HTMLSelectElement).value;
        const modeElementValue = parseInt((appearance.element.querySelector("#mode") as HTMLSelectElement).value);
        fetchPost("/api/setting/setAppearance", {
            icon: (appearance.element.querySelector("#icon") as HTMLSelectElement).value,
            mode: modeElementValue === 2 ? window.siyuan.config.appearance.mode : modeElementValue,
            modeOS: modeElementValue === 2,
            codeBlockThemeDark: (appearance.element.querySelector("#codeBlockThemeDark") as HTMLSelectElement).value,
            codeBlockThemeLight: (appearance.element.querySelector("#codeBlockThemeLight") as HTMLSelectElement).value,
            themeDark,
            themeLight,
            darkThemes: window.siyuan.config.appearance.darkThemes,
            lightThemes: window.siyuan.config.appearance.lightThemes,
            icons: window.siyuan.config.appearance.icons,
            lang: (appearance.element.querySelector("#lang") as HTMLSelectElement).value,
            closeButtonBehavior: (appearance.element.querySelector("#closeButtonBehavior") as HTMLInputElement).checked ? 1 : 0,
            hideStatusBar: (appearance.element.querySelector("#hideStatusBar") as HTMLInputElement).checked,
        }, async response => {
            if (window.siyuan.config.appearance.themeJS) {
                if (window.destroyTheme) {
                    try {
                        await window.destroyTheme();
                        window.destroyTheme = undefined;
                    } catch (e) {
                        console.error("destroyTheme error: " + e);
                    }
                } else {
                    if (!response.data.modeOS && (
                        response.data.mode !== window.siyuan.config.appearance.mode ||
                        window.siyuan.config.appearance.themeLight !== response.data.themeLight ||
                        window.siyuan.config.appearance.themeDark !== response.data.themeDark
                    )) {
                        exportLayout({
                            errorExit: false,
                            cb() {
                                window.location.reload();
                            },
                        });
                        return;
                    }
                    const OSTheme = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
                    if (response.data.modeOS && (
                        (response.data.mode === 1 && OSTheme === "light") || (response.data.mode === 0 && OSTheme === "dark")
                    )) {
                        exportLayout({
                            cb() {
                                window.location.reload();
                            },
                            errorExit: false,
                        });
                        return;
                    }
                }
            }
            appearance.onSetappearance(response.data);
            if (response.data.hideStatusBar) {
                document.getElementById("status").classList.add("fn__none");
            } else {
                document.getElementById("status").classList.remove("fn__none");
            }
            resetFloatDockSize();
        });
    },
    bindEvent: () => {
        appearance.element.querySelector("#codeSnippet").addEventListener("click", () => {
            openSnippets();
        });
        appearance.element.querySelector("#resetLayout").addEventListener("click", () => {
            confirmDialog("⚠️ " + window.siyuan.languages.reset, window.siyuan.languages.appearance6, () => {
                resetLayout();
            });
        });
        /// #if !BROWSER
        appearance.element.querySelector("#appearanceOpenIcon").addEventListener("click", () => {
            shell.openPath(path.join(window.siyuan.config.system.confDir, "appearance", "icons"));
        });
        appearance.element.querySelector("#appearanceOpenTheme").addEventListener("click", () => {
            shell.openPath(path.join(window.siyuan.config.system.confDir, "appearance", "themes"));
        });
        appearance.element.querySelector("#appearanceOpenEmoji").addEventListener("click", () => {
            shell.openPath(path.join(window.siyuan.config.system.dataDir, "emojis"));
        });
        /// #endif
        appearance.element.querySelectorAll("select").forEach(item => {
            item.addEventListener("change", () => {
                appearance._send();
            });
        });
        appearance.element.querySelectorAll(".b3-switch").forEach((item) => {
            item.addEventListener("change", () => {
                appearance._send();
            });
        });
    },
    onSetappearance(data: Config.IAppearance) {
        if (data.lang !== window.siyuan.config.appearance.lang) {
            exportLayout({
                cb() {
                    window.location.reload();
                },
                errorExit: false,
            });
            return;
        }
        window.siyuan.config.appearance = data;
        if (appearance.element) {
            const modeElement = appearance.element.querySelector("#mode") as HTMLSelectElement;
            if (modeElement) {
                if (data.modeOS) {
                    modeElement.value = "2";
                } else {
                    modeElement.value = data.mode === 0 ? "0" : "1";
                }
            }
            const themeLightElement = appearance.element.querySelector("#themeLight") as HTMLSelectElement;
            if (themeLightElement) {
                themeLightElement.innerHTML = genOptions(window.siyuan.config.appearance.lightThemes, window.siyuan.config.appearance.themeLight);
            }
            const themeDarkElement = appearance.element.querySelector("#themeDark") as HTMLSelectElement;
            if (themeDarkElement) {
                themeDarkElement.innerHTML = genOptions(window.siyuan.config.appearance.darkThemes, window.siyuan.config.appearance.themeDark);
            }
            const iconElement = appearance.element.querySelector("#icon") as HTMLSelectElement;
            if (iconElement) {
                iconElement.innerHTML = genOptions(window.siyuan.config.appearance.icons, window.siyuan.config.appearance.icon);
            }
        }
        loadAssets(data);
        document.querySelector("#barMode use")?.setAttribute("xlink:href", `#icon${window.siyuan.config.appearance.modeOS ? "Mode" : (window.siyuan.config.appearance.mode === 0 ? "Light" : "Dark")}`);
    }
};

/// #if !BROWSER
import {ipcRenderer, shell} from "electron";
import * as path from "path";
/// #endif
import {Constants} from "../constants";
import {exportLayout} from "../layout/util";
import * as Pickr from "@simonwep/pickr";
import {isBrowser} from "../util/functions";
import {fetchPost} from "../util/fetch";
import {loadAssets} from "../util/assets";
import {genOptions} from "../util/genOptions";

export const appearance = {
    element: undefined as Element,
    genHTML: () => {
        return `<label class="fn__flex b3-label">
    <div class="fn__flex-1">
        ${window.siyuan.languages.appearance4}
        <div class="b3-label__text">${window.siyuan.languages.appearance5}</div>
    </div>
    <span class="fn__space"></span>
    <select class="b3-select fn__flex-center fn__size200" id="mode">
      <option value="0" ${window.siyuan.config.appearance.mode === 0 ? "selected" : ""}>${window.siyuan.languages.themeLight}</option>
      <option value="1" ${window.siyuan.config.appearance.mode === 1 ? "selected" : ""}>${window.siyuan.languages.themeDark}</option>
      <!--option value="dark" ${window.siyuan.config.appearance.mode === 2 ? "selected" : ""}>${window.siyuan.languages.appearance7}</option-->
    </select>
</label>
<div class="b3-label">
    <div class="fn__flex">
        <div class="fn__flex-center">${window.siyuan.languages.theme}</div>
        <span class="fn__space"></span>
        <a href="javascript:void(0)" ${isBrowser() ? " class='fn__none'" : ""} id="appearanceOpenTheme" class="fn__flex-center">${window.siyuan.languages.appearance9}</a>
    </div>
    <div class="fn__hr"></div>
    <div class="fn__flex">
        <div class="fn__flex-center fn__flex-1 ft__on-surface">
            ${window.siyuan.languages.theme11}
        </div>
        <span class="fn__space"></span>
        <select class="b3-select fn__flex-center fn__size200" id="themeLight">
          ${genOptions(window.siyuan.config.appearance.lightThemes, window.siyuan.config.appearance.themeLight)}
        </select>
    </div>
    <div class="fn__hr"></div>
    <div class="fn__flex">
        <div class="fn__flex-center fn__flex-1 ft__on-surface">
            ${window.siyuan.languages.theme12}
        </div>
        <span class="fn__space"></span>
        <select class="b3-select fn__flex-center fn__size200" id="themeDark">
           ${genOptions(window.siyuan.config.appearance.darkThemes, window.siyuan.config.appearance.themeDark)}
        </select>
    </div>
</div>
<label class="fn__flex b3-label">
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
</label>
<label class="b3-label fn__flex"><div class="fn__block">
    <div>
        ${window.siyuan.languages.appearance1}
    </div>
    <div class="fn__hr"></div>
    <div class="fn__flex">
        <div class="fn__flex-center fn__flex-1 ft__on-surface">${window.siyuan.languages.appearance2}</div>
        <span class="fn__space"></span>
        <select id="codeBlockThemeLight" class="b3-select fn__size200">
            ${genOptions(Constants.SIYUAN_CONFIG_APPEARANCE_LIGHT_CODE, window.siyuan.config.appearance.codeBlockThemeLight)}
        </select>
    </div>
    <div class="fn__hr"></div>
    <div class="fn__flex">
        <div class="fn__flex-center fn__flex-1 ft__on-surface">${window.siyuan.languages.appearance3}</div>
        <span class="fn__space"></span>
        <select id="codeBlockThemeDark" class="b3-select fn__size200">
            ${genOptions(Constants.SIYUAN_CONFIG_APPEARANCE_DARK_CODE, window.siyuan.config.appearance.codeBlockThemeDark)}
        </select>
    </div>
</div></label>
<label class="fn__flex b3-label">
    <div class="fn__flex-1">
        ${window.siyuan.languages.language}
        <div class="b3-label__text">${window.siyuan.languages.language1}</div>
    </div>
    <span class="fn__space"></span>
    <select id="lang" class="b3-select fn__flex-center fn__size200">${genOptions(window.siyuan.config.langs, window.siyuan.config.appearance.lang)}</select>
</label>
<div class="b3-label${isBrowser() ? " fn__none" : ""}">
    <div class="fn__block fn__flex">
        <div class="fn__flex-1">
            ${window.siyuan.languages.customEmoji}
            <div class="b3-label__text">${window.siyuan.languages.customEmojiTip}</div>
        </div>
        <span class="fn__space"></span>
        <button class="b3-button b3-button--outline fn__flex-center fn__size200" id="appearanceRefresh">
            <svg><use xlink:href="#iconRefresh"></use></svg>
            ${window.siyuan.languages.refresh}
        </button>
    </div>
</div>
<div class="b3-label">
    <div class="fn__block fn__flex">
        <div class="fn__flex-1">
            ${window.siyuan.languages.theme13} <b id="appearanceCustomName">${window.siyuan.config.appearance.mode === 0 ? window.siyuan.config.appearance.themeLight : window.siyuan.config.appearance.themeDark}</b>
            <div class="b3-label__text">${window.siyuan.languages.theme14}</div>
        </div>
        <span class="fn__space"></span>
        <button class="b3-button b3-button--outline fn__flex-center fn__size200" id="appearanceCustom">${window.siyuan.config.appearance.customCSS ? window.siyuan.languages.close : window.siyuan.languages.open}</button>
    </div>
    <div id="appearanceCustomPanel"></div>
</div>
<label class="b3-label fn__flex">
   <div class="fn__flex-1">
        ${window.siyuan.languages.resetLayout}
        <div class="b3-label__text">${window.siyuan.languages.appearance6}</div>
    </div>
    <span class="fn__space"></span>
    <button class="b3-button b3-button--outline fn__flex-center fn__size200" id="resetLayout">
        <svg><use xlink:href="#iconUndo"></use></svg>${window.siyuan.languages.reset}
    </button>
</label>
<label class="fn__flex b3-label">
    <div class="fn__flex-1">
        ${window.siyuan.languages.appearance14}
        <div class="b3-label__text">${window.siyuan.languages.appearance15}</div>
    </div>
    <span class="fn__space"></span>
    <input class="b3-switch fn__flex-center" id="nativeEmoji" type="checkbox"${window.siyuan.config.appearance.nativeEmoji ? " checked" : ""}>
</label>
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
    onGetcustomcss: (data: Record<string, Record<string, string>>) => {
        let customHTML = '<div class="fn__hr"></div>';
        Object.keys(data).forEach((item) => {
            customHTML += `<div class="fn__hr"></div><div>${window.siyuan.languages[item]}</div><div class="fn__hr"></div>`;
            Object.keys(data[item]).forEach(subItem => {
                customHTML += `<div class="fn__flex">
    <span class="colorPicker" data-key="${item}" data-subkey="${subItem}" data-value="${data[item][subItem]}"></span>
    <span class="fn__space"></span>
    <span class="ft__on-surface fn__flex-center">${window.siyuan.languages[subItem]}</span>
</div><div class="fn__hr"></div>`;
            });
        });
        appearance.element.querySelector("#appearanceCustomPanel").innerHTML = customHTML;
        const pickrs: Record<string, Record<string, any>> = {};
        appearance.element.querySelectorAll("#appearanceCustomPanel .colorPicker").forEach((item: HTMLInputElement) => {
            // @ts-ignore
            const pickr = Pickr.create({
                container: "#appearanceCustomPanel",
                el: item,
                theme: "nano",
                default: item.getAttribute("data-value"),
                comparison: false,
                components: {
                    preview: true,
                    opacity: true,
                    hue: true,
                    interaction: {
                        input: true,
                    }
                }
            });
            pickr.on("hide", () => {
                appearance._sendCustomcss(pickrs);
            });
            pickr.on("changestop", () => {
                appearance._sendCustomcss(pickrs);
            });
            const key = item.getAttribute("data-key");
            if (!pickrs[key]) {
                pickrs[key] = {};
            }
            pickrs[key][item.getAttribute("data-subkey")] = pickr;
        });
    },
    _sendCustomcss: (pickrs: Record<string, Record<string, any>>) => {
        const css: Record<string, Record<string, string>> = {};
        Object.keys(pickrs).forEach((item) => {
            css[item] = {};
            Object.keys(pickrs[item]).forEach(subItem => {
                css[item][subItem] = pickrs[item][subItem].getColor().toRGBA().toString(0);
            });
        });
        fetchPost("/api/setting/setCustomCSS", {
            theme: appearance.element.querySelector("#appearanceCustomName").textContent,
            css
        });
    },
    _send: (mode?: number) => {
        const themeLight = (appearance.element.querySelector("#themeLight") as HTMLSelectElement).value;
        const themeDark = (appearance.element.querySelector("#themeDark") as HTMLSelectElement).value;
        const modeNumber = typeof mode === "number" ? mode : parseInt((appearance.element.querySelector("#mode") as HTMLSelectElement).value);
        fetchPost("/api/setting/setAppearance", {
            icon: (appearance.element.querySelector("#icon") as HTMLSelectElement).value,
            mode: modeNumber,
            codeBlockThemeDark: (appearance.element.querySelector("#codeBlockThemeDark") as HTMLSelectElement).value,
            codeBlockThemeLight: (appearance.element.querySelector("#codeBlockThemeLight") as HTMLSelectElement).value,
            themeDark,
            themeLight,
            darkThemes: window.siyuan.config.appearance.darkThemes,
            lightThemes: window.siyuan.config.appearance.lightThemes,
            icons: window.siyuan.config.appearance.icons,
            lang: (appearance.element.querySelector("#lang") as HTMLSelectElement).value,
            customCSS: window.siyuan.config.appearance.customCSS,
            closeButtonBehavior: (appearance.element.querySelector("#closeButtonBehavior") as HTMLInputElement).checked ? 1 : 0,
            nativeEmoji: (appearance.element.querySelector("#nativeEmoji") as HTMLInputElement).checked,
            hideStatusBar: (appearance.element.querySelector("#hideStatusBar") as HTMLInputElement).checked,
        }, response => {
            let needTip = false;
            if (modeNumber !== window.siyuan.config.appearance.mode || themeLight !== window.siyuan.config.appearance.themeLight ||
                themeDark !== window.siyuan.config.appearance.themeDark) {
                needTip = true;
            }
            if (window.siyuan.config.appearance.themeJS && needTip) {
                exportLayout(true);
                return;
            }
            appearance.onSetappearance(response.data);
            if (response.data.hideStatusBar) {
                document.getElementById("status").classList.add("fn__none");
            } else {
                document.getElementById("status").classList.remove("fn__none");
            }
        });
    },
    bindEvent: () => {
        if (window.siyuan.config.appearance.customCSS) {
            fetchPost("/api/setting/getCustomCSS", {
                theme: appearance.element.querySelector("#appearanceCustomName").textContent
            }, response => {
                appearance.onGetcustomcss(response.data);
            });
        }
        const appearanceCustomElement = appearance.element.querySelector("#appearanceCustom");
        appearanceCustomElement.addEventListener("click", () => {
            if (window.siyuan.config.appearance.customCSS) {
                window.siyuan.config.appearance.customCSS = false;
                appearanceCustomElement.textContent = window.siyuan.languages.open;
                appearance.element.querySelector("#appearanceCustomPanel").innerHTML = "";
            } else {
                window.siyuan.config.appearance.customCSS = true;
                fetchPost("/api/setting/getCustomCSS", {
                    theme: appearance.element.querySelector("#appearanceCustomName").textContent
                }, response => {
                    appearance.onGetcustomcss(response.data);
                });
                appearanceCustomElement.textContent = window.siyuan.languages.close;
            }
            appearance._send();
        });
        appearance.element.querySelector("#resetLayout").addEventListener("click", () => {
            fetchPost("/api/system/setUILayout", {layout: {}}, () => {
                window.location.reload();
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
        appearance.element.querySelector("#appearanceRefresh").addEventListener("click", () => {
            exportLayout(true);
        });
        /// #endif
        appearance.element.querySelectorAll("select").forEach(item => {
            item.addEventListener("change", () => {
                let mode;
                if (item.id === "themeLight") {
                    mode = 0;
                } else if (item.id === "themeDark") {
                    mode = 1;
                }
                appearance._send(mode);
            });
        });
        appearance.element.querySelectorAll(".b3-switch").forEach((item) => {
            item.addEventListener("change", () => {
                appearance._send();
            });
        });
    },
    onSetappearance(data: IAppearance) {
        if (data.lang !== window.siyuan.config.appearance.lang || data.nativeEmoji !== window.siyuan.config.appearance.nativeEmoji) {
            exportLayout(true);
            return;
        }
        window.siyuan.config.appearance = data;
        if (appearance.element) {
            const theme = data.mode === 0 ? data.themeLight : data.themeDark;
            const modeElement = appearance.element.querySelector("#mode");
            if (modeElement) {
                modeElement.innerHTML = `<option value="0" ${data.mode === 0 ? "selected" : ""}>${window.siyuan.languages.themeLight}</option>
<option value="1" ${data.mode === 1 ? "selected" : ""}>${window.siyuan.languages.themeDark}</option>`;
                appearance.element.querySelector("#appearanceCustomName").textContent = theme;
            }
            const themeLightElement = appearance.element.querySelector("#themeLight") as HTMLSelectElement;
            if (themeLightElement) {
                themeLightElement.value = data.themeLight;
            }
            const themeDarkElement = appearance.element.querySelector("#themeDark") as HTMLSelectElement;
            if (themeDarkElement) {
                themeDarkElement.value = data.themeDark;
            }
            const iconElement = appearance.element.querySelector("#icon") as HTMLSelectElement;
            if (iconElement) {
                iconElement.value = data.icon;
            }
            if (data.customCSS) {
                fetchPost("/api/setting/getCustomCSS", {
                    theme
                }, response => {
                    appearance.onGetcustomcss(response.data);
                });
            }
        }
        /// #if !BROWSER
        ipcRenderer.send(Constants.SIYUAN_CONFIG_THEME, data.mode === 1 ? "dark" : "light");
        ipcRenderer.send(Constants.SIYUAN_CONFIG_CLOSE, data.closeButtonBehavior);
        /// #endif
        loadAssets(data);
        const modeElement = document.getElementById("barThemeMode");
        if (modeElement) {
            if (data.mode === 1) {
                modeElement.classList.add("toolbar__item--active");
                modeElement.setAttribute("aria-label", window.siyuan.languages.themeLight);
            } else {
                modeElement.classList.remove("toolbar__item--active");
                modeElement.setAttribute("aria-label", window.siyuan.languages.themeDark);
            }
        }
    }
};

/// #if !BROWSER
import {ipcRenderer, shell} from "electron";
import * as path from "path";
/// #endif
import {Constants} from "../constants";
import {exportLayout} from "../layout/util";
import * as Pickr from "@simonwep/pickr";
import {isBrowser} from "../util/functions";
import {fetchPost} from "../util/fetch";
import {loadAssets, renderSnippet} from "../util/assets";
import {genOptions} from "../util/genOptions";
import {hasClosestByClassName} from "../protyle/util/hasClosest";

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
      <option value="0" ${(window.siyuan.config.appearance.mode === 0 && !window.siyuan.config.appearance.modeOS) ? "selected" : ""}>${window.siyuan.languages.themeLight}</option>
      <option value="1" ${(window.siyuan.config.appearance.mode === 1 && !window.siyuan.config.appearance.modeOS) ? "selected" : ""}>${window.siyuan.languages.themeDark}</option>
      <option value="2" ${window.siyuan.config.appearance.modeOS ? "selected" : ""}>${window.siyuan.languages.themeOS}</option>
    </select>
</label>
<div class="b3-label">
    <div class="fn__flex">
        <div class="fn__flex-center">${window.siyuan.languages.theme}</div>
        <span class="fn__space"></span>
        <a href="javascript:void(0)" ${isBrowser() ? " class='fn__none'" : ""} id="appearanceOpenTheme" class="fn__flex-center">${window.siyuan.languages.appearance9}</a>
    </div>
    <div class="fn__hr"></div>
    <label class="fn__flex">
        <div class="fn__flex-center fn__flex-1 ft__on-surface">
            ${window.siyuan.languages.theme11}
        </div>
        <span class="fn__space"></span>
        <select class="b3-select fn__flex-center fn__size200" id="themeLight">
          ${genOptions(window.siyuan.config.appearance.lightThemes, window.siyuan.config.appearance.themeLight)}
        </select>
    </label>
    <div class="fn__hr"></div>
    <label class="fn__flex">
        <div class="fn__flex-center fn__flex-1 ft__on-surface">
            ${window.siyuan.languages.theme12}
        </div>
        <span class="fn__space"></span>
        <select class="b3-select fn__flex-center fn__size200" id="themeDark">
           ${genOptions(window.siyuan.config.appearance.darkThemes, window.siyuan.config.appearance.themeDark)}
        </select>
    </label>
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
<div class="b3-label fn__flex"><div class="fn__block">
    <div>
        ${window.siyuan.languages.appearance1}
    </div>
    <div class="fn__hr"></div>
    <label class="fn__flex">
        <div class="fn__flex-center fn__flex-1 ft__on-surface">${window.siyuan.languages.appearance2}</div>
        <span class="fn__space"></span>
        <select id="codeBlockThemeLight" class="b3-select fn__size200">
            ${genOptions(Constants.SIYUAN_CONFIG_APPEARANCE_LIGHT_CODE, window.siyuan.config.appearance.codeBlockThemeLight)}
        </select>
    </label>
    <div class="fn__hr"></div>
    <label class="fn__flex">
        <div class="fn__flex-center fn__flex-1 ft__on-surface">${window.siyuan.languages.appearance3}</div>
        <span class="fn__space"></span>
        <select id="codeBlockThemeDark" class="b3-select fn__size200">
            ${genOptions(Constants.SIYUAN_CONFIG_APPEARANCE_DARK_CODE, window.siyuan.config.appearance.codeBlockThemeDark)}
        </select>
    </label>
</div></div>
<label class="fn__flex b3-label">
    <div class="fn__flex-1">
        ${window.siyuan.languages.language}
        <div class="b3-label__text">${window.siyuan.languages.language1}</div>
    </div>
    <span class="fn__space"></span>
    <select id="lang" class="b3-select fn__flex-center fn__size200">${genOptions(window.siyuan.config.langs, window.siyuan.config.appearance.lang)}</select>
</label>
<label class="b3-label${isBrowser() ? " fn__none" : " fn__flex"}">
    <div class="fn__flex-1">
        ${window.siyuan.languages.customEmoji}
        <div class="b3-label__text">${window.siyuan.languages.customEmojiTip}</div>
    </div>
    <span class="fn__space"></span>
    <button class="b3-button b3-button--outline fn__flex-center fn__size200" id="appearanceRefresh">
        <svg><use xlink:href="#iconRefresh"></use></svg>
        ${window.siyuan.languages.refresh}
    </button>
</label>
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
<div class="b3-label">
    <label class="fn__block fn__flex">
        <div class="fn__flex-1">
            ${window.siyuan.languages.theme13} <b id="appearanceCustomName">${window.siyuan.config.appearance.mode === 0 ? window.siyuan.config.appearance.themeLight : window.siyuan.config.appearance.themeDark}</b>
            <div class="b3-label__text">${window.siyuan.languages.theme14}</div>
        </div>
        <span class="fn__space"></span>
        <button class="b3-button b3-button--outline fn__flex-center fn__size200" id="appearanceCustom">${window.siyuan.config.appearance.customCSS ? window.siyuan.languages.close : window.siyuan.languages.open}</button>
    </label>
    <div id="appearanceCustomPanel"></div>
</div>
<div class="b3-label">
    <label class="fn__block fn__flex">
        <div class="fn__flex-1 fn__flex-center">
            ${window.siyuan.languages.codeSnippet}
        </div>
        <span class="fn__space"></span>
        <button class="b3-button b3-button--outline fn__flex-center fn__size200" id="codeSnippet">
            <svg><use xlink:href="#iconSettings"></use></svg>${window.siyuan.languages.config}
        </button>
    </label>
    <div id="codeSnippetPanel"></div>
</div>
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
            customCSS: window.siyuan.config.appearance.customCSS,
            closeButtonBehavior: (appearance.element.querySelector("#closeButtonBehavior") as HTMLInputElement).checked ? 1 : 0,
            nativeEmoji: (appearance.element.querySelector("#nativeEmoji") as HTMLInputElement).checked,
            hideStatusBar: (appearance.element.querySelector("#hideStatusBar") as HTMLInputElement).checked,
        }, response => {
            if ((
                    window.siyuan.config.appearance.themeJS && !response.data.modeOS &&
                    (
                        response.data.mode !== window.siyuan.config.appearance.mode ||
                        window.siyuan.config.appearance.themeLight !== response.data.themeLight ||
                        window.siyuan.config.appearance.themeDark !== response.data.themeDark
                    )
                ) ||
                (response.data.modeOS && !window.siyuan.config.appearance.modeOS)
            ) {
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
    _bindSnippet: (element: HTMLElement) => {
        const itemContentElement = hasClosestByClassName(element, "b3-label");
        if (!itemContentElement) {
            return
        }
        fetchPost("/api/snippet/setSnippet", {
            id: itemContentElement.getAttribute("data-id"),
            name: itemContentElement.querySelector("input").value,
            type: itemContentElement.querySelector(".b3-chip").textContent,
            content: itemContentElement.querySelector("textarea").value,
            enabled: (itemContentElement.querySelector(".b3-switch") as HTMLInputElement).checked
        }, (response) => {
            itemContentElement.setAttribute("data-id", response.data.id)
            renderSnippet();
        })
    },
    _genSnippet: (options: ISnippet) => {
        return `<div class="b3-label" style="margin: 0" data-id="${options.id || ""}">
    <div class="fn__flex">
        <div class="b3-chip fn__flex-center b3-chip--small b3-chip--secondary">${options.type}</div>
        <div class="fn__space"></div>
        <input type="text" class="fn__size200 b3-text-field" placeholder="${window.siyuan.languages.title}">
        <div class="fn__flex-1"></div>
        <span aria-label="${window.siyuan.languages.remove}" class="b3-tooltips b3-tooltips__n block__icon block__icon--show">
            <svg><use xlink:href="#iconTrashcan"></use></svg>
        </span>
        <div class="fn__space"></div>
        <input data-type="snippet" class="b3-switch fn__flex-center" type="checkbox"${options.enabled ? " checked" : ""}>
    </div>
    <div class="fn__hr"></div>
    <textarea class="fn__block b3-text-field" placeholder="${window.siyuan.languages.codeSnippet}"></textarea>
</div>`
    },
    bindEvent: () => {
        if (window.siyuan.config.appearance.customCSS) {
            fetchPost("/api/setting/getCustomCSS", {
                theme: appearance.element.querySelector("#appearanceCustomName").textContent
            }, response => {
                appearance.onGetcustomcss(response.data);
            });
        }
        const codeSnippetPanelElement = appearance.element.querySelector("#codeSnippetPanel");
        const codeSnippetElement = appearance.element.querySelector("#codeSnippet");
        codeSnippetElement.addEventListener("click", () => {
            if (codeSnippetPanelElement.innerHTML) {
                codeSnippetPanelElement.innerHTML = "";
                return;
            }
            fetchPost("/api/snippet/getSnippet", {type: "all", enabled: 2}, (response) => {
                let html = `<div class="fn__hr"></div>
<div class="fn__flex">
    <div class="fn__flex-1"></div>
    <button class="b3-button b3-button--outline fn__flex-center fn__size200" id="addCodeSnippetCSS">
        <svg><use xlink:href="#iconAdd"></use></svg> ${window.siyuan.languages.addAttr} CSS
    </button>
    <div class="fn__space"></div>
    <button class="b3-button b3-button--outline fn__flex-center fn__size200" id="addCodeSnippetJS">
        <svg><use xlink:href="#iconAdd"></use></svg> ${window.siyuan.languages.addAttr} JS
    </button>
</div>`;
                response.data.snippets.forEach((item: ISnippet) => {
                    html += appearance._genSnippet(item);
                });
                codeSnippetPanelElement.innerHTML = html;
                response.data.snippets.forEach((item: ISnippet) => {
                    const nameElement = (codeSnippetPanelElement.querySelector(`[data-id="${item.id}"] input`) as HTMLInputElement)
                    nameElement.value = item.name;
                    const contentElement = codeSnippetPanelElement.querySelector(`[data-id="${item.id}"] textarea`) as HTMLTextAreaElement;
                    contentElement.textContent = item.content;
                    nameElement.addEventListener("blur", (event) => {
                        appearance._bindSnippet(nameElement);
                    })
                    contentElement.addEventListener("blur", (event) => {
                        appearance._bindSnippet(contentElement);
                    })
                    codeSnippetPanelElement.querySelector(`[data-id="${item.id}"] .b3-switch`).addEventListener("change", (event) => {
                        appearance._bindSnippet(contentElement);
                    })
                });
            });
        });
        codeSnippetPanelElement.addEventListener("click", (event) => {
            const target = event.target as HTMLElement;
            if (target.id === "addCodeSnippetCSS" || target.id === "addCodeSnippetJS") {
                target.parentElement.insertAdjacentHTML("afterend", appearance._genSnippet({
                    type: target.id === "addCodeSnippetCSS" ? "css" : "js",
                    name: "",
                    content: "",
                    enabled: false
                }))
                codeSnippetPanelElement.querySelector(".b3-text-field").addEventListener("blur", (event) => {
                    appearance._bindSnippet(event.target as HTMLElement);
                })
                codeSnippetPanelElement.querySelector("textarea.b3-text-field").addEventListener("blur", (event) => {
                    appearance._bindSnippet(event.target as HTMLElement);
                })
                codeSnippetPanelElement.querySelector('.b3-switch').addEventListener("change", (event) => {
                    appearance._bindSnippet(event.target as HTMLElement);
                })
                return;
            }
            const removeElement = hasClosestByClassName(target, "b3-tooltips")
            if (removeElement) {
                const id = removeElement.parentElement.parentElement.getAttribute("data-id");
                removeElement.parentElement.parentElement.remove();
                if (!id) {
                    return;
                }
                fetchPost("/api/snippet/removeSnippet", {
                    id
                }, (response) => {
                    const exitElement = document.getElementById(`snippet${response.data.type === "css" ? "CSS" : "JS"}${response.data.id}`) as HTMLScriptElement;
                    if (exitElement) {
                        exitElement.remove();
                    }
                })
            }
        })
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
                appearance._send();
            });
        });
        appearance.element.querySelectorAll(".b3-switch").forEach((item) => {
            item.addEventListener("change", () => {
                appearance._send();
            });
        });
    },
    onSetappearance(data: IAppearance, needLoadAsset = true) {
        if (data.lang !== window.siyuan.config.appearance.lang || data.nativeEmoji !== window.siyuan.config.appearance.nativeEmoji) {
            exportLayout(true);
            return;
        }
        window.siyuan.config.appearance = data;
        if (appearance.element) {
            const theme = data.mode === 0 ? data.themeLight : data.themeDark;
            const modeElement = appearance.element.querySelector("#mode") as HTMLSelectElement;
            if (modeElement) {
                if (data.modeOS) {
                    modeElement.value = "2";
                } else {
                    modeElement.value = data.mode === 0 ? "0" : "1";
                }
                appearance.element.querySelector("#appearanceCustomName").textContent = theme;
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
            if (data.customCSS) {
                fetchPost("/api/setting/getCustomCSS", {
                    theme
                }, response => {
                    appearance.onGetcustomcss(response.data);
                });
            }
        }
        /// #if !BROWSER
        ipcRenderer.send(Constants.SIYUAN_CONFIG_THEME, data.modeOS ? "system" : (data.mode === 1 ? "dark" : "light"));
        ipcRenderer.send(Constants.SIYUAN_CONFIG_CLOSE, data.closeButtonBehavior);
        /// #endif
        if (needLoadAsset) {
            loadAssets(data);
        }
        document.querySelector("#barMode use").setAttribute("xlink:href", `#icon${window.siyuan.config.appearance.modeOS ? "Mode" : (window.siyuan.config.appearance.mode === 0 ? "Light" : "Dark")}`);
    }
};

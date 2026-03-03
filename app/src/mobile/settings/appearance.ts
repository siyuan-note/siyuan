import {fetchPost} from "../../util/fetch";
import {genLangOptions, genOptions} from "../../util/genOptions";
import {openModel} from "../menu/model";
import {setStatusBar} from "../../config/util/setStatusBar";

export const initAppearance = () => {
    openModel({
        title: window.siyuan.languages.appearance,
        icon: "iconTheme",
        html: `<div class="b3-label">
    ${window.siyuan.languages.appearance4}
    <div class="fn__hr"></div>
    <select class="b3-select fn__block" id="mode">
      <option value="0" ${(window.siyuan.config.appearance.mode === 0 && !window.siyuan.config.appearance.modeOS) ? "selected" : ""}>${window.siyuan.languages.themeLight}</option>
      <option value="1" ${(window.siyuan.config.appearance.mode === 1 && !window.siyuan.config.appearance.modeOS) ? "selected" : ""}>${window.siyuan.languages.themeDark}</option>
      <option value="2" ${window.siyuan.config.appearance.modeOS ? "selected" : ""}>${window.siyuan.languages.themeOS}</option>
    </select>
    <div class="b3-label__text">${window.siyuan.languages.appearance5}</div>
</div>
<div class="b3-label">
    ${window.siyuan.languages.theme}
    <div class="fn__hr"></div>
    <select class="b3-select fn__block" id="themeLight">
      ${genOptions(window.siyuan.config.appearance.lightThemes, window.siyuan.config.appearance.themeLight)}
    </select>
    <div class="b3-label__text">${window.siyuan.languages.theme11}</div>
    <div class="fn__hr"></div>
    <select class="b3-select fn__block" id="themeDark">
       ${genOptions(window.siyuan.config.appearance.darkThemes, window.siyuan.config.appearance.themeDark)}
    </select>
    <div class="b3-label__text">${window.siyuan.languages.theme12}</div>
</div>
<div class="b3-label">
    ${window.siyuan.languages.icon}
    <div class="fn__hr"></div>
    <select class="b3-select fn__block" id="icon">
        ${genOptions(window.siyuan.config.appearance.icons, window.siyuan.config.appearance.icon)}
    </select>
    <div class="b3-label__text">${window.siyuan.languages.theme2}</div>
</div>
<div class="b3-label">
    ${window.siyuan.languages.language}
    <div class="fn__hr"></div>
    <select id="lang" class="b3-select fn__block">${genLangOptions(window.siyuan.config.langs, window.siyuan.config.appearance.lang)}</select>
    <div class="b3-label__text">${window.siyuan.languages.language1}</div>
</div>
<div class="b3-label">
    <label class="fn__flex">
        <div class="fn__flex-1">
            ${window.siyuan.languages.appearance16}
            <div class="b3-label__text">${window.siyuan.languages.appearance17}</div>
        </div>
        <span class="fn__space"></span>
        <input class="b3-switch fn__flex-center" id="hideStatusBar" type="checkbox"${window.siyuan.config.appearance.hideStatusBar ? " checked" : ""}>
    </label>
    <div class="fn__hr"></div>
    <button class="b3-button b3-button--outline fn__block" data-action="hideStatusBarSetting">
       <svg><use xlink:href="#iconSettings"></use></svg>${window.siyuan.languages.config}
    </button>
    <div class="b3-label__text">${window.siyuan.languages.appearance18}</div>
</div>`,
        bindEvent(modelMainElement: HTMLElement) {
            setStatusBar(modelMainElement.querySelector('[data-action="hideStatusBarSetting"]'));
            modelMainElement.querySelectorAll("select, .b3-switch").forEach(item => {
                item.addEventListener("change", () => {
                    const modeElementValue = parseInt((modelMainElement.querySelector("#mode") as HTMLSelectElement).value);
                    fetchPost("/api/setting/setAppearance", Object.assign({}, window.siyuan.config.appearance, {
                        icon: (modelMainElement.querySelector("#icon") as HTMLSelectElement).value,
                        mode: modeElementValue === 2 ? window.siyuan.config.appearance.mode : modeElementValue,
                        modeOS: modeElementValue === 2,
                        themeDark: (modelMainElement.querySelector("#themeDark") as HTMLSelectElement).value,
                        themeLight: (modelMainElement.querySelector("#themeLight") as HTMLSelectElement).value,
                        lang: (modelMainElement.querySelector("#lang") as HTMLSelectElement).value,
                        hideStatusBar: (modelMainElement.querySelector("#hideStatusBar") as HTMLInputElement).checked,
                    }));
                });
            });
        }
    });
};

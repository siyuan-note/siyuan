import {closePanel} from "../util/closePanel";
import {fetchPost} from "../../util/fetch";
import {setInlineStyle} from "../../util/assets";
import {genOptions} from "../../util/genOptions";

export const initAppearance = (modelElement: HTMLElement, modelMainElement: HTMLElement) => {
    closePanel();
    modelElement.style.top = "0";
    modelElement.querySelector(".toolbar__icon").innerHTML = '<use xlink:href="#iconTheme"></use>';
    modelElement.querySelector(".toolbar__text").textContent = window.siyuan.languages.appearance;
    modelMainElement.innerHTML = `<div class="b3-label">
    ${window.siyuan.languages.appearance4}
    <div class="fn__hr"></div>
    <select class="b3-select fn__block" id="mode">
      <option value="0" ${window.siyuan.config.appearance.mode === 0 ? "selected" : ""}>${window.siyuan.languages.themeLight}</option>
      <option value="1" ${window.siyuan.config.appearance.mode === 1 ? "selected" : ""}>${window.siyuan.languages.themeDark}</option>
    </select>
    <div class="b3-label__text b3-typography">${window.siyuan.languages.appearance5}</div>
</div>
<div class="b3-label">
    ${window.siyuan.languages.theme}
    <div class="fn__hr"></div>
    <select class="b3-select fn__block" id="themeLight">
      ${genOptions(window.siyuan.config.appearance.lightThemes, window.siyuan.config.appearance.themeLight)}
    </select>
    <div class="b3-label__text b3-typography">${window.siyuan.languages.theme11}</div>
    <div class="fn__hr"></div>
    <select class="b3-select fn__block" id="themeDark">
       ${genOptions(window.siyuan.config.appearance.darkThemes, window.siyuan.config.appearance.themeDark)}
    </select>
    <div class="b3-label__text b3-typography">${window.siyuan.languages.theme12}</div>
</div>
<div class="b3-label">
    ${window.siyuan.languages.icon}
    <div class="fn__hr"></div>
    <select class="b3-select fn__block" id="icon">
        ${genOptions(window.siyuan.config.appearance.icons, window.siyuan.config.appearance.icon)}
    </select>
    <div class="b3-label__text b3-typography">${window.siyuan.languages.theme2}</div>
</div>
<div class="b3-label">
    ${window.siyuan.languages.language}
    <div class="fn__hr"></div>
    <select id="lang" class="b3-select fn__block">${genOptions(window.siyuan.config.langs, window.siyuan.config.appearance.lang)}</select>
    <div class="b3-label__text b3-typography">${window.siyuan.languages.language1}</div>
</div>
<div class="b3-label">
    ${window.siyuan.languages.fontSize} <span id="fontSize" class="ft__on-surface">${window.siyuan.config.editor.fontSize}px</span>
    <div class="fn__hr"></div>
    <input class="b3-slider fn__block" max="72" min="9" step="1" type="range" value="${window.siyuan.config.editor.fontSize}">
    <div class="b3-label__text b3-typography">${window.siyuan.languages.fontSizeTip}</div>
</div>`;
    modelMainElement.querySelector(".b3-slider").addEventListener("input", (event: InputEvent & { target: HTMLInputElement }) => {
        modelMainElement.querySelector("#fontSize").textContent = event.target.value + "px";
        fetchPost("/api/setting/setEditor", {
            displayBookmarkIcon: window.siyuan.config.editor.displayBookmarkIcon,
            displayNetImgMark:  window.siyuan.config.editor.displayNetImgMark,
            codeLineWrap: window.siyuan.config.editor.codeLineWrap,
            codeSyntaxHighlightLineNum: window.siyuan.config.editor.codeSyntaxHighlightLineNum,
            virtualBlockRef: window.siyuan.config.editor.virtualBlockRef,
            virtualBlockRefExclude: window.siyuan.config.editor.virtualBlockRefExclude,
            blockRefDynamicAnchorTextMaxLen: window.siyuan.config.editor.blockRefDynamicAnchorTextMaxLen,
            fontSize: parseInt((modelMainElement.querySelector(".b3-slider") as HTMLInputElement).value),
            codeLigatures: window.siyuan.config.editor.codeLigatures,
            codeTabSpaces: window.siyuan.config.editor.codeTabSpaces,
            generateHistoryInterval: window.siyuan.config.editor.generateHistoryInterval,
            historyRetentionDays: window.siyuan.config.editor.historyRetentionDays,
            fontFamily: window.siyuan.config.editor.fontFamily,
            emoji: window.siyuan.config.editor.emoji
        }, (response) => {
            window.siyuan.config.editor = response.data;
            window.siyuan.mobileEditor.reload();
            setInlineStyle();
        });
    });
    modelMainElement.querySelectorAll("select").forEach(item => {
        item.addEventListener("change", () => {
            fetchPost("/api/setting/setAppearance", {
                icon: (modelMainElement.querySelector("#icon") as HTMLSelectElement).value,
                mode: parseInt((modelMainElement.querySelector("#mode") as HTMLSelectElement).value),
                codeBlockThemeDark: window.siyuan.config.appearance.codeBlockThemeDark,
                codeBlockThemeLight: window.siyuan.config.appearance.codeBlockThemeLight,
                themeDark: (modelMainElement.querySelector("#themeDark") as HTMLSelectElement).value,
                themeLight: (modelMainElement.querySelector("#themeLight") as HTMLSelectElement).value,
                darkThemes: window.siyuan.config.appearance.darkThemes,
                lightThemes: window.siyuan.config.appearance.lightThemes,
                icons: window.siyuan.config.appearance.icons,
                lang: (modelMainElement.querySelector("#lang") as HTMLSelectElement).value,
                customCSS: window.siyuan.config.appearance.customCSS,
                closeButtonBehavior: window.siyuan.config.appearance.closeButtonBehavior,
                nativeEmoji: window.siyuan.config.appearance.nativeEmoji,
            }, () => {
                window.location.reload();
            });
        });
    });
};

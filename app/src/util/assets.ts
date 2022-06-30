import {Constants} from "../constants";
import {addScript} from "../protyle/util/addScript";
import {addStyle} from "../protyle/util/addStyle";
import {setCodeTheme} from "../protyle/ui/setCodeTheme";
/// #if !MOBILE
import {getAllModels} from "../layout/getAll";
/// #endif
import {isMobile} from "./functions";

export const loadAssets = (data: IAppearance) => {
    const defaultStyleElement = document.getElementById("themeDefaultStyle");
    let defaultThemeAddress = `/appearance/themes/${data.mode === 1 ? "midnight" : "daylight"}/${data.customCSS ? "custom" : "theme"}.css?v=${data.customCSS ? new Date().getTime() : Constants.SIYUAN_VERSION}`;
    if ((data.mode === 1 && data.themeDark !== "midnight") || (data.mode === 0 && data.themeLight !== "daylight")) {
        defaultThemeAddress = `/appearance/themes/${data.mode === 1 ? "midnight" : "daylight"}/theme.css?v=${Constants.SIYUAN_VERSION}`;
    }
    if (defaultStyleElement) {
        if (!defaultStyleElement.getAttribute("href").startsWith(defaultThemeAddress)) {
            defaultStyleElement.remove();
            addStyle(defaultThemeAddress, "themeDefaultStyle");
        }
    } else {
        addStyle(defaultThemeAddress, "themeDefaultStyle");
    }
    const styleElement = document.getElementById("themeStyle");
    if ((data.mode === 1 && data.themeDark !== "midnight") || (data.mode === 0 && data.themeLight !== "daylight")) {
        const themeAddress = `/appearance/themes/${data.mode === 1 ? data.themeDark : data.themeLight}/${data.customCSS ? "custom" : "theme"}.css?v=${data.customCSS ? new Date().getTime() : data.themeVer}`;
        if (styleElement) {
            if (!styleElement.getAttribute("href").startsWith(themeAddress)) {
                styleElement.remove();
                addStyle(themeAddress, "themeStyle");
            }
        } else {
            addStyle(themeAddress, "themeStyle");
        }
    } else if (styleElement) {
        styleElement.remove();
    }
    /// #if !MOBILE
    getAllModels().graph.forEach(item => {
        item.searchGraph(false);
    });
    /// #endif
    setCodeTheme();

    const themeScriptElement = document.getElementById("themeScript");
    const themeScriptAddress = `/appearance/themes/${data.mode === 1 ? data.themeDark : data.themeLight}/theme.js?v=${data.themeVer}`;
    if (themeScriptElement) {
        if (!themeScriptElement.getAttribute("src").startsWith(themeScriptAddress)) {
            themeScriptElement.remove();
            addScript(themeScriptAddress, "themeScript");
        }
    } else {
        addScript(themeScriptAddress, "themeScript");
    }

    const scriptElement = document.getElementById("iconScript");
    const iconURL = `/appearance/icons/${data.icon}/icon.js?v=${data.iconVer}`;
    if (scriptElement) {
        if (!scriptElement.getAttribute("src").startsWith(iconURL)) {
            scriptElement.remove();
            addScript(iconURL, "iconScript");
        }
    } else {
        addScript(iconURL, "iconScript");
    }
};

export const initAssets = () => {
    const emojiElement = document.getElementById("emojiScript");
    const loadingElement = document.getElementById("loading");
    if (!emojiElement && !window.siyuan.config.appearance.nativeEmoji && !isMobile()) {
        addScript("/appearance/emojis/twitter-emoji.js?v=1.0.0", "emojiScript").then(() => {
            if (loadingElement) {
                loadingElement.remove();
            }
        });
    } else if (loadingElement) {
        setTimeout(() => {
            loadingElement.remove();
        }, 160);
    }
};

export const setInlineStyle = (set = true) => {
    const height = Math.floor(window.siyuan.config.editor.fontSize * 1.625);
    let style = `.b3-typography, .protyle-wysiwyg, .protyle-title {font-size:${window.siyuan.config.editor.fontSize}px !important}
.b3-typography code:not(.hljs), .protyle-wysiwyg code:not(.hljs) { font-variant-ligatures: ${window.siyuan.config.editor.codeLigatures ? "normal" : "none"} }
.li > .protyle-action {height:${height + 8}px;line-height: ${height + 8}px}
.protyle-wysiwyg [data-node-id].li > .protyle-action ~ .h1, .protyle-wysiwyg [data-node-id].li > .protyle-action ~ .h2, .protyle-wysiwyg [data-node-id].li > .protyle-action ~ .h3, .protyle-wysiwyg [data-node-id].li > .protyle-action ~ .h4, .protyle-wysiwyg [data-node-id].li > .protyle-action ~ .h5, .protyle-wysiwyg [data-node-id].li > .protyle-action ~ .h6 {line-height:${height + 8}px;}
.protyle-wysiwyg [data-node-id].li > .protyle-action:after {height: ${window.siyuan.config.editor.fontSize}px;width: ${window.siyuan.config.editor.fontSize}px;margin:-${window.siyuan.config.editor.fontSize / 2}px 0 0 -${window.siyuan.config.editor.fontSize / 2}px}
.protyle-wysiwyg [data-node-id].li > .protyle-action svg {height: ${Math.max(14, window.siyuan.config.editor.fontSize - 8)}px}
.protyle-wysiwyg [data-node-id] [spellcheck="false"] {min-height:${height}px}
.protyle-wysiwyg .li {min-height:${height + 8}px}
.protyle-gutters button svg {height:${height}px}
.protyle-wysiwyg img.emoji, .b3-typography img.emoji {width:${height - 8}px}
.protyle-wysiwyg .h1 img.emoji, .b3-typography h1 img.emoji {width:${Math.floor(window.siyuan.config.editor.fontSize * 1.75 * 1.25)}px}
.protyle-wysiwyg .h2 img.emoji, .b3-typography h2 img.emoji {width:${Math.floor(window.siyuan.config.editor.fontSize * 1.55 * 1.25)}px}
.protyle-wysiwyg .h3 img.emoji, .b3-typography h3 img.emoji {width:${Math.floor(window.siyuan.config.editor.fontSize * 1.38 * 1.25)}px}
.protyle-wysiwyg .h4 img.emoji, .b3-typography h4 img.emoji {width:${Math.floor(window.siyuan.config.editor.fontSize * 1.25 * 1.25)}px}
.protyle-wysiwyg .h5 img.emoji, .b3-typography h5 img.emoji {width:${Math.floor(window.siyuan.config.editor.fontSize * 1.13 * 1.25)}px}
.protyle-wysiwyg .h6 img.emoji, .b3-typography h6 img.emoji {width:${Math.floor(window.siyuan.config.editor.fontSize * 1.25)}px}`;
    if (window.siyuan.config.editor.fontFamily) {
        style += `.b3-typography, .protyle-wysiwyg, .protyle-title, .protyle-title__input{font-family: "${window.siyuan.config.editor.fontFamily}", "quote", "Helvetica Neue", "Luxi Sans", "DejaVu Sans", "Hiragino Sans GB", "Microsoft Yahei", sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", "Segoe UI Symbol", "Android Emoji", "EmojiSymbols" !important;}`;
    }
    if (set) {
        document.getElementById("editorFontSize").innerHTML = style;
    }
    return style;
};

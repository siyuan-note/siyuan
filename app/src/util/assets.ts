import {Constants} from "../constants";
import {addScript} from "../protyle/util/addScript";
import {addStyle} from "../protyle/util/addStyle";
/// #if !MOBILE
import {ipcRenderer} from "electron";
import {getAllModels} from "../layout/getAll";
import {exportLayout} from "../layout/util";
/// #endif
import {isMobile} from "./functions";
import {fetchPost} from "./fetch";

const loadThirdIcon = (iconURL: string, data: IAppearance) => {
    addScript(iconURL, "iconDefaultScript").then(() => {
        if (!["ant", "material"].includes(data.icon)) {
            const iconScriptElement = document.getElementById("iconScript");
            if (iconScriptElement) {
                iconScriptElement.remove();
            }
            addScript(`/appearance/icons/${data.icon}/icon.js?v=${data.iconVer}`, "iconScript");
        }
    });
};

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
    const localPDF = JSON.parse(localStorage.getItem(Constants.LOCAL_PDFTHEME) || "{}");
    let pdfTheme: string;
    if (window.siyuan.config.appearance.mode === 0) {
        pdfTheme = localPDF.light || "light";
    } else {
        pdfTheme = localPDF.dark || "dark";
    }
    document.querySelectorAll(".pdf__outer").forEach(item => {
        const darkElement = item.querySelector("#pdfDark");
        const lightElement = item.querySelector("#pdfLight");
        if (pdfTheme === "dark") {
            item.classList.add("pdf__outer--dark");
            lightElement.classList.remove("toggled");
            darkElement.classList.add("toggled");
        } else {
            item.classList.remove("pdf__outer--dark");
            lightElement.classList.add("toggled");
            darkElement.classList.remove("toggled");
        }
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

    const iconDefaultScriptElement = document.getElementById("iconDefaultScript");
    // 不能使用 data.iconVer，因为其他主题也需要加载默认图标，此时 data.iconVer 为其他图标的版本号
    const iconURL = `/appearance/icons/${["ant", "material"].includes(data.icon) ? data.icon : "material"}/icon.js?v=${Constants.SIYUAN_VERSION}`;
    if (iconDefaultScriptElement) {
        iconDefaultScriptElement.remove();
        let svgElement = document.body.firstElementChild;
        while (svgElement.tagName === "svg") {
            const currentSvgElement = svgElement;
            svgElement = svgElement.nextElementSibling;
            if (currentSvgElement.id !== "emojiScriptSvg") {
                currentSvgElement.remove();
            }
        }
        loadThirdIcon(iconURL, data);
    } else {
        loadThirdIcon(iconURL, data);
    }
};

export const initAssets = () => {
    const emojiElement = document.getElementById("emojiScript");
    const loadingElement = document.getElementById("loading");
    if (!emojiElement && !window.siyuan.config.appearance.nativeEmoji && !isMobile()) {
        addScript("/appearance/emojis/twitter-emoji.js?v=1.0.1", "emojiScript").then(() => {
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

export const addGA = () => {
    if (!window.siyuan.config.system.disableGoogleAnalytics) {
        addScript("https://www.googletagmanager.com/gtag/js?id=G-L7WEXVQCR9", "gaScript").then(() => {
            try {
                window.dataLayer = window.dataLayer || [];
                window.gtag = function (...args) {
                    window.dataLayer.push(args);
                };
                window.gtag("js", new Date());
                window.gtag("config", "G-L7WEXVQCR9");
                const para = {
                    "version": Constants.SIYUAN_VERSION,
                    "container": window.siyuan.config.system.container,
                    "isLoggedIn": "false",
                    "subscriptionStatus": "-1",
                    "subscriptionPlan": "-1",
                    "subscriptionType": "-1",
                };
                if (window.siyuan.user) {
                    para.isLoggedIn = "true";
                    para.subscriptionStatus = window.siyuan.user.userSiYuanSubscriptionStatus.toString();
                    para.subscriptionPlan = window.siyuan.user.userSiYuanSubscriptionPlan.toString();
                    para.subscriptionType = window.siyuan.user.userSiYuanSubscriptionType.toString();
                }
                window.gtag("event", Constants.ANALYTICS_EVT_ON_GET_CONFIG, para);
            } catch (e) {
                console.error(e);
            }
        });
    }
};

export const setInlineStyle = (set = true) => {
    const height = Math.floor(window.siyuan.config.editor.fontSize * 1.625);
    let style = `.b3-typography, .protyle-wysiwyg, .protyle-title {font-size:${window.siyuan.config.editor.fontSize}px !important}
.b3-typography code:not(.hljs), .protyle-wysiwyg span[data-type~=code] { font-variant-ligatures: ${window.siyuan.config.editor.codeLigatures ? "normal" : "none"} }
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
        style += `.b3-typography:not(.b3-typography--default), .protyle-wysiwyg, .protyle-title, .protyle-title__input{font-family: "${window.siyuan.config.editor.fontFamily}", "quote", "Helvetica Neue", "Luxi Sans", "DejaVu Sans", "Hiragino Sans GB", "Microsoft Yahei", sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", "Segoe UI Symbol", "Android Emoji", "EmojiSymbols" !important;}`;
    }
    if (set) {
        document.getElementById("editorFontSize").innerHTML = style;
    }
    return style;
};

export const setCodeTheme = (cdn = Constants.PROTYLE_CDN) => {
    const protyleHljsStyle = document.getElementById("protyleHljsStyle") as HTMLLinkElement;
    let css;
    if (window.siyuan.config.appearance.mode === 0) {
        css = window.siyuan.config.appearance.codeBlockThemeLight;
        if (!Constants.SIYUAN_CONFIG_APPEARANCE_LIGHT_CODE.includes(css)) {
            css = "default";
        }
    } else {
        css = window.siyuan.config.appearance.codeBlockThemeDark;
        if (!Constants.SIYUAN_CONFIG_APPEARANCE_DARK_CODE.includes(css)) {
            css = "github-dark";
        }
    }
    const href = `${cdn}/js/highlight.js/styles/${css}.min.css?v=11.5.0`;
    if (!protyleHljsStyle) {
        addStyle(href, "protyleHljsStyle");
    } else if (!protyleHljsStyle.href.includes(href)) {
        protyleHljsStyle.remove();
        addStyle(href, "protyleHljsStyle");
    }
};

export const setMode = (modeElementValue: number) => {
    /// #if !MOBILE
    fetchPost("/api/setting/setAppearance", Object.assign({}, window.siyuan.config.appearance, {
        mode: modeElementValue === 2 ? window.siyuan.config.appearance.mode : modeElementValue,
        modeOS: modeElementValue === 2,
    }), response => {
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
        window.siyuan.config.appearance = response.data;
        /// #if !BROWSER
        ipcRenderer.send(Constants.SIYUAN_CONFIG_THEME, response.data.modeOS ? "system" : (response.data.mode === 1 ? "dark" : "light"));
        ipcRenderer.send(Constants.SIYUAN_CONFIG_CLOSE, response.data.closeButtonBehavior);
        /// #endif
        loadAssets(response.data);
        document.querySelector("#barMode use").setAttribute("xlink:href", `#icon${window.siyuan.config.appearance.modeOS ? "Mode" : (window.siyuan.config.appearance.mode === 0 ? "Light" : "Dark")}`);
    });
    /// #endif
};

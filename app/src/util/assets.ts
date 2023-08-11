import {Constants} from "../constants";
import {addScript} from "../protyle/util/addScript";
import {addStyle} from "../protyle/util/addStyle";
/// #if !MOBILE
import {getAllModels} from "../layout/getAll";
import {exportLayout} from "../layout/util";
/// #endif
import {fetchPost} from "./fetch";
import {appearance} from "../config/appearance";

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
    const htmlElement = document.getElementsByTagName("html")[0];
    htmlElement.setAttribute("lang", window.siyuan.config.appearance.lang);
    htmlElement.setAttribute("data-theme-mode", getThemeMode());
    htmlElement.setAttribute("data-light-theme", window.siyuan.config.appearance.themeLight);
    htmlElement.setAttribute("data-dark-theme", window.siyuan.config.appearance.themeDark);
    const OSTheme = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    if (window.siyuan.config.appearance.modeOS && (
        (window.siyuan.config.appearance.mode === 1 && OSTheme === "light") ||
        (window.siyuan.config.appearance.mode === 0 && OSTheme === "dark")
    )) {
        fetchPost("/api/system/setAppearanceMode", {mode: OSTheme === "light" ? 0 : 1});
        window.siyuan.config.appearance.mode = (OSTheme === "light" ? 0 : 1);
    }

    const defaultStyleElement = document.getElementById("themeDefaultStyle");
    let defaultThemeAddress = `/appearance/themes/${data.mode === 1 ? "midnight" : "daylight"}/theme.css?v=${Constants.SIYUAN_VERSION}`;
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
        const themeAddress = `/appearance/themes/${data.mode === 1 ? data.themeDark : data.themeLight}/theme.css?v=${data.themeVer}`;
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
    const pdfTheme = window.siyuan.config.appearance.mode === 0 ? window.siyuan.storage[Constants.LOCAL_PDFTHEME].light :
        window.siyuan.storage[Constants.LOCAL_PDFTHEME].dark;
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
            if (!currentSvgElement.getAttribute("data-name")) {
                currentSvgElement.remove();
            }
        }
        loadThirdIcon(iconURL, data);
    } else {
        loadThirdIcon(iconURL, data);
    }
};

export const initAssets = () => {
    const loadingElement = document.getElementById("loading");
    if (loadingElement) {
        setTimeout(() => {
            loadingElement.remove();
        }, 160);
    }
    updateMobileTheme(window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", event => {
        const OSTheme = event.matches ? "dark" : "light";
        updateMobileTheme(OSTheme);
        if (!window.siyuan.config.appearance.modeOS) {
            return;
        }
        if ((window.siyuan.config.appearance.mode === 0 && OSTheme === "light") ||
            (window.siyuan.config.appearance.mode === 1 && OSTheme === "dark")) {
            return;
        }
        fetchPost("/api/system/setAppearanceMode", {
            mode: OSTheme === "light" ? 0 : 1
        }, response => {
            if (window.siyuan.config.appearance.themeJS) {
                /// #if !MOBILE
                exportLayout({
                    reload: true,
                    onlyData: false,
                    errorExit: false,
                });
                /// #else
                window.location.reload();
                /// #endif
                return;
            }
            window.siyuan.config.appearance = response.data.appearance;
            loadAssets(response.data.appearance);
        });
    });
};

export const addGA = () => {
    if (!window.siyuan.config.system.disableGoogleAnalytics) {
        addScript("https://www.googletagmanager.com/gtag/js?id=G-L7WEXVQCR9", "gaScript");
        window.dataLayer = window.dataLayer || [];
        /*eslint-disable */
        const gtag = function (...args: any[]) {
            window.dataLayer.push(arguments);
        };
        /*eslint-enable */
        gtag("js", new Date());
        gtag("config", "G-L7WEXVQCR9", {send_page_view: false});
        const para = {
            version: Constants.SIYUAN_VERSION,
            container: window.siyuan.config.system.container,
            os: window.siyuan.config.system.os,
            osPlatform: window.siyuan.config.system.osPlatform,
            isLoggedIn: false,
            subscriptionStatus: -1,
            subscriptionPlan: -1,
            subscriptionType: -1,
            syncEnabled: false,
            syncProvider: -1,
            cTreeCount: window.siyuan.config.stat.cTreeCount,
            cBlockCount: window.siyuan.config.stat.cBlockCount,
            cDataSize: window.siyuan.config.stat.cDataSize,
            cAssetsSize: window.siyuan.config.stat.cAssetsSize,
        };
        if (window.siyuan.user) {
            para.isLoggedIn = true;
            para.subscriptionStatus = window.siyuan.user.userSiYuanSubscriptionStatus;
            para.subscriptionPlan = window.siyuan.user.userSiYuanSubscriptionPlan;
            para.subscriptionType = window.siyuan.user.userSiYuanSubscriptionType;
        }
        if (window.siyuan.config.sync) {
            para.syncEnabled = window.siyuan.config.sync.enabled;
            para.syncProvider = window.siyuan.config.sync.provider;
        }
        gtag("event", Constants.ANALYTICS_EVT_ON_GET_CONFIG, para);
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
.protyle-wysiwyg [data-node-id].li:before {height: calc(100% - ${height + 8}px);top:${(height + 8)}px}
.protyle-wysiwyg [data-node-id] [spellcheck] {min-height:${height}px;}
.protyle-wysiwyg [data-node-id] {${window.siyuan.config.editor.rtl ? " direction: rtl;" : ""}${window.siyuan.config.editor.justify ? " text-align: justify;" : ""}}
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
        style += `\n.b3-typography:not(.b3-typography--default), .protyle-wysiwyg, .protyle-title, .protyle-title__input{font-family: "${window.siyuan.config.editor.fontFamily}", "Helvetica Neue", "Luxi Sans", "DejaVu Sans", "Hiragino Sans GB", "Microsoft Yahei", sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", "Segoe UI Symbol", "Android Emoji", "EmojiSymbols" !important;}`;
    }
    // pad 端菜单移除显示，如工作空间
    if ("ontouchend" in document) {
        style += "\n.b3-menu .b3-menu__action {opacity: 0.68;}";
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
        if (window.siyuan.config.appearance.themeJS) {
            if (!response.data.modeOS && (
                response.data.mode !== window.siyuan.config.appearance.mode ||
                window.siyuan.config.appearance.themeLight !== response.data.themeLight ||
                window.siyuan.config.appearance.themeDark !== response.data.themeDark
            )) {
                exportLayout({
                    reload: true,
                    onlyData: false,
                    errorExit: false,
                });
                return;
            }
            const OSTheme = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
            if (response.data.modeOS && (
                (response.data.mode === 1 && OSTheme === "light") || (response.data.mode === 0 && OSTheme === "dark")
            )) {
                exportLayout({
                    reload: true,
                    onlyData: false,
                    errorExit: false,
                });
                return;
            }
        }
        appearance.onSetappearance(response.data);
    });
    /// #endif
};

const updateMobileTheme = (OSTheme: string) => {
    if ((window.siyuan.config.system.container === "ios" && window.webkit?.messageHandlers) ||
        (window.siyuan.config.system.container === "android" && window.JSAndroid)) {
        setTimeout(() => {
            const backgroundColor = getComputedStyle(document.body).getPropertyValue("--b3-theme-background").trim();
            let mode = window.siyuan.config.appearance.mode;
            if (window.siyuan.config.appearance.modeOS) {
                if (OSTheme === "dark") {
                    mode = 1;
                } else {
                    mode = 0;
                }
            }
            if (window.siyuan.config.system.container === "ios" && window.webkit?.messageHandlers) {
                window.webkit.messageHandlers.changeStatusBar.postMessage((backgroundColor || (mode === 0 ? "#fff" : "#1e1e1e")) + " " + mode);
            } else if (window.siyuan.config.system.container === "android" && window.JSAndroid) {
                window.JSAndroid.changeStatusBarColor(backgroundColor, mode);
            }
        }, 500); // 移动端需要加载完才可以获取到颜色
    }
};

export const getThemeMode = () => {
    const OSTheme = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    if (window.siyuan.config.appearance.modeOS) {
        return OSTheme;
    } else {
        return window.siyuan.config.appearance.mode === 0 ? "light" : "dark";
    }
};

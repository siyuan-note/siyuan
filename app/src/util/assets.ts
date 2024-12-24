import {Constants} from "../constants";
import {addScript} from "../protyle/util/addScript";
import {addStyle} from "../protyle/util/addStyle";
/// #if !MOBILE
import {getAllModels} from "../layout/getAll";
import {exportLayout} from "../layout/util";
/// #endif
import {fetchPost} from "./fetch";
import {appearance} from "../config/appearance";
import {isInAndroid, isInHarmony, isInIOS, isIPad, isIPhone, isMac, isWin11} from "../protyle/util/compatibility";

const loadThirdIcon = (iconURL: string, data: Config.IAppearance) => {
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

export const loadAssets = (data: Config.IAppearance) => {
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
    const defaultThemeAddress = `/appearance/themes/${data.mode === 1 ? "midnight" : "daylight"}/theme.css?v=${Constants.SIYUAN_VERSION}`;
    if (defaultStyleElement) {
        if (!defaultStyleElement.getAttribute("href").startsWith(defaultThemeAddress)) {
            defaultStyleElement.setAttribute("href", defaultThemeAddress);
        }
    } else {
        addStyle(defaultThemeAddress, "themeDefaultStyle");
    }
    const styleElement = document.getElementById("themeStyle");
    if ((data.mode === 1 && data.themeDark !== "midnight") || (data.mode === 0 && data.themeLight !== "daylight")) {
        const themeAddress = `/appearance/themes/${data.mode === 1 ? data.themeDark : data.themeLight}/theme.css?v=${data.themeVer}`;
        if (styleElement) {
            if (!styleElement.getAttribute("href").startsWith(themeAddress)) {
                styleElement.setAttribute("href", themeAddress);
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
        // https://github.com/siyuan-note/siyuan/issues/10341
        themeScriptElement.remove();
    }
    addScript(themeScriptAddress, "themeScript");

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
                    /// #if !MOBILE
                    exportLayout({
                        cb() {
                            window.location.reload();
                        },
                        errorExit: false,
                    });
                    /// #else
                    window.location.reload();
                    /// #endif
                    return;
                }
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
            oneTimePayStatus: -1,
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
            para.oneTimePayStatus = window.siyuan.user.userSiYuanOneTimePayStatus;
        }
        if (window.siyuan.config.sync) {
            para.syncEnabled = window.siyuan.config.sync.enabled;
            para.syncProvider = window.siyuan.config.sync.provider;
        }
        gtag("event", Constants.ANALYTICS_EVT_ON_GET_CONFIG, para);
    }
};

export const setInlineStyle = async (set = true) => {
    const height = Math.floor(window.siyuan.config.editor.fontSize * 1.625);
    let style;

    // Emojis Reset: 字体中包含了 emoji，需重置
    // Emojis Additional： 苹果/win11 字体中没有的 emoji
    if (isMac() || isIPad() || isIPhone()) {
        style = `@font-face {
  font-family: "Emojis Additional";
  src: url(../../../appearance/fonts/Noto-COLRv1-2.047/Noto-COLRv1.woff2) format("woff2");
  unicode-range: U+1fae9, U+1fac6, U+1fabe, U+1fadc, U+e50a, U+1fa89, U+1fadf, U+1f1e6-1f1ff, U+1fa8f;
}
@font-face {
  font-family: "Emojis Reset";
  src: local("Apple Color Emoji"),
  local("Segoe UI Emoji"),
  local("Segoe UI Symbol");
  unicode-range: U+26a1, U+21a9, U+21aa, U+2708, U+263a, U+1fae4, U+2194-2199, U+2934-2935, U+25b6, U+25c0, U+23cf,
  U+2640, U+2642, U+2611, U+303d,U+3030, U+1f170, U+1f171, U+24c2, U+1f17e, U+1f17f, U+1f250, U+1f21a, U+1f22f,
  U+1f232-1f23a, U+1f251, U+3297, U+3299, U+2639, U+2660, U+2666, U+2665, U+2663, U+26A0, U+a9, U+ae, U+2122;
}
@font-face {
  font-family: "Emojis";
  src: local("Apple Color Emoji"),
  local("Segoe UI Emoji"),
  local("Segoe UI Symbol");
}`;
    } else {
        const isWin11Browser = await isWin11();
        if (isWin11Browser) {
            style = `@font-face {
  font-family: "Emojis Additional";
  src: url(../../../appearance/fonts/Noto-COLRv1-2.047/Noto-COLRv1.woff2) format("woff2");
  unicode-range: U+1fae9, U+1fac6, U+1fabe, U+1fadc, U+e50a, U+1fa89, U+1fadf, U+1f1e6-1f1ff, U+1f3f4, U+e0067, U+e0062,
  U+e0065, U+e006e, U+e0067, U+e007f, U+e0073, U+e0063, U+e0074, U+e0077, U+e006c;
}
@font-face {
  font-family: "Emojis Reset";
  src: local("Segoe UI Emoji"),
  local("Segoe UI Symbol");
  unicode-range: U+263a, U+21a9, U+2642, U+303d, U+2197, U+2198, U+2199, U+2196, U+2195, U+2194, U+2660, U+2665, U+2666, 
  U+2663, U+3030, U+21aa, U+25b6, U+25c0, U+2640, U+203c, U+a9, U+ae, U+2122;;
}
@font-face {
  font-family: "Emojis";
  src: local("Segoe UI Emoji"),
  local("Segoe UI Symbol");
}`;
        } else {
            style = `@font-face {
  font-family: "Emojis Reset";
  src: url(../../../appearance/fonts/Noto-COLRv1-2.047/Noto-COLRv1.woff2) format("woff2");
  unicode-range: U+263a, U+2194-2199, U+2934-2935, U+2639, U+26a0, U+25b6, U+25c0, U+23cf, U+2640, U+2642, U+203c, U+2049,
  U+2611, U+303d, U+1f170-1f171, U+24c2, U+1f17e, U+1f17f, U+1f22f, U+1f250, U+1f21a, U+1f232-1f23a, U+1f251, U+3297,
  U+3299, U+25aa, U+25ab, U+2660, U+2666, U+2665, U+2663, U+1f636, U+1f62e, U+1f642, U+1f635, U+2620, U+2763, U+2764,
  U+1f441, U+fe0f, U+1f5e8, U+270c, U+261d, U+270d, U+200d, U+e50a, U+3030, U+21aa, U+21a9, U+1f525, U+1fa79, U+1f4ab, 
  U+1f4a8, U+1f32b, U+a9, U+ae, U+2122;;
}
@font-face {
  font-family: "Emojis";
  src: url(../../../appearance/fonts/Noto-COLRv1-2.047/Noto-COLRv1.woff2) format("woff2"),
  local("Segoe UI Emoji"),
  local("Segoe UI Symbol"),
  local("Apple Color Emoji"),
  local("Twemoji Mozilla"),
  local("Noto Color Emoji"),
  local("Android Emoji"),
  local("EmojiSymbols");
}`;
        }
    }
    style += `.b3-typography, .protyle-wysiwyg, .protyle-title {font-size:${window.siyuan.config.editor.fontSize}px !important}
.b3-typography code:not(.hljs), .protyle-wysiwyg span[data-type~=code] { font-variant-ligatures: ${window.siyuan.config.editor.codeLigatures ? "normal" : "none"} }
.li > .protyle-action {height:${height + 8}px;line-height: ${height + 8}px}
.protyle-wysiwyg [data-node-id].li > .protyle-action ~ .h1, .protyle-wysiwyg [data-node-id].li > .protyle-action ~ .h2, .protyle-wysiwyg [data-node-id].li > .protyle-action ~ .h3, .protyle-wysiwyg [data-node-id].li > .protyle-action ~ .h4, .protyle-wysiwyg [data-node-id].li > .protyle-action ~ .h5, .protyle-wysiwyg [data-node-id].li > .protyle-action ~ .h6 {line-height:${height + 8}px;}
.protyle-wysiwyg [data-node-id].li > .protyle-action::after {height: ${window.siyuan.config.editor.fontSize}px;width: ${window.siyuan.config.editor.fontSize}px;margin:-${window.siyuan.config.editor.fontSize / 2}px 0 0 -${window.siyuan.config.editor.fontSize / 2}px}
.protyle-wysiwyg [data-node-id].li > .protyle-action svg {height: ${Math.max(14, window.siyuan.config.editor.fontSize - 8)}px}
.protyle-wysiwyg [data-node-id].li::before {height: calc(100% - ${height + 8}px);top:${(height + 8)}px}
.protyle-wysiwyg [data-node-id] [spellcheck] {min-height:${height}px;}
.protyle-wysiwyg .p,
.protyle-wysiwyg .code-block .hljs,
.protyle-wysiwyg .table,
.protyle-wysiwyg .render-node protyle-html,
.protyle-wysiwyg .render-node > div[spin="1"],
.protyle-wysiwyg [data-type="NodeHeading"] {${window.siyuan.config.editor.rtl ? " direction: rtl;" : ""}}
.protyle-wysiwyg [data-node-id] {${window.siyuan.config.editor.justify ? " text-align: justify;" : ""}}
.protyle-wysiwyg .li {min-height:${height + 8}px}
.protyle-gutters button svg {height:${height}px}`;
    if (window.siyuan.config.editor.fontFamily) {
        style += `\n.b3-typography:not(.b3-typography--default), .protyle-wysiwyg, .protyle-title {font-family: "Emojis Additional", "Emojis Reset", "${window.siyuan.config.editor.fontFamily}", var(--b3-font-family)}`;
    }
    // pad 端菜单移除显示，如工作空间
    if ("ontouchend" in document) {
        style += "\n.b3-menu .b3-menu__action {opacity: 0.68;}";
    }
    if (set) {
        const siyuanStyle = document.getElementById("siyuanStyle");
        if (siyuanStyle) {
            siyuanStyle.innerHTML = style;
        } else {
            document.querySelector("#pluginsStyle").insertAdjacentHTML("beforebegin", `<style id="siyuanStyle">${style}</style>`);
        }
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
    }), async response => {
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
                        cb() {
                            window.location.reload();
                        },
                        errorExit: false,
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
    });
    /// #endif
};

const rgba2hex = (rgba: string) => {
    if (rgba.startsWith("#")) {
        return rgba;
    }
    let a: any;
    const rgb: any = rgba.replace(/\s/g, "").match(/^rgba?\((\d+),(\d+),(\d+),?([^,\s)]+)?/i);
    const alpha = (rgb && rgb[4] || "").trim();
    let hex = rgb ?
        (rgb[1] | 1 << 8).toString(16).slice(1) +
        (rgb[2] | 1 << 8).toString(16).slice(1) +
        (rgb[3] | 1 << 8).toString(16).slice(1) : rgba;

    if (alpha !== "") {
        a = alpha;
    } else {
        a = 0o1;
    }
    a = ((a * 255) | 1 << 8).toString(16).slice(1);
    hex = hex + a;
    return hex;
};

const updateMobileTheme = (OSTheme: string) => {
    if (isInIOS() || isInAndroid() || isInHarmony()) {
        setTimeout(() => {
            const backgroundColor = rgba2hex(getComputedStyle(document.body).getPropertyValue("--b3-theme-background").trim());
            let mode = window.siyuan.config.appearance.mode;
            if (window.siyuan.config.appearance.modeOS) {
                if (OSTheme === "dark") {
                    mode = 1;
                } else {
                    mode = 0;
                }
            }
            if (isInIOS()) {
                window.webkit.messageHandlers.changeStatusBar.postMessage((backgroundColor || (mode === 0 ? "#fff" : "#1e1e1e")) + " " + mode);
            } else if (isInAndroid()) {
                window.JSAndroid.changeStatusBarColor(backgroundColor, mode);
            } else if (isInHarmony()) {
                window.JSHarmony.changeStatusBarColor(backgroundColor, mode);
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

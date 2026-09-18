import {Constants} from "../constants";
import {getBodyGradientImage} from "./bodyGradient";
import {addScript} from "../protyle/util/addScript";
import {addStyle} from "../protyle/util/addStyle";
import {getAllEditor, getAllModels} from "../layout/getAll";
import {invalidateHeadingNumberMeasurements} from "../protyle/util/headingNumberCore";
import {renderHeadingNumbers} from "../protyle/util/headingNumber";
/// #if !MOBILE
import {exportLayout} from "../layout/util";
/// #endif
import {fetchPost} from "./fetch";
import {
    isInAndroid,
    isInHarmony,
    isInIOS,
    isInMobileApp,
    isIPad,
    isIPhone,
    isMac,
    isWin11
} from "../protyle/util/compatibility";
import {setCodeTheme} from "../protyle/render/util";
import {getBackend, getFrontend} from "./functions";
import {getWorkspaceName} from "./processTitle";
import {ensureSelectedCustomFonts, getExportCustomFontStyle} from "./customFont";
import {getGlobalFontStyle} from "./globalFont";
import {getEmojiFontStyle} from "./emojiFont";
import {isCurrentThemeSupported, shouldUnloadThemeScript} from "./themeCompatibility";
import {
    getInlineStylesCSS,
    loadInlineStyles
} from "../protyle/toolbar/inlineStyle";
import {refreshChartTheme} from "../protyle/render/chartRender";
import {getHostCapabilities} from "./hostCapabilities";

let headingNumberMeasurementRefreshTimer: number;
let appearanceUpdate = Promise.resolve();
let appearanceReloadPending = false;
const appearancePackageRevisions = new Map<string, string>();

// 串行应用外观变更，等待脚本加载和卸载完成后再处理下一次推送。
export const enqueueAppearanceUpdate = (apply: () => Promise<void>) => {
    appearanceUpdate = appearanceUpdate.then(async () => {
        if (!appearanceReloadPending) {
            await apply();
        }
    }).catch(error => {
        console.error("apply appearance error: " + error);
    });
    return appearanceUpdate;
};

export const markAppearanceReloadPending = () => {
    appearanceReloadPending = true;
};

export const invalidateAppearancePackages = (themes: string[], icons: string[], revision: string) => {
    const changed = {
        themes: themes.filter(name => appearancePackageRevisions.get(`themes/${name}`) !== revision),
        icons: icons.filter(name => appearancePackageRevisions.get(`icons/${name}`) !== revision),
    };
    themes.forEach(name => appearancePackageRevisions.set(`themes/${name}`, revision));
    icons.forEach(name => appearancePackageRevisions.set(`icons/${name}`, revision));
    return changed;
};

const appearancePackageVersion = (kind: "themes" | "icons", name: string, version: string) => {
    const revision = appearancePackageRevisions.get(`${kind}/${name}`);
    return encodeURIComponent(version) + (revision ? `&revision=${encodeURIComponent(revision)}` : "");
};

export const refreshHeadingNumberMeasurements = () => {
    invalidateHeadingNumberMeasurements();
    getAllEditor().forEach(item => renderHeadingNumbers(item.protyle));
};

const scheduleHeadingNumberMeasurementRefresh = (styleElements: HTMLLinkElement[]) => {
    const schedule = (delay = 0) => {
        window.clearTimeout(headingNumberMeasurementRefreshTimer);
        headingNumberMeasurementRefreshTimer = window.setTimeout(refreshHeadingNumberMeasurements, delay);
    };
    styleElements.forEach(item => {
        item.addEventListener("load", () => schedule(), {once: true});
        item.addEventListener("error", () => schedule(), {once: true});
    });
    schedule(styleElements.length > 0 ? Constants.TIMEOUT_LOAD : 0);
};

const getThemeScriptElements = () => Array.from(document.querySelectorAll<HTMLScriptElement>(
    "script[src*='/appearance/themes/'][src*='/theme.js']"
));

const removeThemeScriptElements = () => {
    getThemeScriptElements().forEach((item) => item.remove());
};

export const unloadThemeScript = async () => {
    const themeScriptElement = document.getElementById("themeScript");
    const themeScriptElements = getThemeScriptElements();
    if (!themeScriptElement && !window.destroyTheme) {
        themeScriptElements.forEach((item) => item.remove());
        return true;
    }
    if (!window.destroyTheme) {
        return false;
    }
    try {
        await window.destroyTheme();
        window.destroyTheme = undefined;
        themeScriptElement?.remove();
        removeThemeScriptElements();
        return true;
    } catch (error) {
        console.error("destroyTheme error: " + error);
        return false;
    }
};

export const refreshThemeStyle = (themeAddress: string) => {
    if (!getHostCapabilities().customAppearance) {
        return;
    }
    const appearance = window.siyuan.config.appearance;
    if (!isCurrentThemeSupported(appearance, getFrontend())) {
        return;
    }
    const isCustomTheme = (appearance.mode === 1 && appearance.themeDark !== "midnight") ||
        (appearance.mode === 0 && appearance.themeLight !== "daylight");
    const styleElement = document.getElementById(isCustomTheme ? "themeStyle" : "themeDefaultStyle") as HTMLLinkElement;
    if (styleElement) {
        styleElement.href = themeAddress;
    }
};

export const loadAssets = async (appearance: Config.IAppearance) => {
    const scriptLoads: Promise<unknown>[] = [];
    setBodyHighlight(appearance.bodyGradient);
    const data = getHostCapabilities().customAppearance ? appearance : {
        ...appearance,
        themeLight: "daylight",
        themeDark: "midnight",
        icon: "litheness",
        themeJS: false,
    };
    const changedThemeStyleElements: HTMLLinkElement[] = [];
    let themeStylesChanged = false;
    const htmlElement = document.getElementsByTagName("html")[0];
    const previousThemeMode = htmlElement.getAttribute("data-theme-mode");
    const themeMode = getThemeMode();
    htmlElement.setAttribute("lang", window.siyuan.config.appearance.lang);
    htmlElement.setAttribute("data-frontend", getFrontend()); // https://github.com/siyuan-note/siyuan/issues/12549
    htmlElement.setAttribute("data-backend", getBackend());
    htmlElement.setAttribute("data-theme-mode", themeMode);
    htmlElement.setAttribute("data-light-theme", data.themeLight);
    htmlElement.setAttribute("data-dark-theme", data.themeDark);
    const OSTheme = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    if (window.siyuan.config.appearance.modeOS && (
        (window.siyuan.config.appearance.mode === 1 && OSTheme === "light") ||
        (window.siyuan.config.appearance.mode === 0 && OSTheme === "dark")
    )) {
        fetchPost("/api/system/setAppearanceMode", {mode: OSTheme === "light" ? 0 : 1});
        window.siyuan.config.appearance.mode = (OSTheme === "light" ? 0 : 1);
    }
    if (previousThemeMode && previousThemeMode !== themeMode) {
        refreshChartTheme(document.body);
    }
    const defaultStyleElement = document.getElementById("themeDefaultStyle");
    const defaultThemeAddress = `/appearance/themes/${data.mode === 1 ? "midnight" : "daylight"}/theme.css?v=${Constants.SIYUAN_VERSION}`;
    if (defaultStyleElement) {
        if (!defaultStyleElement.getAttribute("href").startsWith(defaultThemeAddress)) {
            const newStyleElement = document.createElement("link");
            changedThemeStyleElements.push(newStyleElement);
            themeStylesChanged = true;
            // 等待新样式表加载完成再移除旧样式表
            new Promise((resolve) => {
                newStyleElement.rel = "stylesheet";
                newStyleElement.href = defaultThemeAddress;
                newStyleElement.onload = resolve;
                defaultStyleElement.parentNode.insertBefore(newStyleElement, defaultStyleElement);
            }).then(() => {
                defaultStyleElement.remove();
                newStyleElement.id = "themeDefaultStyle";
            });
        }
    } else {
        addStyle(defaultThemeAddress, "themeDefaultStyle");
        changedThemeStyleElements.push(document.getElementById("themeDefaultStyle") as HTMLLinkElement);
        themeStylesChanged = true;
    }
    const styleElement = document.getElementById("themeStyle");
    const themeSupported = isCurrentThemeSupported(data, getFrontend());
    if (themeSupported && ((data.mode === 1 && data.themeDark !== "midnight") ||
        (data.mode === 0 && data.themeLight !== "daylight"))) {
        const themeName = data.mode === 1 ? data.themeDark : data.themeLight;
        const themeAddress = `/appearance/themes/${themeName}/theme.css?v=${appearancePackageVersion("themes", themeName, data.themeVer)}`;
        if (styleElement) {
            if (styleElement.getAttribute("href") !== themeAddress) {
                changedThemeStyleElements.push(styleElement as HTMLLinkElement);
                themeStylesChanged = true;
                styleElement.setAttribute("href", themeAddress);
            }
        } else {
            addStyle(themeAddress, "themeStyle");
            changedThemeStyleElements.push(document.getElementById("themeStyle") as HTMLLinkElement);
            themeStylesChanged = true;
        }
    } else if (styleElement) {
        styleElement.remove();
        themeStylesChanged = true;
    }
    if (themeStylesChanged) {
        scheduleHeadingNumberMeasurementRefresh(changedThemeStyleElements);
    }
    updateMobileTheme(OSTheme);
    /// #if !MOBILE
    getAllModels().graph.forEach(item => {
        item.searchGraph();
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

    /// #if BROWSER
    if (!window.webkit?.messageHandlers && !window.JSAndroid && !window.JSHarmony &&
        ("serviceWorker" in window.navigator) && ("caches" in window) && ("fetch" in window) && navigator.serviceWorker) {
        document.head.insertAdjacentHTML("afterbegin", `<meta name="theme-color" content="${getComputedStyle(document.body).getPropertyValue("--b3-body-background").trim()}">`);
    }
    /// #endif
    setCodeTheme();

    const themeName = data.mode === 1 ? data.themeDark : data.themeLight;
    const themeScriptAddress = `/appearance/themes/${themeName}/theme.js?v=${appearancePackageVersion("themes", themeName, data.themeVer)}`;
    const themeScriptURL = new URL(themeScriptAddress, window.location.href).href;
    const themeScriptElements = getThemeScriptElements();
    if (!data.themeJS || !themeSupported) {
        removeThemeScriptElements();
    } else if (!themeScriptElements.some((item) => item.src === themeScriptURL)) {
        removeThemeScriptElements();
        scriptLoads.push(addScript(themeScriptAddress, "themeScript"));
    }

    // load icons
    const iconName = data.icon === "litheness" || data.icons?.some(icon => icon.name === data.icon) ? data.icon : "litheness";
    const isBuiltInIcon = iconName === "litheness";
    const iconScriptElement = document.getElementById("iconScript");
    const iconDefaultScriptElement = document.getElementById("iconDefaultScript");
    // 不能使用 data.iconVer，因为其他主题也需要加载默认图标，此时 data.iconVer 为其他图标的版本号
    const iconDefaultURL = `/appearance/icons/litheness/icon.js?v=${Constants.SIYUAN_VERSION}`;
    const iconThirdURL = `/appearance/icons/${iconName}/icon.js?v=${appearancePackageVersion("icons", iconName, data.iconVer)}`;

    if ((isBuiltInIcon && iconDefaultScriptElement && iconDefaultScriptElement.getAttribute("src").startsWith(iconDefaultURL)) ||
        (!isBuiltInIcon && iconScriptElement && iconScriptElement.getAttribute("src") === iconThirdURL)) {
        // 第三方图标切换到默认 litheness
        if (isBuiltInIcon) {
            iconScriptElement?.remove();
            Array.from(document.body.children).forEach((item) => {
                if (item.tagName === "svg" && !item.getAttribute("data-name") && "iconsLitheness" !== item.id) {
                    item.remove();
                }
            });
        }
        await Promise.all(scriptLoads);
        return;
    }
    scriptLoads.push(addScript(iconDefaultURL, "iconDefaultScript").then(async () => {
        iconScriptElement?.remove();
        if (!isBuiltInIcon) {
            await addScript(iconThirdURL, "iconScript");
            Array.from(document.body.children).forEach((item, index) => {
                if (item.tagName === "svg" &&
                    index !== 0 && !item.getAttribute("data-name") && "iconsLitheness" !== item.id) {
                    item.remove();
                }
            });
        }
    }));
    await Promise.all(scriptLoads);
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
            void enqueueAppearanceUpdate(async () => {
                const nextAppearance = response.data.appearance as Config.IAppearance;
                if (shouldUnloadThemeScript(window.siyuan.config.appearance, nextAppearance, getFrontend()) &&
                    !await unloadThemeScript()) {
                    markAppearanceReloadPending();
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
                window.siyuan.config.appearance = nextAppearance;
                await loadAssets(nextAppearance);
            });
        });
    });
};

export const setInlineStyle = async (set = true, servePath = "../../../") => {
    const allowCustomAppearance = getHostCapabilities().customAppearance;
    const globalFonts = allowCustomAppearance ? window.siyuan.config.appearance.globalFontFamilies || [] : [];
    const editorFonts = allowCustomAppearance ? window.siyuan.config.editor.fontFamilies || [] : [];
    const codeFonts = allowCustomAppearance ? window.siyuan.config.editor.codeFontFamilies || [] : [];
    let inlineStylesCSS = "";
    if (allowCustomAppearance) {
        try {
            const inlineStyles = await loadInlineStyles();
            inlineStylesCSS = getInlineStylesCSS(inlineStyles);
        } catch (error) {
            console.error("load inline styles error: " + error);
            inlineStylesCSS = getInlineStylesCSS();
        }
    }
    if (set && allowCustomAppearance) {
        await ensureSelectedCustomFonts([...globalFonts, ...editorFonts, ...codeFonts]);
    }
    const emojiPlatform = isMac() || isIPad() || isIPhone() ? "apple" : await isWin11() ? "windows11" : "other";
    let style = getEmojiFontStyle(emojiPlatform, servePath);
    style += getGlobalFontStyle(globalFonts);
    if (!set) {
        style += "\n" + await getExportCustomFontStyle([...globalFonts, ...editorFonts, ...codeFonts]);
    }
    const editorFontFamilies = editorFonts.map((font) => CSS.escape(font.family)).join(", ");
    const editorFontWeight = editorFonts[0]?.weight;
    const codeFontFamilies = codeFonts.map((font) => CSS.escape(font.family)).join(", ");
    const codeFontFamily = codeFontFamilies ?
        `var(--b3-font-family-emoji-reset), ${codeFontFamilies}, var(--b3-font-family-code)` :
        "var(--b3-font-family-code)";
    const codeFontWeight = codeFonts[0]?.weight || 400;
    style += `\n:root { --b3-font-size-editor: ${window.siyuan.config.editor.fontSize}px; --b3-font-family-editor: ${editorFontFamilies || "var(--b3-font-family-protyle)"}; --b3-font-family-editor-code: ${codeFontFamily}; --b3-font-weight-editor-code: ${codeFontWeight} }
.b3-typography code:not(.hljs), .protyle-wysiwyg span[data-type~=code] { font-variant-ligatures: ${window.siyuan.config.editor.codeLigatures ? "normal" : "none"} }
.b3-typography:not(.b3-typography--default) code:not(.hljs), .protyle-wysiwyg span[data-type~=code] { font-family: var(--b3-font-family-editor-code); font-weight: var(--b3-font-weight-editor-code) }${window.siyuan.config.editor.justify ? "\n.protyle-wysiwyg [data-node-id] { text-align: justify }" : ""}`;
    if (editorFontFamilies) {
        style += `\n.b3-typography:not(.b3-typography--default), .protyle-wysiwyg, .protyle-title {${editorFontWeight ? `font-weight: ${editorFontWeight};` : ""}font-family: var(--b3-font-family-emoji-reset), var(--b3-font-family-editor), var(--b3-font-family)}`;
    }
    // pad 端菜单移除显示，如工作空间
    if ("ontouchend" in document) {
        style += "\n.b3-menu .b3-menu__action {opacity: 0.68;}";
    }
    style += inlineStylesCSS ? "\n" + inlineStylesCSS : "";
    if (set) {
        const siyuanStyle = document.getElementById("siyuanStyle");
        if (siyuanStyle) {
            siyuanStyle.innerHTML = style;
        } else {
            const pluginsStyle = document.getElementById("pluginsStyle");
            if (pluginsStyle) {
                pluginsStyle.insertAdjacentHTML("beforebegin", `<style id="siyuanStyle">${style}</style>`);
            } else {
                document.head.insertAdjacentHTML("beforeend", `<style id="siyuanStyle">${style}</style>`);
            }
        }
    }
    return style;
};

export const reloadInlineStyles = async () => {
    if (!getHostCapabilities().customAppearance) {
        return;
    }
    try {
        await loadInlineStyles(true);
    } catch (error) {
        console.error("reload inline styles error: " + error);
    }
    await setInlineStyle();
};

export const setMode = (modeElementValue: number) => {
    /// #if !MOBILE
    let mode = modeElementValue;
    if (modeElementValue === 2) {
        if (window.matchMedia("(prefers-color-scheme: dark)").matches) {
            mode = 1;
        } else {
            mode = 0;
        }
    }
    fetchPost("/api/setting/setAppearance", {
        ...window.siyuan.config.appearance,
        mode,
        modeOS: modeElementValue === 2,
    });
    /// #endif
};

const padHex = (n: number) => (n | 256).toString(16).slice(1);

const rgbaToHex = (rgba: string) => {
    const rgb = rgba.replace(/\s/g, "").match(/^rgba?\((\d+),(\d+),(\d+)(?:,([^)]+))?\)$/i);
    if (!rgb) {
        return "";
    }
    const alpha = rgb[4] !== undefined ? parseFloat(rgb[4]) : 1;
    if (alpha === 0) {
        return "";
    }
    return "#" +
        padHex(parseInt(rgb[1], 10)) +
        padHex(parseInt(rgb[2], 10)) +
        padHex(parseInt(rgb[3], 10)) +
        padHex(Math.round(alpha * 255));
};

const cssVarToRgba = (varName: string) => {
    const probe = document.createElement("div");
    probe.style.display = "none";
    probe.style.backgroundColor = `var(${varName})`;
    document.documentElement.appendChild(probe);
    const rgba = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return rgba;
};

const updateMobileTheme = (OSTheme: string) => {
    if (isInMobileApp()) {
        setTimeout(() => {
            let mode = window.siyuan.config.appearance.mode;
            if (window.siyuan.config.appearance.modeOS) {
                if (OSTheme === "dark") {
                    mode = 1;
                } else {
                    mode = 0;
                }
            }
            const fallback = mode === 0 ? "#ffffffff" : "#1e1e1eff";
            const backgroundColor = rgbaToHex(cssVarToRgba("--b3-theme-background")) || fallback;
            // 统一传 #RRGGBBAA：iOS 按 #RRGGBBAA 解析，Android / Harmony 将 #RRGGBBAA 转为 #AARRGGBB
            if (isInIOS()) {
                window.webkit.messageHandlers.changeStatusBar.postMessage(backgroundColor + " " + mode);
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

export const setBodyHighlight = (gradient = window.siyuan.config.appearance.bodyGradient) => {
    const image = getBodyGradientImage(gradient, getThemeMode());
    if (image) {
        document.documentElement.style.setProperty("--b3-body-background-gradient", image);
    } else {
        document.documentElement.style.removeProperty("--b3-body-background-gradient");
    }
    const name = getWorkspaceName();
    if (!name) {
        return;
    }

    // 预定义颜色：赤橙黄绿青蓝紫（提高饱和度和亮度）
    const colors = [
        {h: 0, s: 85, l: 50},    // 赤 - 鲜艳红
        {h: 30, s: 90, l: 52},   // 橙 - 亮橙色
        {h: 50, s: 88, l: 50},   // 黄 - 金黄色
        {h: 140, s: 80, l: 48},  // 绿 - 翠绿色
        {h: 185, s: 85, l: 50},  // 青 - 亮青色
        {h: 230, s: 82, l: 52},  // 蓝 - 宝蓝色
        {h: 280, s: 85, l: 50},  // 紫 - 亮紫色
    ];

    let hue, saturation, lightness;

    if (name === "SiYuan") {
        // SiYuan 专用：更艳丽的紫色
        hue = 280;
        saturation = 85;
        lightness = 48;
    } else {
        // 根据工作空间名生成稳定的索引
        let hash = 0;
        for (let i = 0; i < name.length; i++) {
            hash = (hash << 5) - hash + name.charCodeAt(i);
            hash |= 0;
        }

        const index = Math.abs(hash) % colors.length;
        const color = colors[index];
        hue = color.h;
        saturation = color.s;
        lightness = color.l;
    }

    document.documentElement.style.setProperty(
        "--b3-body-background-hl",
        `${hue}, ${saturation}%, ${lightness}%`
    );
};

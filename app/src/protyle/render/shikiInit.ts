import {addScript} from "../util/addScript";
import {Constants} from "../../constants";

let initPromise: Promise<void> | null = null;

const SHIKI_VERSION = "4.0.2";

const DEFAULT_LANGS = [
    "javascript", "typescript", "java", "python", "go", "rust", "c", "cpp",
    "csharp", "html", "css", "json", "yaml", "markdown", "sql", "shell",
    "bash", "xml", "php", "ruby", "swift", "kotlin", "dart", "lua",
    "plaintext"
];

const getShikiTheme = () => {
    if (window.siyuan.config.appearance.mode === 0) {
        return window.siyuan.config.appearance.codeBlockThemeLight || "github-light";
    }
    return window.siyuan.config.appearance.codeBlockThemeDark || "github-dark";
};

export const initShiki = (): Promise<void> => {
    if (window.siyuanShiki?.highlighter) {
        const theme = getShikiTheme();
        if (!window.siyuanShiki.loadedThemes.has(theme)) {
            const themeData = window.shiki.bundledThemes[theme];
            return window.siyuanShiki.highlighter.loadTheme(themeData).then(() => {
                window.siyuanShiki.loadedThemes.add(theme);
            });
        }
        return Promise.resolve();
    }

    if (initPromise) {
        return initPromise;
    }

    initPromise = addScript(
        `${Constants.PROTYLE_CDN}/js/shiki/shiki.min.js?v=${SHIKI_VERSION}`,
        "protyleShikiScript"
    ).then(() => {
        const theme = getShikiTheme();
        const {bundledLanguages, bundledThemes} = window.shiki;
        const langsToLoad = DEFAULT_LANGS.filter(l => l in bundledLanguages);
        return window.shiki.createHighlighterCore({
            engine: window.shiki.createOnigurumaEngine(),
            themes: [bundledThemes[theme]],
            langs: langsToLoad.map(l => bundledLanguages[l]),
        }).then((highlighter: any) => {
            window.siyuanShiki = {
                highlighter,
                loadedLanguages: new Set(langsToLoad),
                loadedThemes: new Set([theme]),
                bundledLanguages,
                bundledThemes,
            };
        });
    });

    return initPromise;
};

export const ensureShikiLang = async (lang: string): Promise<string> => {
    if (!window.siyuanShiki?.highlighter) {
        return "plaintext";
    }
    if (window.siyuanShiki.loadedLanguages.has(lang)) {
        return lang;
    }
    const bundledLanguages = window.siyuanShiki.bundledLanguages;
    if (lang in bundledLanguages) {
        await window.siyuanShiki.highlighter.loadLanguage(bundledLanguages[lang]);
        window.siyuanShiki.loadedLanguages.add(lang);
        return lang;
    }
    return "plaintext";
};

export interface ShikiHighlightResult {
    html: string;
    bg: string;
    fg: string;
}

export const shikiHighlight = (code: string, language: string): ShikiHighlightResult => {
    if (!window.siyuanShiki?.highlighter) {
        return {html: escapeHtml(code), bg: "", fg: ""};
    }
    const theme = getShikiTheme();
    const tokens = window.siyuanShiki.highlighter.codeToTokens(code, {
        lang: language as any,
        theme: theme as any,
    });
    let html = "";
    for (let i = 0; i < tokens.tokens.length; i++) {
        const line = tokens.tokens[i];
        for (const token of line) {
            if (token.color) {
                html += `<span style="color:${token.color}">${escapeHtml(token.content)}</span>`;
            } else {
                html += escapeHtml(token.content);
            }
        }
        if (i < tokens.tokens.length - 1) {
            html += "\n";
        }
    }
    return {
        html,
        bg: tokens.bg || "",
        fg: tokens.fg || "",
    };
};

export const getShikiLanguageList = (): string[] => {
    if (!window.siyuanShiki?.bundledLanguages) {
        return [];
    }
    return Object.keys(window.siyuanShiki.bundledLanguages).sort();
};

export const isShikiLanguage = (lang: string): boolean => {
    if (!window.siyuanShiki?.bundledLanguages) {
        return false;
    }
    return lang in window.siyuanShiki.bundledLanguages;
};

const escapeHtml = (str: string): string => {
    return str
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
};

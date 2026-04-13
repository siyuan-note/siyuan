import {createHighlighter} from "shiki";
import {bundledLanguages} from "shiki/langs";
import {bundledThemes} from "shiki/themes";

let initPromise: Promise<void> | null = null;

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
        // Already initialized, ensure current theme is loaded
        const theme = getShikiTheme();
        if (!window.siyuanShiki.loadedThemes.has(theme)) {
            return window.siyuanShiki.highlighter.loadTheme(
                (bundledThemes as Record<string, any>)[theme]
            ).then(() => {
                window.siyuanShiki.loadedThemes.add(theme);
            });
        }
        return Promise.resolve();
    }

    if (initPromise) {
        return initPromise;
    }

    const theme = getShikiTheme();
    const langsToLoad = DEFAULT_LANGS.filter(l => l in bundledLanguages);

    initPromise = createHighlighter({
        themes: [
            (bundledThemes as Record<string, any>)[theme]
        ],
        langs: langsToLoad.map(l => (bundledLanguages as Record<string, any>)[l]),
    }).then(highlighter => {
        window.siyuanShiki = {
            highlighter,
            loadedLanguages: new Set(langsToLoad),
            loadedThemes: new Set([theme]),
        };
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
    if (lang in bundledLanguages) {
        await window.siyuanShiki.highlighter.loadLanguage(
            (bundledLanguages as Record<string, any>)[lang]
        );
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
    // Build inline-styled spans from tokens, matching hljs output structure
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
        // Only add newline between lines, not after the last line
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
    return Object.keys(bundledLanguages).sort();
};

export const isShikiLanguage = (lang: string): boolean => {
    return lang in bundledLanguages;
};

const escapeHtml = (str: string): string => {
    return str
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
};

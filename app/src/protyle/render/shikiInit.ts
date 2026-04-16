let initPromise: Promise<void> | null = null;
let modulesPromise: Promise<ShikiModules> | null = null;

interface ShikiModules {
    createHighlighter: (options: any) => Promise<any>;
    bundledLanguages: Record<string, any>;
    bundledThemes: Record<string, any>;
}

const DEFAULT_LANGS = [
    "javascript", "typescript", "java", "python", "go", "rust", "c", "cpp",
    "csharp", "html", "css", "json", "yaml", "markdown", "sql", "shell",
    "bash", "xml", "php", "ruby", "swift", "kotlin", "dart", "lua",
    "plaintext"
];

const loadShikiModules = (): Promise<ShikiModules> => {
    if (!modulesPromise) {
        modulesPromise = Promise.all([
            import(/* webpackChunkName: "shiki" */ "shiki"),
            import(/* webpackChunkName: "shiki-langs" */ "shiki/langs"),
            import(/* webpackChunkName: "shiki-themes" */ "shiki/themes"),
        ]).then(([core, langs, themes]) => ({
            createHighlighter: (core as any).createHighlighter,
            bundledLanguages: (langs as any).bundledLanguages as Record<string, any>,
            bundledThemes: (themes as any).bundledThemes as Record<string, any>,
        }));
    }
    return modulesPromise;
};

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
            return loadShikiModules().then(({bundledThemes}) =>
                window.siyuanShiki.highlighter.loadTheme(bundledThemes[theme])
            ).then(() => {
                window.siyuanShiki.loadedThemes.add(theme);
            });
        }
        return Promise.resolve();
    }

    if (initPromise) {
        return initPromise;
    }

    initPromise = loadShikiModules().then(({createHighlighter, bundledLanguages, bundledThemes}) => {
        const theme = getShikiTheme();
        const langsToLoad = DEFAULT_LANGS.filter(l => l in bundledLanguages);
        return createHighlighter({
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

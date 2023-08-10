import {Constants} from "../constants";
import {genItemPanel} from "./index";
import {keymap} from "./keymap";
import {App} from "../index";

const getLang = (keys: string[]) => {
    const langArray: string[] = [];
    keys.forEach((key) => {
        langArray.push(window.siyuan.languages[key]);
    });
    return langArray;
};

export const initConfigSearch = (element: HTMLElement, app: App) => {
    const configIndex = [
        // 编辑器
        getLang(["config", "fullWidth", "md7", "md8", "md37", "md38",
            "editor", "md2", "md3", "md12", "md16", "md27", "md28", "md29", "md30", "md31", "md32", "md33", "md34",
            "md39", "md40", "fontSizeTip", "fontSize", "font", "font1", "generateHistory", "generateHistoryInterval",
            "historyRetentionDays", "historyRetentionDaysTip", "clearHistory", "katexMacros", "katexMacrosTip",
            "editReadonly", "editReadonlyTip", "embedBlockBreadcrumb", "embedBlockBreadcrumbTip", "outlineOutdentTip",
            "outdent", "floatWindowMode", "floatWindowModeTip", "justify", "justifyTip", "rtl", "rtlTip", "spellcheck",
            "spellcheckTip", "backlinkExpand", "backlinkExpandTip", "onlySearchForDocTip", "dynamicLoadBlocks",
            "dynamicLoadBlocksTip", "fontSizeScrollZoom", "fontSizeScrollZoomTip"
        ]),

        // 文档树
        getLang(["selectOpen", "tabLimit", "fileTree", "fileTree2", "fileTree3", "fileTree4", "fileTree5",
            "fileTree6", "fileTree7", "fileTree8", "fileTree9", "fileTree10", "fileTree12", "fileTree13", "fileTree15",
            "fileTree16", "fileTree17", "fileTree21"]),

        // 闪卡
        getLang(["riffCard", "flashcardNewCardLimit", "flashcardNewCardLimitTip", "flashcardReviewCardLimit",
            "flashcardNewCardLimit", "flashcardReviewCardLimitTip", "flashcardMark", "flashcardMarkTip", "flashcardList",
            "flashcardSuperBlock", "flashcardDeck", "flashcardDeckTip"]),

        // AI
        ["AI"].concat(getLang(["ai", "apiTimeout", "apiTimeoutTip", "apiMaxTokens", "apiMaxTokensTip", "apiKey",
            "apiKeyTip", "apiProxy", "apiProxyTip", "apiBaseURL", "apiBaseURLTip"])),

        // 图片
        getLang(["assets", "unreferencedAssets", "missingAssets"]),

        // 导出
        getLang(["paragraphBeginningSpace", "md4", "export", "export1", "export2", "export5", "export11",
            "export13", "export14", "export15", "export19", "export20", "ref", "blockEmbed", "export17", "export18",
            "export23", "export24"]),

        // 外观
        getLang(["language", "language1", "appearance", "appearance1", "appearance2", "appearance3", "appearance4",
            "appearance5", "appearance6", "appearance8", "appearance9", "appearance10", "appearance11", "appearance16",
            "appearance17", "resetLayout", "reset", "icon", "themeLight", "themeDark", "close", "themeOS", "theme",
            "theme2", "theme11", "theme12", "customEmoji", "customEmojiTip", "refresh"]),

        // 集市
        getLang(["bazaar", "theme", "template", "icon", "widget"]),

        // 搜索
        getLang(["search", "searchLimit", "searchLimit1", "memo", "name", "alias", "keywordsLimit",
            "doc", "headings", "list1", "listItem", "code", "math", "table", "quote", "superBlock", "paragraph",
            "indexAssetPath"]),

        // 快捷键
        getLang(["keymap", "keymapTip2"].concat(Object.keys(Constants.SIYUAN_KEYMAP.general))
            .concat(Object.keys(Constants.SIYUAN_KEYMAP.editor.general))
            .concat(Object.keys(Constants.SIYUAN_KEYMAP.editor.heading))
            .concat(Object.keys(Constants.SIYUAN_KEYMAP.editor.insert))
            .concat(Object.keys(Constants.SIYUAN_KEYMAP.editor.list))
            .concat(Object.keys(Constants.SIYUAN_KEYMAP.editor.table))),

        // 云端
        getLang(["cloudStorage", "trafficStat", "sync", "backup", "cdn", "total", "sizeLimit", "cloudBackup",
            "cloudBackupTip", "updatePath", "cloudSync", "upload", "download", "syncMode", "syncModeTip",
            "generateConflictDoc", "generateConflictDocTip", "syncProvider", "syncProviderTip",
            "syncMode1", "syncMode2", "reposTip", "openSyncTip1", "openSyncTip2", "cloudSyncDir", "config"]),

        // 账号
        getLang(["accountTip", "accountName", "password", "captcha", "forgetPassword", "login", "register",
            "twoFactorCaptcha", "account1", "account2", "account5"]),

        // 关于
        getLang(["autoLaunch", "autoLaunchTip", "about", "about1", "about2", "about3", "about4", "about5", "about6",
            "about9", "about10", "about11", "about12", "about13", "about14", "about17", "config", "dataRepoKey",
            "dataRepoKeyTip1", "dataRepoKeyTip2", "slogan", "currentVer", "checkUpdate", "updatePath", "systemLog",
            "importKey", "genKey", "genKeyByPW", "copyKey", "resetRepo", "systemLogTip", "export", "downloadLatestVer",
            "safeQuit", "directConnection", "siyuanNote", "key", "password", "copied", "resetRepoTip",
            "autoDownloadUpdatePkg", "autoDownloadUpdatePkgTip", "networkProxy", "keyPlaceholder", "initRepoKeyTip",
            "googleAnalytics", "googleAnalyticsTip"]),
    ];
    const inputElement = element.querySelector(".b3-form__icon input") as HTMLInputElement;
    /// #if !BROWSER
    inputElement.focus();
    /// #endif
    const updateTab = () => {
        const indexList: number[] = [];
        const inputValue = inputElement.value;
        configIndex.map((item, index) => {
            item.map((subItem) => {
                if (!subItem) {
                    console.warn("Search config miss language: ", item, index);
                }
                if (subItem && (inputValue.toLowerCase().indexOf(subItem.toLowerCase()) > -1 || subItem.toLowerCase().indexOf(inputValue.toLowerCase()) > -1)) {
                    indexList.push(index);
                }
            });
        });

        let currentTabElement: HTMLElement;
        element.querySelectorAll(".b3-tab-bar li").forEach((item: HTMLElement, index) => {
            if (indexList.includes(index)) {
                if (!currentTabElement) {
                    currentTabElement = item;
                }
                const type = item.getAttribute("data-name");
                item.style.display = "";
                if (["image", "bazaar", "account"].includes(type)) {
                    return;
                }
                // 右侧面板过滤
                const panelElement = element.querySelector(`.config__tab-container[data-name="${type}"]`);
                if (panelElement.innerHTML === "") {
                    genItemPanel(type, panelElement, app);
                }
                if (type === "keymap") {
                    const searchElement = keymap.element.querySelector("#keymapInput") as HTMLInputElement;
                    const searchKeymapElement = keymap.element.querySelector("#searchByKey") as HTMLInputElement;
                    searchElement.value = inputValue;
                    searchKeymapElement.value = "";
                    keymap.search(searchElement.value, searchKeymapElement.value);
                } else {
                    panelElement.querySelectorAll(`.config__tab-container[data-name="${type}"] .b3-label`).forEach((itemElement: HTMLElement) => {
                        if (!itemElement.classList.contains("fn__none")) {
                            const text = itemElement.textContent.toLowerCase();
                            if (text.indexOf(inputValue.toLowerCase()) > -1 || inputValue.toLowerCase().indexOf(text) > -1) {
                                itemElement.style.display = "";
                            } else {
                                itemElement.style.display = "none";
                            }
                        }
                    });
                }
            } else {
                item.style.display = "none";
            }
        });

        const tabPanelElements = element.querySelectorAll(".config__tab-container");
        if (currentTabElement) {
            currentTabElement.click();
        } else {
            tabPanelElements.forEach((item) => {
                item.classList.add("fn__none");
            });
        }

        inputElement.focus();
    };

    inputElement.addEventListener("compositionend", () => {
        updateTab();
    });
    inputElement.addEventListener("input", (event: InputEvent) => {
        if (event.isComposing) {
            return;
        }
        updateTab();
    });
};

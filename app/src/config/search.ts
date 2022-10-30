import {Constants} from "../constants";

const getLang = (keys: string[]) => {
    const langArray: string[] = [];
    keys.forEach((key) => {
        langArray.push(window.siyuan.languages[key]);
    });
    return langArray;
};

export const initConfigSearch = (element: HTMLElement) => {
    const configIndex = [
        // 编辑器
        getLang(["config", "fullWidth",
            "editor", "md2", "md3", "md12", "md16", "md27", "md28", "md29", "md30", "md31", "md32", "md33", "md34",
            "md39", "md40", "fontSizeTip", "fontSize", "font", "font1", "generateHistory", "generateHistoryInterval",
            "historyRetentionDays", "historyRetentionDaysTip", "clearHistory", "katexMacros", "katexMacrosTip",
            "editReadonly", "editReadonlyTip", "embedBlockBreadcrumb", "embedBlockBreadcrumbTip", "outdentTip",
            "outdent", "floatWindowMode", "floatWindowModeTip"
        ]),

        // 文档树
        getLang(["selectOpen", "tabLimit", "fileTree", "fileTree2", "fileTree3", "fileTree4", "fileTree5",
            "fileTree6", "fileTree7", "fileTree8", "fileTree9", "fileTree10", "fileTree12", "fileTree13", "fileTree15",
            "fileTree16", "fileTree17"]),

        // 图片
        getLang(["assets", "clearUnused"]),

        // 导出
        getLang(["paragraphBeginningSpace", "md4", "export", "export1", "export2", "export5", "export11",
            "export13", "export14", "export15", "export19", "export20", "blockRef", "blockEmbed"]),

        // 外观
        window.siyuan.config.appearance.darkThemes.concat(window.siyuan.config.appearance.icons).concat(window.siyuan.config.appearance.lightThemes)
            .concat(Constants.SIYUAN_CONFIG_APPEARANCE_DARK_CODE)
            .concat(Constants.SIYUAN_CONFIG_APPEARANCE_LIGHT_CODE)
            .concat(["English", "简体中文"]).concat(getLang(["language", "language1"]))
            .concat(getLang(["appearance", "appearance1", "appearance2", "appearance3", "appearance4",
                "appearance5", "appearance6", "appearance8", "appearance9", "appearance10", "appearance11",
                "appearance14", "appearance15", "appearance16", "appearance17",
                "resetLayout", "reset", "icon", "themeLight", "themeDark", "open", "close", "themeOS", "theme",
                "theme2", "theme11", "theme12", "theme13", "theme14", "customEmoji", "customEmojiTip", "refresh"])),

        // 集市
        getLang(["bazaar", "theme", "template", "icon", "widget"]),

        // 搜索
        getLang(["search", "searchLimit", "searchLimit1", "memo", "name", "alias",
            "doc", "headings", "list1", "listItem", "code", "math", "table", "quote", "superBlock", "paragraph"]),

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
            "generateConflictDoc", "generateConflictDocTip",
            "syncMode1", "syncMode2", "reposTip", "openSyncTip1", "openSyncTip2", "cloudSyncDir", "config"]),

        // 账号
        getLang(["accountTip", "accountName", "password", "captcha", "forgetPassword", "login", "register",
            "twoFactorCaptcha", "account1", "account2", "account5"]),

        // 关于
        getLang(["about", "about1", "about2", "about3", "about4", "about5", "about6", "about7", "about8",
            "about9", "about10", "about11", "about12", "about13", "about14", "about17", "config", "dataRepoKey",
            "dataRepoKeyTip1", "dataRepoKeyTip2", "slogan", "currentVer", "checkUpdate", "updatePath", "systemLog",
            "importKey", "genKey", "genKeyByPW", "copyKey", "resetRepo", "systemLogTip", "export", "visitAnnouncements",
            "safeQuit", "directConnection", "siyuanNote", "key", "password", "copied", "resetRepoTip",
            "autoDownloadUpdatePkg", "autoDownloadUpdatePkgTip", "networkProxy", "keyPlaceholder", "initRepoKeyTip",
            "useFixedPort", "useFixedPortTip", "googleAnalytics", "googleAnalyticsTip"]),
    ];
    const inputElement = element.querySelector(".b3-form__icon input") as HTMLInputElement;
    if (window.siyuan.config.system.container !== "ios") {
        inputElement.focus();
    }
    const updateTab = () => {
        const indexList: number[] = [];
        const inputValue = inputElement.value;
        configIndex.map((item, index) => {
            item.map((subItem) => {
                if (!subItem) {
                    console.warn("Search config miss language: ", item, index);
                }
                if (subItem && (inputValue.toLowerCase().indexOf(subItem) > -1 || subItem.toLowerCase().indexOf(inputValue) > -1)) {
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
                item.style.display = "";
            } else {
                item.style.display = "none";
            }
        });

        const tabPanelElements = element.querySelectorAll(".b3-tab-container");
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

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
        getLang(["config",
            "editor", "md2", "md3", "md12", "md16", "md27", "md28", "md29", "md30", "md31", "md32", "md33", "md34", "md39",
            "fontSizeTip", "fontSize", "font", "font1", "generateHistory", "generateHistoryInterval",
            "historyRetentionDays", "historyRetentionDaysTip", "clearHistory"
        ]),

        // 文档树
        getLang(["selectOpen", "fileTree", "fileTree2",
            "fileTree5", "fileTree6", "fileTree7", "fileTree8", "fileTree12", "fileTree13", "fileTree15", "fileTree16", "fileTree17"]),

        // 图片
        getLang(["assets", "clearUnused"]),

        // 导出
        getLang(["paragraphBeginningSpace", "md4", "export", "export1", "export2", "export5", "export11", "export13", "export14", "export15", "export19", "export20", "blockRef", "blockEmbed"]),

        // 外观
        window.siyuan.config.appearance.darkThemes.concat(window.siyuan.config.appearance.icons).concat(window.siyuan.config.appearance.lightThemes)
            .concat(Constants.SIYUAN_CONFIG_APPEARANCE_DARK_CODE)
            .concat(Constants.SIYUAN_CONFIG_APPEARANCE_LIGHT_CODE)
            .concat(["English", "简体中文"]).concat(getLang(["language", "language1"]))
            .concat(getLang(["appearance", "appearance1", "appearance2", "appearance3", "appearance4", "appearance5",
                "appearance6", "appearance7", "appearance8", "appearance9", "appearance10", "appearance11", "appearance14", "appearance15",
                "resetLayout", "reset", "icon", "themeLight", "themeDark", "open", "close",
                "theme", "theme2", "theme11", "theme12", "theme13", "theme14", "customEmoji"])),

        // 集市
        getLang(["bazaar", "theme", "template", "icon", "widget"]),

        // 搜索
        getLang(["search", "searchLimit", "searchLimit1", "memo", "name", "alias",
            "doc", "headings", "list1", "listItem", "code", "math", "table", "quote", "superBlock", "paragraph"]),

        // 快捷键
        getLang(["keymap"].concat(Object.keys(Constants.SIYUAN_KEYMAP.general))
            .concat(Object.keys(Constants.SIYUAN_KEYMAP.editor.general))
            .concat(Object.keys(Constants.SIYUAN_KEYMAP.editor.heading))
            .concat(Object.keys(Constants.SIYUAN_KEYMAP.editor.insert))
            .concat(Object.keys(Constants.SIYUAN_KEYMAP.editor.list))
            .concat(Object.keys(Constants.SIYUAN_KEYMAP.editor.table))),

        // 云端
        getLang(["sync", "cloudSpace", "backup", "cdn", "total", "cloudBackup", "downloadRecover", "backupUpload",
            "downloadCloud", "downloadCloudTip", "account3Tip", "updatePath", "cloudSync",
            "changeE2EEPasswd", "e2eePasswdTip", "changeE2EEPasswdTip", "e2eePasswd", "setPasswd", "syncTip", "reposTip", "openSyncTip1", "openSyncTip2", "downloadRecover1", "backupUpload1", "deleteCloudBackup", "cloudSyncDir"]),

        // 账号
        getLang(["accountTip", "accountName", "password", "captcha", "forgetPassword", "login", "register", "twoFactorCaptcha",
            "account1", "account2", "account5", "networkProxy"]),

        // 关于
        getLang(["about", "about1", "about2", "about3", "about4", "about5", "about6", "about7", "about8",
            "about11", "about12", "about13", "about14", "about15", "about16",
            "slogan", "currentVer", "checkUpdate", "updatePath"]),
    ];
    const inputElement = element.querySelector(".b3-form__icon input") as HTMLInputElement;
    if (window.siyuan.config.system.container !== "ios") {
        inputElement.focus();
    }
    const updateTab = () => {
        const indexList: number[] = [];
        const inputValue = inputElement.value;
        configIndex.map((item, index) => {
            item.map(subItem => {
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

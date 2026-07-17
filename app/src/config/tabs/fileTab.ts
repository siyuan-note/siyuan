import {confirmDialog} from "../../dialog/confirmDialog";
import {genNotebookOption} from "../../menus/onGetnotebookconf";
import {fetchPost} from "../../util/fetch";
import {editorConfigApi} from "./editorRuntime";
import {fileConfigApi} from "./fileRuntime";
import type {SettingTabBuilder} from "../setting/builder";
import {controlNumber, controlSelect, controlString} from "../setting/control";
import {genConfigItemName} from "../render/fragments";
import {genButtonHtml, genNumberInputHtml} from "../render/render";
import {setNoteBook} from "../../util/pathName";
/// #if !MOBILE
import {getAllModels} from "../../layout/getAll";
/// #endif

const isMobileKernelContainer = () =>
    ["android", "ios", "harmony"].includes(window.siyuan.config.system.container);

const genNotebookSavePathHtml = (
    title: string,
    desc: string,
    selectId: string,
    pathId: string,
    optionsHtml: string,
) => `<div class="b3-label config-item config-item--save-path">
    ${genConfigItemName(title)}
    <div class="b3-label__text">${desc}</div>
    <div class="fn__hr--small"></div>
    <div class="fn__flex config-wrap">
        <select class="b3-select fn__size200" id="${selectId}">${optionsHtml}</select>
        <div class="fn__space"></div>
        <input class="b3-text-field fn__flex-1" id="${pathId}" value="">
    </div>
</div>`;

/// #if !MOBILE
const registerFileTreeBehaviorGroup = (tab: SettingTabBuilder) => {
    const group = tab.group("behavior", window.siyuan.languages.configGroupBehavior);

    group.switch("fileTree.docIconClickExpand", {
        title: window.siyuan.languages.docIconClickExpand,
        desc: window.siyuan.languages.docIconClickExpandTip,
        save: (value) => fileConfigApi.patch("docIconClickExpand", value, () => {
            getAllModels().files.forEach((files) => files.updateDocActions());
        }),
    });
    group.switch("fileTree.parentDocClickExpand", {
        title: window.siyuan.languages.parentDocClickExpand,
        desc: window.siyuan.languages.parentDocClickExpandTip,
        save: (value) => fileConfigApi.patch("parentDocClickExpand", value, () => {
            getAllModels().files.forEach((files) => files.updateDocActions());
        }),
    });
    group.switch("fileTree.alwaysSelectOpenedFile", {
        title: window.siyuan.languages.selectOpen,
        desc: window.siyuan.languages.fileTree2,
    });
    group.switch("fileTree.openFilesUseCurrentTab", {
        title: window.siyuan.languages.fileTree7,
        desc: window.siyuan.languages.fileTree8,
    });
    group.switch("fileTree.noSplitScreenWhenOpenTab", {
        title: window.siyuan.languages.noSplitScreenWhenOpenTab,
        desc: window.siyuan.languages.noSplitScreenWhenOpenTabTip,
    });
    group.number("fileTree.maxOpenTabCount", {
        title: window.siyuan.languages.tabLimit,
        desc: window.siyuan.languages.tabLimit1,
        min: 1,
        max: 32,
    });
    group.switch("fileTree.closeTabsOnStart", {
        title: window.siyuan.languages.fileTree9,
        desc: window.siyuan.languages.fileTree10,
    });
};
/// #endif

const registerFileNewDocumentGroup = (tab: SettingTabBuilder) => {
    const group = tab.group("newDocument", window.siyuan.languages.configGroupNewDocument);

    group.switch("fileTree.createDocAtTop", {
        title: window.siyuan.languages.fileTree24,
        desc: window.siyuan.languages.fileTree25,
    });

    const docCreateTitle = window.siyuan.languages.fileTree12;
    const docCreateDesc = window.siyuan.languages.fileTree13;
    group.composite({
        key: "docCreateSavePath",
        keywords: [docCreateTitle, docCreateDesc],
        html: () => genNotebookSavePathHtml(
            docCreateTitle,
            docCreateDesc,
            "fileTree.docCreateSaveBox",
            "fileTree.docCreateSavePath",
            genNotebookOption(window.siyuan.config.fileTree.docCreateSaveBox),
        ),
        afterMount: (root) => {
            const el = root.querySelector<HTMLInputElement>(`#${CSS.escape("fileTree.docCreateSavePath")}`);
            if (el) {
                el.value = window.siyuan.config.fileTree.docCreateSavePath;
            }
        },
        controls: [
            {
                control: controlSelect("fileTree.docCreateSaveBox", {options: []}),
                save: (v) => fileConfigApi.patch("docCreateSaveBox", v),
            },
            {
                control: controlString("fileTree.docCreateSavePath"),
                save: (v) => fileConfigApi.patch("docCreateSavePath", v),
            },
        ],
    });

    const refCreateTitle = window.siyuan.languages.fileTree5;
    const refCreateDesc = window.siyuan.languages.fileTree6;
    group.composite({
        key: "refCreateSavePath",
        keywords: [refCreateTitle, refCreateDesc],
        html: () => genNotebookSavePathHtml(
            refCreateTitle,
            refCreateDesc,
            "fileTree.refCreateSaveBox",
            "fileTree.refCreateSavePath",
            genNotebookOption(window.siyuan.config.fileTree.refCreateSaveBox),
        ),
        afterMount: (root) => {
            const el = root.querySelector<HTMLInputElement>(`#${CSS.escape("fileTree.refCreateSavePath")}`);
            if (el) {
                el.value = window.siyuan.config.fileTree.refCreateSavePath;
            }
        },
        controls: [
            {
                control: controlSelect("fileTree.refCreateSaveBox", {options: []}),
                save: (v) => fileConfigApi.patch("refCreateSaveBox", v),
            },
            {
                control: controlString("fileTree.refCreateSavePath"),
                save: (v) => fileConfigApi.patch("refCreateSavePath", v),
            },
        ],
    });

    if (isMobileKernelContainer()) {
        // 仅移动端内核支持使用闪念速记 https://github.com/siyuan-note/siyuan/issues/14414
        const shorthandTitle = window.siyuan.languages.fileTree26;
        const shorthandDesc = window.siyuan.languages.fileTree27;
        group.composite({
            key: "shorthandSavePath",
            keywords: [shorthandTitle, shorthandDesc],
            html: () => genNotebookSavePathHtml(
                shorthandTitle,
                shorthandDesc,
                "fileTree.shorthandSaveBox",
                "fileTree.shorthandSavePath",
                genNotebookOption(window.siyuan.config.fileTree.shorthandSaveBox, undefined, true),
            ),
            afterMount: (root) => {
                const el = root.querySelector<HTMLInputElement>(`#${CSS.escape("fileTree.shorthandSavePath")}`);
                if (el) {
                    el.value = window.siyuan.config.fileTree.shorthandSavePath;
                }
            },
            controls: [
                {
                    control: controlSelect("fileTree.shorthandSaveBox", {options: []}),
                    save: (v) => fileConfigApi.patch("shorthandSaveBox", v),
                },
                {
                    control: controlString("fileTree.shorthandSavePath"),
                    save: (v) => fileConfigApi.patch("shorthandSavePath", v),
                },
            ],
        });
    }
};

const registerFileManagementGroup = (tab: SettingTabBuilder) => {
    const group = tab.group("fileManagement", window.siyuan.languages.configGroupFileManagement);

    group.number("editor.generateHistoryInterval", {
        title: window.siyuan.languages.generateHistory,
        desc: window.siyuan.languages.generateHistoryInterval,
        min: 0,
        max: 120,
        save: (value) => editorConfigApi.patch("generateHistoryInterval", value),
    });

    const historyKeywords = [
        window.siyuan.languages.historyRetentionDaysTip,
        window.siyuan.languages.clearHistory,
        window.siyuan.languages.confirmClearHistory,
        window.siyuan.languages.purge,
        window.siyuan.languages.historyRetentionDays,
    ];
    const historyRetentionDaysControl = controlNumber("editor.historyRetentionDays", {min: 1, max: 3650});
    group.composite({
        key: "historyRetention",
        keywords: historyKeywords,
        html: () => `<div class="b3-label config-item">
    <div class="fn__block">
        ${genConfigItemName(window.siyuan.languages.historyRetentionDaysTip)}
    </div>
    <div class="fn__hr--small"></div>
    <div class="fn__flex config-wrap">
        <div class="fn__block">
            <div class="b3-label__text">${window.siyuan.languages.clearHistory}</div>
        </div>
        <span class="fn__space"></span>
        ${genButtonHtml("clearHistory", window.siyuan.languages.purge, "iconTrashcan")}
    </div>
    <div class="fn__hr--small"></div>
    <div class="fn__flex config-wrap">
        <div class="fn__block">
            <div class="b3-label__text">${window.siyuan.languages.historyRetentionDays}</div>
        </div>
        <span class="fn__space"></span>
        ${genNumberInputHtml(historyRetentionDaysControl.id, historyRetentionDaysControl.readConfig() as number, historyRetentionDaysControl.min, historyRetentionDaysControl.max)}
    </div>
</div>`,
        afterMount: (root) => {
            root.querySelector("#clearHistory")?.addEventListener("click", () => {
                confirmDialog(
                    window.siyuan.languages.clearHistory,
                    window.siyuan.languages.confirmClearHistory,
                    () => {
                        fetchPost("/api/history/clearWorkspaceHistory", {});
                    },
                );
            });
        },
        controls: [{
            control: historyRetentionDaysControl,
            save: (v) => editorConfigApi.patch("historyRetentionDays", v),
        }],
    });

    group.number("fileTree.maxListCount", {
        title: window.siyuan.languages.fileTree16,
        desc: window.siyuan.languages.fileTree17,
        min: 1,
        max: 10240,
    });
    group.number("fileTree.largeFileWarningSize", {
        title: window.siyuan.languages.fileTree22,
        desc: window.siyuan.languages.fileTree23,
        min: 2,
        max: 10240,
        unit: "MB",
    });
    group.switch("fileTree.allowCreateDeeper", {
        title: window.siyuan.languages.fileTree18,
        desc: window.siyuan.languages.fileTree19,
    });
    group.switch("fileTree.useSingleLineSave", {
        title: window.siyuan.languages.fileTree20,
        desc: window.siyuan.languages.fileTree21,
    });
    group.switch("fileTree.removeDocWithoutConfirm", {
        title: window.siyuan.languages.fileTree3,
        desc: window.siyuan.languages.fileTree4,
    });
};

const registerFileOthersGroup = (tab: SettingTabBuilder) => {
    const group = tab.group("others", window.siyuan.languages.configGroupOthers);

    group.switch("fileTree.boxDocEnabled", {
        title: window.siyuan.languages.boxDocEnabled,
        desc: window.siyuan.languages.boxDocEnabledTip,
        save: (value) => fileConfigApi.patch("boxDocEnabled", value, () => {
            setNoteBook(() => {
                /// #if MOBILE
                window.siyuan.mobile.docks.file?.init(false);
                /// #else
                getAllModels().files.forEach((files) => files.init(false));
                /// #endif
            });
        }),
    });
    group.number("fileTree.recentDocsMaxListCount", {
        title: window.siyuan.languages.recentDocsMaxListCount,
        desc: window.siyuan.languages.recentDocsMaxListCountTip,
        min: 32,
        max: 256,
    });
};

export const registerFileTab = (tab: SettingTabBuilder) => {
    /// #if !MOBILE
    registerFileTreeBehaviorGroup(tab);
    /// #endif
    registerFileNewDocumentGroup(tab);
    registerFileManagementGroup(tab);
    registerFileOthersGroup(tab);
};

/// #if !BROWSER
import {ipcRenderer} from "electron";
import {useShell} from "../../util/pathName";
/// #endif
import type {SettingTabBuilder} from "../setting/builder";
import {Constants} from "../../constants";
import {exportConfigApi} from "./exportRuntime";

const registerExportReferencesGroup = (tab: SettingTabBuilder) => {
    const group = tab.group("references", window.siyuan.languages.configGroupReferences);

    group.switch("export.includeSubDocs", {
        title: window.siyuan.languages.includeSubDocs,
        desc: window.siyuan.languages.includeSubDocsTip,
    });
    group.switch("export.includeRelatedDocs", {
        title: window.siyuan.languages.includeRelatedDocs,
        desc: window.siyuan.languages.includeRelatedDocsTip,
    });
    group.select("export.blockRefMode", {
        title: window.siyuan.languages.ref,
        desc: window.siyuan.languages.export11,
        options: [
            {value: 2, label: window.siyuan.languages.export2},
            {value: 3, label: window.siyuan.languages.export3},
            {value: 4, label: window.siyuan.languages.export4},
        ],
    });
    group.select("export.blockEmbedMode", {
        title: window.siyuan.languages.blockEmbed,
        desc: window.siyuan.languages.export12,
        options: [
            {value: 0, label: window.siyuan.languages.export0},
            {value: 1, label: window.siyuan.languages.export1},
        ],
    });
};

const registerExportFormatGroup = (tab: SettingTabBuilder) => {
    const group = tab.group("format", window.siyuan.languages.configGroupFormat);

    group.switch("export.markdownYFM", {
        title: window.siyuan.languages.export23,
        desc: window.siyuan.languages.export24,
    });
    group.switch("export.addTitle", {
        title: window.siyuan.languages.export17,
        desc: window.siyuan.languages.export18,
    });
    group.switch("export.paragraphBeginningSpace", {
        title: window.siyuan.languages.paragraphBeginningSpace,
        desc: window.siyuan.languages.md4,
    });
    group.switch("export.removeAssetsID", {
        title: window.siyuan.languages.removeAssetsID,
        desc: window.siyuan.languages.removeAssetsIDTip,
    });
    group.switch("export.inlineMemo", {
        title: window.siyuan.languages.export31,
        desc: window.siyuan.languages.export32,
    });
    group.textPair({
        title: window.siyuan.languages.export13,
        desc: window.siyuan.languages.export14,
        leftId: "export.blockRefTextLeft",
        rightId: "export.blockRefTextRight",
    });
    group.textPair({
        title: window.siyuan.languages.export15,
        desc: window.siyuan.languages.export16,
        leftId: "export.tagOpenMarker",
        rightId: "export.tagCloseMarker",
    });
};

const registerExportPdfGroup = (tab: SettingTabBuilder) => {
    const group = tab.group("pdf", window.siyuan.languages.configGroupPDF);

    group.select("export.fileAnnotationRefMode", {
        title: window.siyuan.languages.export5,
        desc: window.siyuan.languages.export6,
        options: [
            {value: 0, label: window.siyuan.languages.export7},
            {value: 1, label: window.siyuan.languages.export8},
        ],
    });
    group.text("export.pdfFooter", {
        title: window.siyuan.languages.export21,
        desc: window.siyuan.languages.export22,
    });
    group.stack({
        key: "pdfWatermark",
        keywords: [
            window.siyuan.languages.export27,
            window.siyuan.languages.export28,
            window.siyuan.languages.export29,
        ],
    }, (stack) => {
        stack.title(window.siyuan.languages.export27);
        stack.desc(window.siyuan.languages.export28);
        stack.textBlock("export.pdfWatermarkStr", {
            mode: "input-text",
        });
        stack.desc(`<a href="https://pdfcpu.io/core/watermark#description" target="_blank">${window.siyuan.languages.export29}</a>`);
        stack.textBlock("export.pdfWatermarkDesc", {
            mode: "textarea",
        });
    });
};

const registerExportImagesGroup = (tab: SettingTabBuilder) => {
    const group = tab.group("images", window.siyuan.languages.configGroupImages);

    group.stack({
        key: "imageWatermark",
        keywords: [
            window.siyuan.languages.export30,
            window.siyuan.languages.export28,
            window.siyuan.languages.export29,
            window.siyuan.languages.export10,
        ],
    }, (stack) => {
        stack.title(window.siyuan.languages.export30);
        stack.desc(window.siyuan.languages.export28);
        stack.textBlock("export.imageWatermarkStr", {
            mode: "input-text",
        });
        stack.desc(`${window.siyuan.languages.export29}<div class="fn__hr--small"></div>${window.siyuan.languages.export10}`);
        stack.textBlock("export.imageWatermarkDesc", {
            mode: "textarea",
        });
    });
};

/// #if !BROWSER
const registerExportPandocGroup = (tab: SettingTabBuilder) => {
    const group = tab.group("pandoc", window.siyuan.languages.configGroupPandoc);

    group.stack({
        key: "pandocBin",
        keywords: [
            window.siyuan.languages.export19,
            window.siyuan.languages.export20,
            window.siyuan.languages.reset,
            window.siyuan.languages.config,
        ],
        afterMount: mountExportPandocStack,
    }, (stack) => {
        stack.title(`${window.siyuan.languages.export19}<span class="fn__space"></span><a href="javascript:void(0)" id="pandocBinPathDisplay" style="word-break: break-all">${Lute.EscapeHTMLStr(window.siyuan.config.export.pandocBin)}</a>`);
        stack.button({
            id: "pandocBinReset",
            label: window.siyuan.languages.reset,
            icon: "iconUndo",
        });
        stack.desc(window.siyuan.languages.export20);
        stack.button({
            id: "pandocBinChooser",
            label: window.siyuan.languages.config,
            icon: "iconSettings",
        });
    });
    group.textBlock("export.pandocParams", {
        title: window.siyuan.languages.export25,
        desc: window.siyuan.languages.export26,
        mode: "textarea",
    });
};

const mountExportPandocStack = (root: HTMLElement) => {
    root.querySelector("#pandocBinReset")?.addEventListener("click", () => {
        exportConfigApi.patch("export.pandocBin", "");
    });
    root.querySelector("#pandocBinPathDisplay")?.addEventListener("click", () => {
        if (window.siyuan.config.export.pandocBin) {
            useShell("showItemInFolder", window.siyuan.config.export.pandocBin);
        }
    });
    root.querySelector("#pandocBinChooser")?.addEventListener("click", async () => {
        const localPath = await ipcRenderer.invoke(Constants.SIYUAN_GET, {
            cmd: "showOpenDialog",
            defaultPath: window.siyuan.config.system.homeDir,
            properties: ["openFile", "showHiddenFiles"],
        });
        if (!localPath.filePaths.length) {
            return;
        }
        exportConfigApi.patch("export.pandocBin", localPath.filePaths[0]);
    });
};
/// #endif

export const registerExportTab = (tab: SettingTabBuilder) => {
    registerExportReferencesGroup(tab);
    registerExportFormatGroup(tab);
    registerExportPdfGroup(tab);
    registerExportImagesGroup(tab);
    /// #if !BROWSER
    registerExportPandocGroup(tab);
    /// #endif
};

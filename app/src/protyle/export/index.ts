import {hideMessage, showMessage} from "../../dialog/message";
import {Constants} from "../../constants";
/// #if !BROWSER
import {ipcRenderer, OpenDialogReturnValue} from "electron";
import {app, BrowserWindow, dialog, getCurrentWindow} from "@electron/remote";
import * as fs from "fs";
import * as path from "path";
import {afterExport} from "./util";
/// #endif
import {confirmDialog} from "../../dialog/confirmDialog";
import {getThemeMode, setInlineStyle} from "../../util/assets";
import {fetchPost} from "../../util/fetch";
import {Dialog} from "../../dialog";
import {pathPosix} from "../../util/pathName";
import {replaceLocalPath} from "../../editor/rename";
import {setStorageVal} from "../util/compatibility";

export const saveExport = (option: { type: string, id: string }) => {
    /// #if !BROWSER
    if (option.type === "pdf") {
        if (window.siyuan.config.appearance.mode === 1) {
            confirmDialog(window.siyuan.languages.pdfTip, window.siyuan.languages.pdfConfirm, () => {
                renderPDF(option.id);
            });
        } else {
            renderPDF(option.id);
        }
    } else if (option.type === "word") {
        const localData = window.siyuan.storage[Constants.LOCAL_EXPORTWORD];
        const wordDialog = new Dialog({
            title: "Word " + window.siyuan.languages.config,
            content: `<div class="b3-dialog__content">
    <label class="fn__flex b3-label">
        <div class="fn__flex-1">
            ${window.siyuan.languages.removeAssetsFolder}
        </div>
        <span class="fn__space"></span>
        <input id="removeAssets" class="b3-switch" type="checkbox" ${localData.removeAssets ? "checked" : ""}>
    </label>
    <label class="fn__flex b3-label">
        <div class="fn__flex-1">
            ${window.siyuan.languages.mergeSubdocs}
        </div>
        <span class="fn__space"></span>
        <input id="mergeSubdocs" class="b3-switch" type="checkbox" ${localData.mergeSubdocs ? "checked" : ""}>
    </label>
</div>
<div class="b3-dialog__action">
    <button class="b3-button b3-button--cancel">${window.siyuan.languages.cancel}</button><div class="fn__space"></div>
    <button class="b3-button b3-button--text">${window.siyuan.languages.confirm}</button>
</div>`,
            width: "520px",
        });
        const btnsElement = wordDialog.element.querySelectorAll(".b3-button");
        btnsElement[0].addEventListener("click", () => {
            wordDialog.destroy();
        });
        btnsElement[1].addEventListener("click", () => {
            const removeAssets = (wordDialog.element.querySelector("#removeAssets") as HTMLInputElement).checked;
            const mergeSubdocs = (wordDialog.element.querySelector("#mergeSubdocs") as HTMLInputElement).checked;
            window.siyuan.storage[Constants.LOCAL_EXPORTWORD] = {removeAssets, mergeSubdocs};
            setStorageVal(Constants.LOCAL_EXPORTWORD, window.siyuan.storage[Constants.LOCAL_EXPORTWORD]);
            getExportPath(option, removeAssets, mergeSubdocs);
            wordDialog.destroy();
        });
    } else {
        getExportPath(option);
    }
    /// #endif
};

/// #if !BROWSER
const renderPDF = (id: string) => {
    const localData = window.siyuan.storage[Constants.LOCAL_EXPORTPDF];
    const servePath = window.location.protocol + "//" + window.location.host;
    const isDefault = (window.siyuan.config.appearance.mode === 1 && window.siyuan.config.appearance.themeDark === "midnight") || (window.siyuan.config.appearance.mode === 0 && window.siyuan.config.appearance.themeLight === "daylight");
    let themeStyle = "";
    if (!isDefault) {
        themeStyle = `<link rel="stylesheet" type="text/css" id="themeStyle" href="appearance/themes/${window.siyuan.config.appearance.themeLight}/theme.css?${Constants.SIYUAN_VERSION}"/>`;
    }
    // data-theme-mode="light" https://github.com/siyuan-note/siyuan/issues/7379
    const html = `<!DOCTYPE html>
<html lang="${window.siyuan.config.appearance.lang}" data-theme-mode="light" data-light-theme="${window.siyuan.config.appearance.themeLight}" data-dark-theme="${window.siyuan.config.appearance.themeDark}">
<head>
    <base href="${servePath}/">
    <meta charset="utf-8">
    <meta http-equiv="X-UA-Compatible" content="IE=edge">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=0"/>
    <meta name="apple-mobile-web-app-capable" content="yes">
    <meta name="mobile-web-app-capable" content="yes"/>
    <meta name="apple-mobile-web-app-status-bar-style" content="black">
    <link rel="stylesheet" type="text/css" id="baseStyle" href="stage/build/export/base.css?${Constants.SIYUAN_VERSION}"/>
    <link rel="stylesheet" type="text/css" id="themeDefaultStyle" href="appearance/themes/daylight/theme.css?${Constants.SIYUAN_VERSION}"/>
    ${themeStyle}
    <title>${window.siyuan.languages.export} PDF</title>
    <style>
        body {
            margin: 0;
            display: flex;
            overflow-x: hidden;
            flex-direction: row-reverse;
        }

        body.exporting {
            flex-direction: unset;
            overflow: auto;
        }

        body.exporting::-webkit-scrollbar {
            display: none;
        }

        body.exporting #preview {
            border: initial;
        }

        #action {
            position: sticky;
            top: 0;
            right: 0;

            width: 232px;
            height: 100vh;
            box-sizing: border-box;

            padding: 16px;
            background: var(--b3-theme-surface);
            overflow-y: auto;
            overflow-x: hidden;
            z-index: 1;
        }

        #preview {
            margin: 0 auto;
            border-left: 1px double currentColor;
            border-right: 1px double currentColor;
        }

        .b3-switch {
            margin-left: 14px;
        }

        .protyle-wysiwyg {
            padding: 0;
            overflow: initial;
        }

        .b3-label {
            border-bottom: 1px solid var(--b3-theme-surface-lighter);
            display: block;
            color: var(--b3-theme-on-surface);
            padding-bottom: 12px;
            margin-bottom: 12px;
        }
        ${setInlineStyle(false)}
    </style>
</head>
<body>
<div id="action">
    <label class="b3-label">
        <div>
            ${window.siyuan.languages.exportPDF0}
        </div>
        <span class="fn__hr"></span>
        <select class="b3-select fn__block" id="pageSize">
            <optgroup label="Common">
                <option ${localData.pageSize === "A0" ? "selected" : ""} value="A0">A0</option>
                <option ${localData.pageSize === "A1" ? "selected" : ""} value="A1">A1</option>
                <option ${localData.pageSize === "A2" ? "selected" : ""} value="A2">A2</option>
                <option ${localData.pageSize === "A3" ? "selected" : ""} value="A3">A3</option>
                <option ${localData.pageSize === "A4" ? "selected" : ""} value="A4">A4</option>
                <option ${localData.pageSize === "A5" ? "selected" : ""} value="A5">A5</option>
                <option ${localData.pageSize === "A6" ? "selected" : ""} value="A6">A6</option>
                <option ${localData.pageSize === "Legal" ? "selected" : ""} value="Legal">Legal</option>
                <option ${localData.pageSize === "Letter" ? "selected" : ""} value="Letter">Letter</option>
                <option ${localData.pageSize === "Tabloid" ? "selected" : ""} value="Tabloid">Tabloid</option>
            </optgroup>
            <optgroup label="ISO A">
                <option ${localData.pageSize === "ISO-4A0" ? "selected" : ""} value="ISO-4A0">4A0 (ISO)</option>
                <option ${localData.pageSize === "ISO-2A0" ? "selected" : ""} value="ISO-2A0">2A0 (ISO)</option>
                <option ${localData.pageSize === "ISO-A0" ? "selected" : ""} value="ISO-A0">A0 (ISO)</option>
                <option ${localData.pageSize === "ISO-A1" ? "selected" : ""} value="ISO-A1">A1 (ISO)</option>
                <option ${localData.pageSize === "ISO-A2" ? "selected" : ""} value="ISO-A2">A2 (ISO)</option>
                <option ${localData.pageSize === "ISO-A3" ? "selected" : ""} value="ISO-A3">A3 (ISO)</option>
                <option ${localData.pageSize === "ISO-A4" ? "selected" : ""} value="ISO-A4">A4 (ISO)</option>
                <option ${localData.pageSize === "ISO-A5" ? "selected" : ""} value="ISO-A5">A5 (ISO)</option>
                <option ${localData.pageSize === "ISO-A6" ? "selected" : ""} value="ISO-A6">A6 (ISO)</option>
                <option ${localData.pageSize === "ISO-A7" ? "selected" : ""} value="ISO-A7">A7 (ISO)</option>
                <option ${localData.pageSize === "ISO-A8" ? "selected" : ""} value="ISO-A8">A8 (ISO)</option>
                <option ${localData.pageSize === "ISO-A9" ? "selected" : ""} value="ISO-A9">A9 (ISO)</option>
                <option ${localData.pageSize === "ISO-A10" ? "selected" : ""} value="ISO-A10">A10 (ISO)</option>
            </optgroup>
            <optgroup label="ISO B">
                <option ${localData.pageSize === "ISO-B0" ? "selected" : ""} value="ISO-B0">B0 (ISO)</option>
                <option ${localData.pageSize === "ISO-B1" ? "selected" : ""} value="ISO-B1">B1 (ISO)</option>
                <option ${localData.pageSize === "ISO-B2" ? "selected" : ""} value="ISO-B2">B2 (ISO)</option>
                <option ${localData.pageSize === "ISO-B3" ? "selected" : ""} value="ISO-B3">B3 (ISO)</option>
                <option ${localData.pageSize === "ISO-B4" ? "selected" : ""} value="ISO-B4">B4 (ISO)</option>
                <option ${localData.pageSize === "ISO-B5" ? "selected" : ""} value="ISO-B5">B5 (ISO)</option>
                <option ${localData.pageSize === "ISO-B6" ? "selected" : ""} value="ISO-B6">B6 (ISO)</option>
                <option ${localData.pageSize === "ISO-B7" ? "selected" : ""} value="ISO-B7">B7 (ISO)</option>
                <option ${localData.pageSize === "ISO-B8" ? "selected" : ""} value="ISO-B8">B8 (ISO)</option>
                <option ${localData.pageSize === "ISO-B9" ? "selected" : ""} value="ISO-B9">B9 (ISO)</option>
                <option ${localData.pageSize === "ISO-B10" ? "selected" : ""} value="ISO-B10">B10 (ISO)</option>
            </optgroup>
            <optgroup label="ISO C">
                <option ${localData.pageSize === "ISO-C0" ? "selected" : ""} value="ISO-C0">C0 (ISO)</option>
                <option ${localData.pageSize === "ISO-C1" ? "selected" : ""} value="ISO-C1">C1 (ISO)</option>
                <option ${localData.pageSize === "ISO-C2" ? "selected" : ""} value="ISO-C2">C2 (ISO)</option>
                <option ${localData.pageSize === "ISO-C3" ? "selected" : ""} value="ISO-C3">C3 (ISO)</option>
                <option ${localData.pageSize === "ISO-C4" ? "selected" : ""} value="ISO-C4">C4 (ISO)</option>
                <option ${localData.pageSize === "ISO-C5" ? "selected" : ""} value="ISO-C5">C5 (ISO)</option>
                <option ${localData.pageSize === "ISO-C6" ? "selected" : ""} value="ISO-C6">C6 (ISO)</option>
                <option ${localData.pageSize === "ISO-C7" ? "selected" : ""} value="ISO-C7">C7 (ISO)</option>
                <option ${localData.pageSize === "ISO-C8" ? "selected" : ""} value="ISO-C8">C8 (ISO)</option>
                <option ${localData.pageSize === "ISO-C9" ? "selected" : ""} value="ISO-C9">C9 (ISO)</option>
                <option ${localData.pageSize === "ISO-C10" ? "selected" : ""} value="ISO-C10">C10 (ISO)</option>
            </optgroup>
            <optgroup label="JIS (Japanese Industrial Standards)">
                <option ${localData.pageSize === "JIS-B0" ? "selected" : ""} value="JIS-B0">B0 (JIS)</option>
                <option ${localData.pageSize === "JIS-B1" ? "selected" : ""} value="JIS-B1">B1 (JIS)</option>
                <option ${localData.pageSize === "JIS-B2" ? "selected" : ""} value="JIS-B2">B2 (JIS)</option>
                <option ${localData.pageSize === "JIS-B3" ? "selected" : ""} value="JIS-B3">B3 (JIS)</option>
                <option ${localData.pageSize === "JIS-B4" ? "selected" : ""} value="JIS-B4">B4 (JIS)</option>
                <option ${localData.pageSize === "JIS-B5" ? "selected" : ""} value="JIS-B5">B5 (JIS)</option>
                <option ${localData.pageSize === "JIS-B6" ? "selected" : ""} value="JIS-B6">B6 (JIS)</option>
                <option ${localData.pageSize === "JIS-B7" ? "selected" : ""} value="JIS-B7">B7 (JIS)</option>
                <option ${localData.pageSize === "JIS-B8" ? "selected" : ""} value="JIS-B8">B8 (JIS)</option>
                <option ${localData.pageSize === "JIS-B9" ? "selected" : ""} value="JIS-B9">B9 (JIS)</option>
                <option ${localData.pageSize === "JIS-B10" ? "selected" : ""} value="JIS-B10">B10 (JIS)</option>
            </optgroup>
            <optgroup label="ANS (American National Standards)">
                <option ${localData.pageSize === "ANS-Letter" ? "selected" : ""} value="ANS-Letter">Letter (ANS)</option>
                <option ${localData.pageSize === "ANS-Legal" ? "selected" : ""} value="ANS-Legal">Legal (ANS)</option>
                <option ${localData.pageSize === "ANS-Ledger" ? "selected" : ""} value="ANS-Ledger">Ledger (ANS)</option>
                <option ${localData.pageSize === "ANS-Tabloid" ? "selected" : ""} value="ANS-Tabloid">Tabloid (ANS)</option>
                <option ${localData.pageSize === "ANS-Executive" ? "selected" : ""} value="ANS-Executive">Executive (ANS)</option>
                <option ${localData.pageSize === "ANS-Statement" ? "selected" : ""} value="ANS-Statement">Statement (ANS)</option>
            </optgroup>
        </select>
    </label>
    <label class="b3-label">
        <div>
            ${window.siyuan.languages.exportPDF2}
        </div>
        <span class="fn__hr"></span>
        <select class="b3-select fn__block" id="marginsType">
            <option ${localData.marginType === "default" ? "selected" : ""} value="default">${window.siyuan.languages.defaultMargin}</option>
            <option ${localData.marginType === "none" ? "selected" : ""} value="none">${window.siyuan.languages.noneMargin}</option>
            <option ${localData.marginType === "printableArea" ? "selected" : ""} value="printableArea">${window.siyuan.languages.minimalMargin}</option>
            <option ${localData.marginType === "custom" ? "selected" : ""} value="custom">${window.siyuan.languages.customMargin}</option>
        </select>
        <div class="${localData.marginType === "custom" ? "" : "fn__none"}">
            <span class="fn__hr"></span>
            <div>${window.siyuan.languages.marginTop}</div>
            <input id="marginsTop" class="b3-text-field fn__block" value="${localData.marginTop || 0}" type="number" min="0" step="0.01">
            <span class="fn__hr"></span>
            <div>${window.siyuan.languages.marginRight}</div>
            <input id="marginsRight" class="b3-text-field fn__block" value="${localData.marginRight || 0}" type="number" min="0" step="0.01">
            <span class="fn__hr"></span>
            <div>${window.siyuan.languages.marginBottom}</div>
            <input id="marginsBottom" class="b3-text-field fn__block" value="${localData.marginBottom || 0}" type="number" min="0" step="0.01">
            <span class="fn__hr"></span>
            <div>${window.siyuan.languages.marginLeft}</div>
        <input id="marginsLeft" class="b3-text-field fn__block" value="${localData.marginLeft || 0}" type="number" min="0" step="0.01">
    </div>
    </label>
    <label class="b3-label">
        <div>
            ${window.siyuan.languages.exportPDF3}
            <span id="scaleTip" style="float: right;color: var(--b3-theme-on-background);">${Math.round(localData.scale * 100) || 100} %</span>
        </div>
        <span class="fn__hr"></span>
        <input id="scale" class="fn__block" value="${Math.round(localData.scale * 100) || 100}" type="range" min="10" step="1" max="200">
    </label>
    <label class="b3-label">
        <div>
            ${window.siyuan.languages.exportPDF1}
        </div>
        <span class="fn__hr"></span>
        <input id="landscape" class="b3-switch" type="checkbox" ${localData.landscape ? "checked" : ""}>
    </label>
    <label class="b3-label">
        <div>
            ${window.siyuan.languages.exportPDF4}
        </div>
        <span class="fn__hr"></span>
        <input id="removeAssets" class="b3-switch" type="checkbox" ${localData.removeAssets ? "checked" : ""}>
    </label>
    <label class="b3-label">
        <div>
            ${window.siyuan.languages.exportPDF5}
        </div>
        <span class="fn__hr"></span>
        <input id="keepFold" class="b3-switch" type="checkbox" ${localData.keepFold ? "checked" : ""}>
    </label>
    <label class="b3-label">
        <div>
            ${window.siyuan.languages.mergeSubdocs}
        </div>
        <span class="fn__hr"></span>
        <input id="mergeSubdocs" class="b3-switch" type="checkbox" ${localData.mergeSubdocs ? "checked" : ""}>
    </label>
    <div class="fn__flex">
        <div class="fn__flex-1"></div>
        <button class="b3-button b3-button--cancel">${window.siyuan.languages.cancel}</button>
        <div class="fn__space"></div>
        <button class="b3-button b3-button--text">${window.siyuan.languages.confirm}</button>
    </div>
</div>
<div id="preview" style="zoom:1" class="protyle-wysiwyg${window.siyuan.config.editor.displayBookmarkIcon ? " protyle-wysiwyg--attr" : ""}">
    <div class="fn__loading" style="left:0"><img width="48px" src="stage/loading-pure.svg"></div>
</div>
<script src="appearance/icons/${window.siyuan.config.appearance.icon}/icon.js?${Constants.SIYUAN_VERSION}"></script>
<script src="stage/build/export/protyle-method.js?${Constants.SIYUAN_VERSION}"></script>
<script src="stage/protyle/js/lute/lute.min.js?${Constants.SIYUAN_VERSION}"></script>    
<script type="module">
    const actionElement = document.getElementById("action");
    const pageSizeElement = document.getElementById("pageSize");
    const marginsTypeElement = document.getElementById("marginsType");
    const marginsTopElement = document.getElementById("marginsTop");
    const marginsRightElement = document.getElementById("marginsRight");
    const marginsBottomElement = document.getElementById("marginsBottom");
    const marginsLeftElement = document.getElementById("marginsLeft");
    const scaleTipElement = document.getElementById("scaleTip");
    const scaleElement = document.getElementById("scale");
    const landscapeElement = document.getElementById("landscape");
    const removeAssetsElement = document.getElementById("removeAssets");
    const keepFoldElement = document.getElementById("keepFold");
    const mergeSubdocsElement = document.getElementById("mergeSubdocs");
    const cancelElement = actionElement.querySelector(".b3-button--cancel");
    const confirmElement = actionElement.querySelector(".b3-button--text");
    const previewElement = document.getElementById("preview");

    const getScale = () => {
        return parseFloat(scaleElement.value);
    }
    const getPageWidth = () => {
        const isLandscape = landscapeElement.checked;
        let width = 210
        switch (pageSizeElement.value) {
            case "ISO-4A0":
                width = isLandscape ? 2378 : 1682;
                break;
            case "ISO-2A0":
                width = isLandscape ? 1682 : 1189;
                break;
            case "A0":
            case "ISO-A0":
                width = isLandscape ? 1189 : 841;
                break;
            case "A1":
            case "ISO-A1":
                width = isLandscape ? 841 : 594;
                break;
            case "A2":
            case "ISO-A2":
                width = isLandscape ? 594 : 420;
                break;
            case "A3":
            case "ISO-A3":
                width = isLandscape ? 420 : 297;
                break;
            case "A4":
            case "ISO-A4":
                width = isLandscape ? 297 : 210;
                break;
            case "A5":
            case "ISO-A5":
                width = isLandscape ? 210 : 148;
                break;
            case "A6":
            case "ISO-A6":
                width = isLandscape ? 148 : 105;
                break;
            case "ISO-A7":
                width = isLandscape ? 105 : 74;
                break;
            case "ISO-A8":
                width = isLandscape ? 74 : 52;
                break;
            case "ISO-A9":
                width = isLandscape ? 52 : 37;
                break;
            case "ISO-A10":
                width = isLandscape ? 37 : 26;
                break;

            case "ISO-B0":
                width = isLandscape ? 1414 : 1000;
                break;
            case "ISO-B1":
                width = isLandscape ? 1000 : 707;
                break;
            case "ISO-B2":
                width = isLandscape ? 707 : 500;
                break;
            case "ISO-B3":
                width = isLandscape ? 500 : 353;
                break;
            case "ISO-B4":
                width = isLandscape ? 353 : 250;
                break;
            case "ISO-B5":
                width = isLandscape ? 250 : 176;
                break;
            case "ISO-B6":
                width = isLandscape ? 176 : 125;
                break;
            case "ISO-B7":
                width = isLandscape ? 125 : 88;
                break;
            case "ISO-B8":
                width = isLandscape ? 88 : 62;
                break;
            case "ISO-B9":
                width = isLandscape ? 62 : 44;
                break;
            case "ISO-B10":
                width = isLandscape ? 44 : 31;
                break;

            case "ISO-C0":
                width = isLandscape ? 1297 : 917;
                break;
            case "ISO-C1":
                width = isLandscape ? 917 : 648;
                break;
            case "ISO-C2":
                width = isLandscape ? 648 : 458;
                break;
            case "ISO-C3":
                width = isLandscape ? 458 : 324;
                break;
            case "ISO-C4":
                width = isLandscape ? 324 : 229;
                break;
            case "ISO-C5":
                width = isLandscape ? 229 : 162;
                break;
            case "ISO-C6":
                width = isLandscape ? 162 : 114;
                break;
            case "ISO-C7":
                width = isLandscape ? 114 : 81;
                break;
            case "ISO-C8":
                width = isLandscape ? 81 : 57;
                break;
            case "ISO-C9":
                width = isLandscape ? 57 : 40;
                break;
            case "ISO-C10":
                width = isLandscape ? 40 : 28;
                break;

            case "JIS-C0":
                width = isLandscape ? 1456 : 1030;
                break;
            case "JIS-C1":
                width = isLandscape ? 1030 : 728;
                break;
            case "JIS-C2":
                width = isLandscape ? 728 : 515;
                break;
            case "JIS-C3":
                width = isLandscape ? 515 : 364;
                break;
            case "JIS-C4":
                width = isLandscape ? 364 : 257;
                break;
            case "JIS-C5":
                width = isLandscape ? 257 : 182;
                break;
            case "JIS-C6":
                width = isLandscape ? 182 : 128;
                break;
            case "JIS-C7":
                width = isLandscape ? 128 : 91;
                break;
            case "JIS-C8":
                width = isLandscape ? 91 : 64;
                break;
            case "JIS-C9":
                width = isLandscape ? 64 : 45;
                break;
            case "JIS-C10":
                width = isLandscape ? 45 : 32;
                break;

            case "Letter":
            case "ANS-Letter":
                width = isLandscape ? 279.4 : 215.9;
                break;
            case "Legal":
            case "ANS-Legal":
                width = isLandscape ? 355.6 : 215.9;
                break;
            case "ANS-Ledger":
                width = isLandscape ? 431.8 : 279.4;
                break;
            case "Tabloid":
            case "ANS-Tabloid":
                width = isLandscape ? 431.8 : 279.4;
                break;
            case "ANS-Executive":
                width = isLandscape ? 266.7 : 184.1;
                break;
            case "ANS-Statement":
                width = isLandscape ? 215.9 : 139.7;
                break;
        }
        return width;
    }
    const getContentWidth = () => {
        let contentWidth = getPageWidth();;
        contentWidth -= (parseFloat(marginsRightElement.value) || 0) * 25.4;
        contentWidth -= (parseFloat(marginsLeftElement.value) || 0) * 25.4;
        return contentWidth;
    }
    const mm2px = (millimetre, dpi = 96) => {
        const inch = millimetre / 25.4;
        const pixel = inch * dpi;
        return pixel;
    }
    const getZoom = (pageWidth = getPageWidth(), scale = getScale()) => {
        let zoom = 1;
        if (pageWidth > 210) {
            zoom = (210 / pageWidth) * (scale / 100);
        } else {
            zoom = scale / 100;
        }
        return zoom;
    }
    const updatePageSize = (pageWidth = getPageWidth(), scale = getScale()) => {
        const zoom = getZoom(pageWidth, scale);
        if (pageWidth > 210) {
            previewElement.style.width = \`\${210 / zoom}mm\`;
        } else {
            previewElement.style.width = \`\${pageWidth / zoom}mm\`;
        }
        previewElement.style.zoom = zoom;
        return zoom;
    }
    const updatePadding = () => {
        const isLandscape = landscapeElement.checked;
        switch (marginsTypeElement.value) {
            case "default":
                if (isLandscape) {
                    marginsTopElement.value = "0.42";
                    marginsRightElement.value = "0.42";
                    marginsBottomElement.value = "0.42";
                    marginsLeftElement.value = "0.42";
                } else {
                    marginsTopElement.value = "1";
                    marginsRightElement.value = "0.54";
                    marginsBottomElement.value = "1";
                    marginsLeftElement.value = "0.54";
                }
                break;
            case "none": // none
                marginsTopElement.value = "0";
                marginsRightElement.value = "0";
                marginsBottomElement.value = "0";
                marginsLeftElement.value = "0";
                break;
            case "printableArea": // minimal
                if (isLandscape) {
                    marginsTopElement.value = ".07";
                    marginsRightElement.value = ".07";
                    marginsBottomElement.value = ".07";
                    marginsLeftElement.value = ".07";
                } else {
                    marginsTopElement.value = "0.58";
                    marginsRightElement.value = "0.1";
                    marginsBottomElement.value = "0.58";
                    marginsLeftElement.value = "0.1";
                }
                break;
        }
        const zoom0 = getZoom();
        let zoom1 = 1;
        const pageWidth = getPageWidth();
        if (pageWidth > 210) {
            zoom1 = (210 / pageWidth);
        }
        previewElement.style.padding = [
            \`\${marginsTopElement.value * zoom1 / zoom0}in\`,
            \`\${marginsRightElement.value * zoom1 / zoom0}in\`,
            \`\${marginsBottomElement.value * zoom1 / zoom0}in\`,
            \`\${marginsLeftElement.value * zoom1 / zoom0}in\`,
        ].join(" ");
    }
    const protyleRender = () => {
        Protyle.mermaidRender(previewElement, "stage/protyle");
        Protyle.flowchartRender(previewElement, "stage/protyle");
        Protyle.graphvizRender(previewElement, "stage/protyle");
        Protyle.chartRender(previewElement, "stage/protyle");
        Protyle.mindmapRender(previewElement, "stage/protyle");
        Protyle.abcRender(previewElement, "stage/protyle");
        Protyle.htmlRender(previewElement);
        Protyle.plantumlRender(previewElement, "stage/protyle");
    }
    const fixBlockWidth = (padding = true) => {
        /* 内容可用宽度 (px) */
        const contentWidth = mm2px(getContentWidth());

        // 为保持代码块宽度一致，全部都进行宽度设定 https://github.com/siyuan-note/siyuan/issues/7692 
        previewElement.querySelectorAll('.hljs').forEach((item) => {
            // 强制换行 https://ld246.com/article/1679228783553
            item.parentElement.setAttribute("linewrap", "true");
            item.parentElement.style.width = "";
            item.parentElement.style.width = \`\${Math.min(item.parentElement.clientWidth, contentWidth)}px\`;
            delete item.dataset.render;
        })
        Protyle.highlightRender(previewElement, "stage/protyle");

        previewElement.querySelectorAll('[data-type="NodeMathBlock"]').forEach((item) => {
            item.style.width = "";
            item.style.width = \`\${Math.min(item.clientWidth, contentWidth)}px\`;
            delete item.dataset.render;
        })
        Protyle.mathRender(previewElement, "stage/protyle", true);

        previewElement.querySelectorAll("table").forEach(item => {
            if (item.clientWidth > item.parentElement.clientWidth) {
                item.style.zoom = (item.parentElement.clientWidth / item.clientWidth).toFixed(6) - 0.000001;
                item.parentElement.style.overflow = "hidden";
            }
        })

        previewElement.querySelectorAll('.render-node[data-type="NodeCodeBlock"]').forEach(item => {
            delete item.dataset.render;
        })

        protyleRender();
    }
    const fixPageSize = () => {
        updatePageSize();
        updatePadding();
        fixBlockWidth();
    }
    const updatePage = () => {
        setTimeout(fixPageSize, 0);
    }
    const renderPreview = (html) => {
        previewElement.innerHTML = html;
        protyleRender();
    }
    const fetchPost = (url, data, cb) => {
        fetch("${servePath}" + url, {
            method: "POST",
            body: JSON.stringify(data)
        }).then((response) => {
            return response.json();
        }).then((response) => {
            cb(response);
        })
    }
    fetchPost("/api/export/exportPreviewHTML", {
        id: "${id}",
        keepFold: ${localData.keepFold},
        merge: ${localData.mergeSubdocs},
    }, response => {
        if (response.code === 1) {
            alert(response.msg)
            return;
        }
        document.title = '${window.siyuan.languages.export} PDF - ' + response.data.name
        window.siyuan = {
            config: {
                appearance: { mode: 0, codeBlockThemeDark: "${window.siyuan.config.appearance.codeBlockThemeDark}", codeBlockThemeLight: "${window.siyuan.config.appearance.codeBlockThemeLight}" },
                editor: { 
                    codeLineWrap: true,
                    codeLigatures: ${window.siyuan.config.editor.codeLigatures},
                    plantUMLServePath: "${window.siyuan.config.editor.plantUMLServePath}",
                    codeSyntaxHighlightLineNum: ${window.siyuan.config.editor.codeSyntaxHighlightLineNum},
                    katexMacros: JSON.stringify(${window.siyuan.config.editor.katexMacros}),
                }
            },
            languages: {copy:"${window.siyuan.languages.copy}"}
        };
        previewElement.addEventListener("click", (event) => {
            let target = event.target;
            while (target && !target.isEqualNode(previewElement)) {
                if (target.tagName === "A") {
                    const linkAddress = target.getAttribute("href");
                    if (linkAddress.startsWith("#")) {
                        // 导出预览模式点击块引转换后的脚注跳转不正确 https://github.com/siyuan-note/siyuan/issues/5700
                        previewElement.querySelector(linkAddress).scrollIntoView();
                        event.stopPropagation();
                        event.preventDefault();
                        return;
                    }
                } else if (target.classList.contains("protyle-action__copy")) {
                    navigator.clipboard.writeText(target.parentElement.nextElementSibling.textContent.trimEnd());
                    event.preventDefault();
                    event.stopPropagation();
                    break;
                }
                target = target.parentElement;
            }
        });
        keepFoldElement.addEventListener('change', () => {
            refreshPreview();
        });
        mergeSubdocsElement.addEventListener('change', () => {
            refreshPreview();
        });
        
        const refreshPreview = () => {
            previewElement.innerHTML = '<div class="fn__loading" style="left:0"><img width="48px" src="stage/loading-pure.svg"></div>'
            fetchPost("/api/export/exportPreviewHTML", {
                id: "${id}",
                keepFold: keepFoldElement.checked,
                merge: mergeSubdocsElement.checked,
            }, response2 => {
                if (response2.code === 1) {
                    alert(response2.msg)
                    return;
                }
                renderPreview(response2.data.content);
                updatePage();
            })
        };

        scaleElement.addEventListener("input", () => {
            const scale = scaleElement.value;
            scaleTipElement.innerText = \`\${scale} %\`;
            fixPageSize();
        })
        pageSizeElement.addEventListener('change', () => {
            fixPageSize();
        });
        marginsTypeElement.addEventListener('change', (event) => {
            updatePage();
            if (event.target.value === "custom") {
                event.target.nextElementSibling.classList.remove("fn__none");
            } else {
                event.target.nextElementSibling.classList.add("fn__none");
            }
        });
        marginsTopElement.addEventListener('change', () => {
            fixPageSize();
        });
        marginsRightElement.addEventListener('change', () => {
            fixPageSize();
        });
        marginsBottomElement.addEventListener('change', () => {
            fixPageSize();
        });
        marginsLeftElement.addEventListener('change', () => {
            fixPageSize();
        });
        landscapeElement.addEventListener('change', () => {
            fixPageSize();
        });

        const currentWindowId = ${getCurrentWindow().id};
        actionElement.querySelector('.b3-button--cancel').addEventListener('click', () => {
            const {ipcRenderer}  = require("electron");
            ipcRenderer.send("${Constants.SIYUAN_EXPORT_CLOSE}", currentWindowId)
        });
        actionElement.querySelector('.b3-button--text').addEventListener('click', () => {
            const contentWidth = getContentWidth();
            actionElement.remove();
            document.body.classList.toggle("exporting", true);

            previewElement.style.width = \`\${contentWidth}mm\`;
            previewElement.style.zoom = "";
            previewElement.style.padding = "0";

            const { ipcRenderer } = require("electron");
            ipcRenderer.send("siyuan-export-pdf", {
                id: currentWindowId,
                pdfOptions: {
                    printBackground: true,
                    landscape: landscapeElement.checked,
                    marginType: marginsTypeElement.value,
                    margins: {
                        top: parseFloat(marginsTopElement.value),
                        bottom: parseFloat(marginsBottomElement.value),
                        left: parseFloat(marginsLeftElement.value),
                        right: parseFloat(marginsRightElement.value),
                    },
                    scale: parseFloat(scaleElement.value) / 100,
                },
                contentWidth: previewElement.clientWidth,
                pageSize: pageSizeElement.value,
                keepFold: keepFoldElement.checked,
                mergeSubdocs: mergeSubdocsElement.checked,
                removeAssets: removeAssetsElement.checked,
                rootId: "${id}",
                rootTitle: response.data.name,
            })
        });
        renderPreview(response.data.content);
        updatePage();
    });
</script>
</body>
</html>`;
    window.siyuan.printWin = new BrowserWindow({
        parent: getCurrentWindow(),
        modal: true,
        show: true,
        width: 1040,
        height: 780,
        resizable: false,
        frame: "darwin" === window.siyuan.config.system.os,
        icon: path.join(window.siyuan.config.system.appDir, "stage", "icon-large.png"),
        titleBarStyle: "hidden",
        webPreferences: {
            contextIsolation: false,
            nodeIntegration: true,
            webviewTag: true,
            webSecurity: false,
            autoplayPolicy: "user-gesture-required" // 桌面端禁止自动播放多媒体 https://github.com/siyuan-note/siyuan/issues/7587
        },
    });
    ipcRenderer.send(Constants.SIYUAN_EXPORT_PREVENT, window.siyuan.printWin.id);
    window.siyuan.printWin.webContents.userAgent = `SiYuan/${app.getVersion()} https://b3log.org/siyuan Electron`;
    fetchPost("/api/export/exportTempContent", {content: html}, (response) => {
        window.siyuan.printWin.loadURL(response.data.url);
    });
};

const getExportPath = (option: { type: string, id: string }, removeAssets?: boolean, mergeSubdocs?: boolean) => {
    fetchPost("/api/block/getBlockInfo", {
        id: option.id
    }, (response) => {
        if (response.code === 3) {
            showMessage(response.msg);
            return;
        }
        let exportType = "HTML (SiYuan)";
        switch (option.type) {
            case "htmlmd":
                exportType = "HTML (Markdown)";
                break;
            case "word":
                exportType = "Word .docx";
                break;
            case "pdf":
                exportType = "PDF";
                break;
        }

        dialog.showOpenDialog({
            title: window.siyuan.languages.export + " " + exportType,
            properties: ["createDirectory", "openDirectory"],
        }).then((result: OpenDialogReturnValue) => {
            if (!result.canceled) {
                const msgId = showMessage(window.siyuan.languages.exporting, -1);
                let url = "/api/export/exportHTML";
                if (option.type === "htmlmd") {
                    url = "/api/export/exportMdHTML";
                } else if (option.type === "word") {
                    url = "/api/export/exportDocx";
                }
                let savePath = result.filePaths[0];
                if (option.type !== "word" && !savePath.endsWith(response.data.rootTitle)) {
                    savePath = path.join(savePath, replaceLocalPath(response.data.rootTitle));
                }
                savePath = savePath.trim();
                fetchPost(url, {
                    id: option.id,
                    pdf: option.type === "pdf",
                    removeAssets: removeAssets,
                    merge: mergeSubdocs,
                    savePath
                }, exportResponse => {
                    if (option.type === "word") {
                        if (exportResponse.code === 1) {
                            showMessage(exportResponse.msg, undefined, "error");
                            hideMessage(msgId);
                            return;
                        }
                        afterExport(path.join(savePath, replaceLocalPath(response.data.rootTitle)) + ".docx", msgId);
                    } else {
                        onExport(exportResponse, savePath, option.type, removeAssets, msgId);
                    }
                });
            }
        });
    });
};

const onExport = (data: IWebSocketData, filePath: string, type: string, removeAssets?: boolean, msgId?: string) => {
    let themeName = window.siyuan.config.appearance.themeLight;
    let mode = 0;
    if (["html", "htmlmd"].includes(type) && window.siyuan.config.appearance.mode === 1) {
        themeName = window.siyuan.config.appearance.themeDark;
        mode = 1;
    }
    const isDefault = (window.siyuan.config.appearance.mode === 1 && window.siyuan.config.appearance.themeDark === "midnight") || (window.siyuan.config.appearance.mode === 0 && window.siyuan.config.appearance.themeLight === "daylight");
    let themeStyle = "";
    if (!isDefault) {
        themeStyle = `<link rel="stylesheet" type="text/css" id="themeStyle" href="appearance/themes/${themeName}/theme.css?${Constants.SIYUAN_VERSION}"/>`;
    }
    const html = `<!DOCTYPE html>
<html lang="${window.siyuan.config.appearance.lang}" data-theme-mode="${getThemeMode()}" data-light-theme="${window.siyuan.config.appearance.themeLight}" data-dark-theme="${window.siyuan.config.appearance.themeDark}">
<head>
    <meta charset="utf-8">
    <meta http-equiv="X-UA-Compatible" content="IE=edge">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=0"/>
    <meta name="apple-mobile-web-app-capable" content="yes">
    <meta name="mobile-web-app-capable" content="yes"/>
    <meta name="apple-mobile-web-app-status-bar-style" content="black">
    <link rel="stylesheet" type="text/css" id="baseStyle" href="stage/build/export/base.css?${Constants.SIYUAN_VERSION}"/>
    <link rel="stylesheet" type="text/css" id="themeDefaultStyle" href="appearance/themes/${themeName}/theme.css?${Constants.SIYUAN_VERSION}"/>
    ${themeStyle}
    <title>${pathPosix().basename(filePath)} - ${window.siyuan.languages.siyuanNote}  v${Constants.SIYUAN_VERSION}</title>
    <style>
        body {background-color: var(--b3-theme-background);color: var(--b3-theme-on-background)}
        ${setInlineStyle(false)}
    </style>
</head>
<body>
<div class="${["htmlmd", "word"].includes(type) ? "b3-typography" : "protyle-wysiwyg" + (window.siyuan.config.editor.displayBookmarkIcon ? " protyle-wysiwyg--attr" : "")}" style="max-width: 800px;margin: 0 auto;" id="preview">${data.data.content}</div>
<script src="appearance/icons/${window.siyuan.config.appearance.icon}/icon.js?${Constants.SIYUAN_VERSION}"></script>
<script src="stage/build/export/protyle-method.js?${Constants.SIYUAN_VERSION}"></script>
<script src="stage/protyle/js/lute/lute.min.js?${Constants.SIYUAN_VERSION}"></script>    
<script>
    window.siyuan = {
        config: {
            appearance: { mode: ${mode}, codeBlockThemeDark: "${window.siyuan.config.appearance.codeBlockThemeDark}", codeBlockThemeLight: "${window.siyuan.config.appearance.codeBlockThemeLight}" },
            editor: { 
            codeLineWrap: true,
            codeLigatures: ${window.siyuan.config.editor.codeLigatures},
            plantUMLServePath: "${window.siyuan.config.editor.plantUMLServePath}",
            codeSyntaxHighlightLineNum: ${window.siyuan.config.editor.codeSyntaxHighlightLineNum},
            katexMacros: JSON.stringify(${window.siyuan.config.editor.katexMacros}),
            }
        },
        languages: {copy:"${window.siyuan.languages.copy}"}
    };
    const previewElement = document.getElementById('preview');
    Protyle.highlightRender(previewElement, "stage/protyle");
    Protyle.mathRender(previewElement, "stage/protyle", ${type === "pdf"});
    Protyle.mermaidRender(previewElement, "stage/protyle");
    Protyle.flowchartRender(previewElement, "stage/protyle");
    Protyle.graphvizRender(previewElement, "stage/protyle");
    Protyle.chartRender(previewElement, "stage/protyle");
    Protyle.mindmapRender(previewElement, "stage/protyle");
    Protyle.abcRender(previewElement, "stage/protyle");
    Protyle.htmlRender(previewElement);
    Protyle.plantumlRender(previewElement, "stage/protyle");
    document.querySelectorAll(".protyle-action__copy").forEach((item) => {
        item.addEventListener("click", (event) => {
            navigator.clipboard.writeText(item.parentElement.nextElementSibling.textContent.trimEnd());
            event.preventDefault();
            event.stopPropagation();
        })
    });
</script></body></html>`;
    const htmlPath = path.join(filePath, "index.html");
    fs.writeFileSync(htmlPath, html);
    afterExport(htmlPath, msgId);
};
/// #endif

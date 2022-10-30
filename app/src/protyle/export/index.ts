import {hideMessage, showMessage} from "../../dialog/message";
import {Constants} from "../../constants";
/// #if !BROWSER
import {OpenDialogReturnValue} from "electron";
import {app, BrowserWindow, dialog, getCurrentWindow} from "@electron/remote";
import * as fs from "fs";
import * as path from "path";
import {afterExport} from "./util";
/// #endif
import {confirmDialog} from "../../dialog/confirmDialog";
import {setInlineStyle} from "../../util/assets";
import {fetchPost} from "../../util/fetch";
import {Dialog} from "../../dialog";
import {lockFile} from "../../dialog/processSystem";
import {pathPosix} from "../../util/pathName";
import {replaceLocalPath} from "../../editor/rename";

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
        const localData = localStorage.getItem(Constants.LOCAL_EXPORTWORD);
        const wordDialog = new Dialog({
            title: "Word " + window.siyuan.languages.config,
            content: `<div class="b3-dialog__content">
    <label class="fn__flex b3-label">
        <div class="fn__flex-1">
            ${window.siyuan.languages.exportPDF4}
        </div>
        <span class="fn__space"></span>
        <input id="removeAssets" class="b3-switch" type="checkbox" ${localData === "true" ? "checked" : ""}>
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
            localStorage.setItem(Constants.LOCAL_EXPORTWORD, removeAssets.toString());
            getExportPath(option, removeAssets);
            wordDialog.destroy();
        });
    } else {
        getExportPath(option);
    }
    /// #endif
};

/// #if !BROWSER
let originalZoomFactor = 1;
const renderPDF = (id: string) => {
    const localData = JSON.parse(localStorage.getItem(Constants.LOCAL_EXPORTPDF) || JSON.stringify({
        landscape: false,
        marginType: "0",
        scale: 1,
        pageSize: "A4",
        removeAssets: true,
        keepFold: false,
    }));
    const servePath = window.location.protocol + "//" + window.location.host;
    const html = `<!DOCTYPE html><html>
<head>
    <meta charset="utf-8">
    <meta http-equiv="X-UA-Compatible" content="IE=edge">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=0"/>
    <meta name="apple-mobile-web-app-capable" content="yes">
    <meta name="mobile-web-app-capable" content="yes"/>
    <meta name="apple-mobile-web-app-status-bar-style" content="black">
    <link rel="stylesheet" type="text/css" id="themeDefaultStyle" href="${servePath}/stage/build/export/base.css?${Constants.SIYUAN_VERSION}"/>
    <link rel="stylesheet" type="text/css" id="themeStyle" href="${servePath}/appearance/themes/${window.siyuan.config.appearance.themeLight}/${window.siyuan.config.appearance.customCSS ? "custom" : "theme"}.css?${Constants.SIYUAN_VERSION}"/>
    <title>${window.siyuan.languages.export} PDF</title>
    <style>
        body {
          margin: 0;
        }
        
        #action {
          width: 200px;
          background: var(--b3-theme-background-light);
          padding: 16px;
          position: fixed;
          right: 0;
          top: 0;
          overflow: auto;
          bottom: 0;
        }
        
        #preview {
          max-width: 800px;
          margin: 0 auto;
          position: absolute;
          right: 232px;
          left: 0;
        }
        
        #preview.exporting {
          position: inherit;
          max-width: none;
        }
        
        .exporting::-webkit-scrollbar {
          width: 0;
          height: 0;
        }
        pre code {
          max-height: none !important;
          word-break: break-all !important;
          white-space: pre-wrap !important;
        }
        .protyle-wysiwyg {
          height: 100%;
          overflow: auto;
          box-sizing: border-box;
        }
        
        .b3-label {
          border-bottom: 1px solid var(--b3-theme-surface-lighter);
          display: block;
          color: var(--b3-theme-on-surface);
          padding-bottom: 16px;
          margin-bottom: 16px;
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
        <select class="b3-select" id="pageSize">
            <option ${localData.pageSize === "A3" ? "selected" : ""} value="A3">A3</option>
            <option ${localData.pageSize === "A4" ? "selected" : ""} value="A4">A4</option>
            <option ${localData.pageSize === "A5" ? "selected" : ""} value="A5">A5</option>
            <option ${localData.pageSize === "Legal" ? "selected" : ""} value="Legal">Legal</option>
            <option ${localData.pageSize === "Letter" ? "selected" : ""} value="Letter">Letter</option>
            <option ${localData.pageSize === "Tabloid" ? "selected" : ""} value="Tabloid">Tabloid</option>
        </select>
    </label>
    <label class="b3-label">
        <div>
            ${window.siyuan.languages.exportPDF2}
        </div>
        <span class="fn__hr"></span>
        <select class="b3-select" id="marginsType">
            <option ${localData.marginType === "0" ? "selected" : ""} value="0">Default</option>
            <option ${localData.marginType === "1" ? "selected" : ""} value="1">None</option>
            <option ${localData.marginType === "2" ? "selected" : ""} value="2">Minimal</option>
        </select>
    </label>
    <label class="b3-label">
        <div>
            ${window.siyuan.languages.exportPDF3}
            <span id="scaleTip" style="float: right;color: var(--b3-theme-on-background);">${localData.scale || 1}</span>
        </div>
        <span class="fn__hr"></span>
        <input style="width: 192px" value="${localData.scale || 1}" id="scale" step="0.1" class="b3-slider" type="range" min="0.1" max="2">
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
    <div class="fn__flex">
      <div class="fn__flex-1"></div>
      <button class="b3-button b3-button--cancel">${window.siyuan.languages.cancel}</button>
      <div class="fn__space"></div>
      <button class="b3-button b3-button--text">${window.siyuan.languages.confirm}</button>
    </div>
</div>
<div class="protyle-wysiwyg${window.siyuan.config.editor.displayBookmarkIcon ? " protyle-wysiwyg--attr" : ""}" id="preview">
    <div class="fn__loading" style="left:0"><img width="48px" src="${servePath}/stage/loading-pure.svg"></div>
</div>
<script src="${servePath}/appearance/icons/${window.siyuan.config.appearance.icon}/icon.js?${Constants.SIYUAN_VERSION}"></script>
<script src="${servePath}/stage/build/export/protyle-method.js?${Constants.SIYUAN_VERSION}"></script>
<script src="${servePath}/stage/protyle/js/lute/lute.min.js?${Constants.SIYUAN_VERSION}"></script>    
<script>
    let pdfLeft = 0;
    let pdfTop = 0;
    const setPadding = () => {
        const isLandscape = document.querySelector("#landscape").checked;
        switch (document.querySelector("#marginsType").value) { // none
            case "0":
                if (isLandscape) {
                    pdfLeft = 0.42;
                    pdfTop = 0.42;
                } else {
                    pdfLeft = 0.54;
                    pdfTop = 1;
                }
                break;
            case "2": // minimal
                if (isLandscape) {
                    pdfLeft = 0.07;
                    pdfTop = 0.07;
                } else {
                    pdfLeft = 0.1;
                    pdfTop = 0.58;
                }
                break;
            case "1": // none
                if (isLandscape) {
                    pdfLeft = 0;
                    pdfTop = 0;
                } else {
                    pdfLeft = 0;
                    pdfTop = 0;
                }
                break;
        }
        document.getElementById('preview').style.padding = pdfTop + "in " + pdfLeft + "in";
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
    const renderPreview = (previewElement, html) => {
        previewElement.innerHTML = html;
        Protyle.highlightRender(previewElement, "${servePath}/stage/protyle");
        Protyle.mathRender(previewElement, "${servePath}/stage/protyle", true);
        Protyle.mermaidRender(previewElement, "${servePath}/stage/protyle");
        Protyle.flowchartRender(previewElement, "${servePath}/stage/protyle");
        Protyle.graphvizRender(previewElement, "${servePath}/stage/protyle");
        Protyle.chartRender(previewElement, "${servePath}/stage/protyle");
        Protyle.mindmapRender(previewElement, "${servePath}/stage/protyle");
        Protyle.abcRender(previewElement, "${servePath}/stage/protyle");
        Protyle.plantumlRender(previewElement, "${servePath}/stage/protyle");
        previewElement.querySelectorAll("table").forEach(item => {
            if (item.clientWidth > item.parentElement.clientWidth) {
                item.style.zoom = item.parentElement.clientWidth / item.clientWidth;
            }
        })
    }
    fetchPost("/api/export/exportPreviewHTML", {
        id: "${id}",
        keepFold: ${localData.keepFold},
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
        const previewElement = document.getElementById('preview');
        renderPreview(previewElement, response.data.content);
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
        const actionElement = document.getElementById('action');
        const keepFoldElement = actionElement.querySelector('#keepFold');
        keepFoldElement.addEventListener('change', () => {
            previewElement.innerHTML = '<div class="fn__loading" style="left:0"><img width="48px" src="${servePath}/stage/loading-pure.svg"></div>'
            fetchPost("/api/export/exportPreviewHTML", {
                id: "${id}",
                keepFold: keepFoldElement.checked,
            }, response2 => {
                if (response2.code === 1) {
                    alert(response2.msg)
                    return;
                }
                renderPreview(previewElement, response2.data.content);
            })
        })
        actionElement.querySelector("#scale").addEventListener("input", () => {
            actionElement.querySelector("#scaleTip").innerText = actionElement.querySelector("#scale").value;
        })
        actionElement.querySelector("#marginsType").addEventListener('change', () => {
            setPadding();
        });
        actionElement.querySelector("#landscape").addEventListener('change', () => {
            setPadding();
        });
        actionElement.querySelector('.b3-button--cancel').addEventListener('click', () => {
            const {ipcRenderer}  = require("electron");
            ipcRenderer.send("${Constants.SIYUAN_EXPORT_CLOSE}")
        });
        actionElement.querySelector('.b3-button--text').addEventListener('click', () => {
            const {ipcRenderer}  = require("electron");
            ipcRenderer.send("${Constants.SIYUAN_EXPORT_PDF}", {
              pdfOptions:{
                printBackground: true,
                landscape: actionElement.querySelector("#landscape").checked,
                marginType: actionElement.querySelector("#marginsType").value,
                margins: {
                  top: pdfTop * 0.6,
                  bottom: pdfTop * 0.6,
                  left: 0,
                  right: 0,
                },
                scale:  parseFloat(actionElement.querySelector("#scale").value),
                pageSize: actionElement.querySelector("#pageSize").value,
              },
              keepFold: keepFoldElement.checked,
              removeAssets: actionElement.querySelector("#removeAssets").checked,
              rootId: "${id}",
              rootTitle: response.data.name,
            })
            actionElement.remove();
            previewElement.classList.add("exporting");
            previewElement.style.paddingTop = "0";
            previewElement.style.paddingBottom = "0";
        });
        setPadding()
    });
</script></body></html>`;
    const mainWindow = getCurrentWindow();
    originalZoomFactor = mainWindow.webContents.zoomFactor;
    window.siyuan.printWin = new BrowserWindow({
        parent: mainWindow,
        modal: true,
        show: true,
        width: 1032,
        height: 618,
        resizable: false,
        frame: "darwin" === window.siyuan.config.system.os,
        icon: path.join(window.siyuan.config.system.appDir, "stage", "icon-large.png"),
        titleBarStyle: "hidden",
        webPreferences: {
            contextIsolation: false,
            nodeIntegration: true,
            webviewTag: true,
            webSecurity: false,
        },
    });
    window.siyuan.printWin.webContents.userAgent = `SiYuan/${app.getVersion()} https://b3log.org/siyuan Electron`;
    window.siyuan.printWin.once("ready-to-show", () => {
        // 导出 PDF 预览界面不受主界面缩放影响 https://github.com/siyuan-note/siyuan/issues/6262
        window.siyuan.printWin.webContents.setZoomFactor(1);
    });
    fetchPost("/api/export/exportTempContent", {content: html}, (response) => {
        window.siyuan.printWin.loadURL(response.data.url);
    });
};

export const destroyPrintWindow = () => {
    getCurrentWindow().webContents.setZoomFactor(originalZoomFactor);
    window.siyuan.printWin.destroy();
};

const getExportPath = (option: { type: string, id: string }, removeAssets?: boolean) => {
    fetchPost("/api/block/getBlockInfo", {
        id: option.id
    }, (response) => {
        if (response.code === 2) {
            // 文件被锁定
            lockFile(response.data);
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
                const savePath = result.filePaths[0].endsWith(response.data.rootTitle) ? result.filePaths[0] : path.join(result.filePaths[0], replaceLocalPath(response.data.rootTitle));
                fetchPost(url, {
                    id: option.id,
                    pdf: option.type === "pdf",
                    removeAssets,
                    savePath
                }, exportResponse => {
                    if (option.type === "word") {
                        if (exportResponse.code === 1) {
                            showMessage(exportResponse.msg, undefined, "error");
                            hideMessage(msgId);
                            return;
                        }
                        afterExport(savePath, msgId);
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

    const html = `<!DOCTYPE html><html>
<head>
    <meta charset="utf-8">
    <meta http-equiv="X-UA-Compatible" content="IE=edge">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=0"/>
    <meta name="apple-mobile-web-app-capable" content="yes">
    <meta name="mobile-web-app-capable" content="yes"/>
    <meta name="apple-mobile-web-app-status-bar-style" content="black">
    <link rel="stylesheet" type="text/css" id="themeDefaultStyle" href="stage/build/export/base.css?${Constants.SIYUAN_VERSION}"/>
    <link rel="stylesheet" type="text/css" id="themeStyle" href="appearance/themes/${themeName}/${window.siyuan.config.appearance.customCSS ? "custom" : "theme"}.css?${Constants.SIYUAN_VERSION}"/>
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
    Protyle.plantumlRender(previewElement, "stage/protyle");
    Protyle.mediaRender(previewElement);
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

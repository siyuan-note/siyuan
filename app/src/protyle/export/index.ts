import {hideMessage, showMessage} from "../../dialog/message";
import {Constants} from "../../constants";
/// #if !BROWSER
import {OpenDialogReturnValue, ipcRenderer} from "electron";
import {BrowserWindow, dialog} from "@electron/remote";
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
const destroyWin = (win: Electron.BrowserWindow) => {
    setTimeout(() => {
        win.destroy();
    }, 1000);
};

const renderPDF = (id: string) => {
    const localData = JSON.parse(localStorage.getItem(Constants.LOCAL_EXPORTPDF) || JSON.stringify({
        printBackground: true,
        landscape: false,
        marginsType: 0,
        scaleFactor: 100,
        pageSize: "A4",
        removeAssets: true,
    }));
    const servePath = window.location.protocol + "//" + window.location.host;
    const win = new BrowserWindow({
        show: true,
        width: 1032,
        resizable: false,
        frame: "darwin" === window.siyuan.config.system.os,
        titleBarStyle: "hidden",
        webPreferences: {
            contextIsolation: false,
            nodeIntegration: true,
            webviewTag: true,
            webSecurity: false,
        },
    });
    ipcRenderer.on(Constants.SIYUAN_EXPORT_CLOSE, () => {
        win.destroy();
    });
    ipcRenderer.on(Constants.SIYUAN_EXPORT_PDF, (e, ipcData) => {
        dialog.showOpenDialog({
            title: window.siyuan.languages.export + " PDF",
            properties: ["createDirectory", "openDirectory"],
        }).then((result: OpenDialogReturnValue) => {
            if (!result.canceled) {
                const msgId = showMessage(window.siyuan.languages.exporting, -1);
                const filePath = result.filePaths[0].endsWith(ipcData.rootTitle) ? result.filePaths[0] : path.join(result.filePaths[0], replaceLocalPath(ipcData.rootTitle));
                localStorage.setItem(Constants.LOCAL_EXPORTPDF, JSON.stringify(Object.assign(ipcData.pdfOptions, {removeAssets: ipcData.removeAssets})));
                try {
                    win.webContents.printToPDF(ipcData.pdfOptions).then((pdfData) => {
                        fetchPost("/api/export/exportHTML", {
                            id: ipcData.rootId,
                            pdf: true,
                            removeAssets: ipcData.removeAssets,
                            savePath: filePath
                        }, () => {
                            const pdfFilePath = path.join(filePath, path.basename(filePath) + ".pdf");
                            fs.writeFileSync(pdfFilePath, pdfData);
                            fetchPost("/api/export/addPDFOutline", {
                                id: ipcData.rootId,
                                path: pdfFilePath
                            }, () => {
                                afterExport(pdfFilePath, msgId);
                                if (ipcData.removeAssets) {
                                    const removePromise = (dir: string) => {
                                        return new Promise(function (resolve) {
                                            //先读文件夹
                                            fs.stat(dir, function (err, stat) {
                                                if (stat) {
                                                    if (stat.isDirectory()) {
                                                        fs.readdir(dir, function (err, files) {
                                                            files = files.map(file => path.join(dir, file)); // a/b  a/m
                                                            Promise.all(files.map(file => removePromise(file))).then(function () {
                                                                fs.rmdir(dir, resolve);
                                                            });
                                                        });
                                                    } else {
                                                        fs.unlink(dir, resolve);
                                                    }
                                                }
                                            });
                                        });
                                    };
                                    removePromise(path.join(filePath, "assets"));
                                }
                            });
                        });
                        destroyWin(win);
                    }).catch((error: string) => {
                        showMessage("Export PDF error:" + error, 0, "error", msgId);
                        destroyWin(win);
                    });
                } catch (e) {
                    showMessage("Export PDF error:" + e + ". Export HTML and use Chrome's printing function to convert to PDF", 0, "error", msgId);
                    destroyWin(win);
                }
            } else {
                destroyWin(win);
            }
        });
    });
    fetchPost("/api/export/exportPreviewHTML", {
        id,
    }, response => {
        let pdfWidth = "";
        if (localData.pageSize === "A3") {
            if (localData.landscape) {
                pdfWidth = "16.5";
            } else {
                pdfWidth = "11.7";
            }
        } else if (localData.pageSize === "A4") {
            if (localData.landscape) {
                pdfWidth = "11.7";
            } else {
                pdfWidth = "8.8";
            }
        } else if (localData.pageSize === "A5") {
            if (localData.landscape) {
                pdfWidth = "8.3";
            } else {
                pdfWidth = "5.8";
            }
        } else if (localData.pageSize === "Legal") {
            if (localData.landscape) {
                pdfWidth = "14";
            } else {
                pdfWidth = "8.5";
            }
        } else if (localData.pageSize === "Letter") {
            if (localData.landscape) {
                pdfWidth = "11";
            } else {
                pdfWidth = "8.5";
            }
        } else if (localData.pageSize === "Tabloid") {
            if (localData.landscape) {
                pdfWidth = "17";
            } else {
                pdfWidth = "11";
            }
        }
        let pdfMargin = "0.66";
        if (localData.landscape) {
            pdfMargin = "1.69";
        }
        if (localData.marginsType !== 0) {
            if (localData.landscape) {
                pdfMargin = "1.69";
            } else {
                pdfMargin = "0.3";
            }
        }
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
    <title>${response.data.name} - ${window.siyuan.languages.siyuanNote}  v${Constants.SIYUAN_VERSION}</title>
    <style>
          body {
            margin: 0;
          }
          
          #action {
                width: 200px;
                background: var(--b3-theme-background-light);
                padding: 8px 16px;
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
         
        ::-webkit-scrollbar {
          width: 0px;
          height: 0px;
        }
        pre code {
            max-height: none !important;
            word-break: break-all !important;
            white-space: pre-wrap !important;
        }
        .protyle-wysiwyg {
            box-sizing: border-box;
            padding: 34px ${pdfMargin}in 16px;
            width: ${pdfWidth}in
        }
        .b3-label {
            border-bottom: 1px solid var(--b3-border-color);
            display: block;
            color: var(--b3-theme-on-surface);
            padding-bottom: 16px;
            margin-bottom: 16px;
        }
        ${setInlineStyle(false)}
    </style>
</head>
<body>
<div class="protyle-wysiwyg protyle-wysiwyg--attr" id="preview">${response.data.content.replace(/<iframe /g, "<no-iframe ")}</div>
<div id="action">
    <h2 class="b3-label">${window.siyuan.languages.config}</h2>
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
            <option ${localData.marginsType === 0 ? "selected" : ""} value="0">Default</option>
            <option ${localData.marginsType === 1 ? "selected" : ""} value="1">None</option>
            <option ${localData.marginsType === 2 ? "selected" : ""} value="2">Minimal</option>
        </select>
    </label>
    <label class="b3-label">
        <div>
            ${window.siyuan.languages.exportPDF3}
        </div>
        <span class="fn__hr"></span>
        <input style="width: 192px" value="${localData.scaleFactor}" id="scaleFactor" step="1" class="b3-slider" type="range" min="0" max="100">
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
    <div class="fn__flex">
      <div class="fn__flex-1"></div>
      <button class="b3-button b3-button--cancel">${window.siyuan.languages.cancel}</button>
      <div class="fn__space"></div>
      <button class="b3-button b3-button--text">${window.siyuan.languages.confirm}</button>
    </div>
</div>
<script src="${servePath}/appearance/icons/${window.siyuan.config.appearance.icon}/icon.js?${Constants.SIYUAN_VERSION}"></script>
<script src="${servePath}/stage/build/export/protyle-method.js?${Constants.SIYUAN_VERSION}"></script>
<script src="${servePath}/stage/protyle/js/lute/lute.min.js?${Constants.SIYUAN_VERSION}"></script>    
<script>
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
    Protyle.highlightRender(previewElement, "${servePath}/stage/protyle");
    Protyle.mathRender(previewElement, "${servePath}/stage/protyle", true);
    Protyle.mermaidRender(previewElement, "${servePath}/stage/protyle");
    Protyle.flowchartRender(previewElement, "${servePath}/stage/protyle");
    Protyle.graphvizRender(previewElement, "${servePath}/stage/protyle");
    Protyle.chartRender(previewElement, "${servePath}/stage/protyle");
    Protyle.mindmapRender(previewElement, "${servePath}/stage/protyle");
    Protyle.abcRender(previewElement, "${servePath}/stage/protyle");
    Protyle.plantumlRender(previewElement, "${servePath}/stage/protyle");
    previewElement.querySelectorAll(".protyle-action__copy").forEach((item) => {
      item.addEventListener("click", (event) => {
            navigator.clipboard.writeText(item.parentElement.nextElementSibling.textContent.trimEnd());
            event.preventDefault();
            event.stopPropagation();
      })
    });
    previewElement.querySelectorAll("table").forEach(item => {
        if (item.clientWidth > item.parentElement.clientWidth) {
            item.style.zoom = item.parentElement.clientWidth / item.clientWidth;
        }
    })
    const actionElement = document.getElementById('action');
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
            marginsType: parseInt(actionElement.querySelector("#marginsType").value),
            scaleFactor: parseInt(actionElement.querySelector("#scaleFactor").value),
            pageSize: actionElement.querySelector("#pageSize").value,
          },
          removeAssets: actionElement.querySelector("#removeAssets").checked,
          rootId: "${id}",
          rootTitle: "${response.data.name}"
        })
        actionElement.remove();
    });
</script></body></html>`;
        win.loadURL("data:text/html;charset=UTF-8," + encodeURIComponent(html));
    });
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
<div class="${["htmlmd", "word"].includes(type) ? "b3-typography" : "protyle-wysiwyg protyle-wysiwyg--attr"}" style="max-width: 800px;margin: 0 auto;" id="preview">${data.data.content}</div>
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

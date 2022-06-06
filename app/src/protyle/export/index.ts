import {hideMessage, showMessage} from "../../dialog/message";
import {Constants} from "../../constants";
/// #if !BROWSER
import {PrintToPDFOptions, SaveDialogReturnValue} from "electron";
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

export const saveExport = (option: { type: string, id: string }) => {
    /// #if !BROWSER
    if (option.type === "pdf") {
        const localData = JSON.parse(localStorage.getItem(Constants.LOCAL_EXPORTPDF) || JSON.stringify({
            printBackground: true,
            landscape: false,
            marginsType: 0,
            scaleFactor: 100,
            pageSize: "A4",
            removeAssets: true,
        }));
        const pdfDialog = new Dialog({
            title: "PDF " + window.siyuan.languages.config,
            content: `<div class="b3-dialog__content">
    <label class="fn__flex b3-label">
        <div class="fn__flex-1">
            ${window.siyuan.languages.exportPDF0}
        </div>
        <span class="fn__space"></span>
        <select class="b3-select" id="pageSize">
            <option ${localData.pageSize === "A3" ? "selected" : ""} value="A3">A3</option>
            <option ${localData.pageSize === "A4" ? "selected" : ""} value="A4">A4</option>
            <option ${localData.pageSize === "A5" ? "selected" : ""} value="A5">A5</option>
            <option ${localData.pageSize === "Legal" ? "selected" : ""} value="Legal">Legal</option>
            <option ${localData.pageSize === "Letter" ? "selected" : ""} value="Letter">Letter</option>
            <option ${localData.pageSize === "Tabloid" ? "selected" : ""} value="Tabloid">Tabloid</option>
        </select>
    </label>
    <label class="fn__flex b3-label">
        <div class="fn__flex-1">
            ${window.siyuan.languages.exportPDF2}
        </div>
        <span class="fn__space"></span>
        <select class="b3-select" id="marginsType">
            <option ${localData.marginsType === 0 ? "selected" : ""} value="0">Default</option>
            <option ${localData.marginsType === 1 ? "selected" : ""} value="1">None</option>
            <option ${localData.marginsType === 2 ? "selected" : ""} value="2">Minimal</option>
        </select>
    </label>
    <label class="fn__flex b3-label">
        <div class="fn__flex-1">
            ${window.siyuan.languages.exportPDF3}
        </div>
        <span class="fn__space"></span>
        <input value="${localData.scaleFactor}" id="scaleFactor" step="1" class="b3-slider" type="range" min="0" max="100">
    </label>
    <label class="fn__flex b3-label">
        <div class="fn__flex-1">
            ${window.siyuan.languages.exportPDF1}
        </div>
        <span class="fn__space"></span>
        <input id="landscape" class="b3-switch" type="checkbox" ${localData.landscape ? "checked" : ""}>
    </label>
    <label class="fn__flex b3-label">
        <div class="fn__flex-1">
            ${window.siyuan.languages.exportPDF4}
        </div>
        <span class="fn__space"></span>
        <input id="removeAssets" class="b3-switch" type="checkbox" ${localData.removeAssets ? "checked" : ""}>
    </label>
</div>
<div class="b3-dialog__action">
    <button class="b3-button b3-button--cancel">${window.siyuan.languages.cancel}</button><div class="fn__space"></div>
    <button class="b3-button b3-button--text">${window.siyuan.languages.confirm}</button>
</div>`,
            width: "520px",
        });
        const btnsElement = pdfDialog.element.querySelectorAll(".b3-button");
        btnsElement[0].addEventListener("click", () => {
            pdfDialog.destroy();
        });
        btnsElement[1].addEventListener("click", () => {
            const options: PrintToPDFOptions = {
                printBackground: true,
                landscape: (pdfDialog.element.querySelector("#landscape") as HTMLInputElement).checked,
                marginsType: parseInt((pdfDialog.element.querySelector("#marginsType") as HTMLInputElement).value),
                scaleFactor: parseInt((pdfDialog.element.querySelector("#scaleFactor") as HTMLInputElement).value),
                pageSize: (pdfDialog.element.querySelector("#pageSize") as HTMLSelectElement).value,
            };
            const removeAssets = (pdfDialog.element.querySelector("#removeAssets") as HTMLInputElement).checked;
            localStorage.setItem(Constants.LOCAL_EXPORTPDF, JSON.stringify(Object.assign(options, {removeAssets})));
            if (window.siyuan.config.appearance.mode === 1) {
                confirmDialog(window.siyuan.languages.pdfTip, window.siyuan.languages.pdfConfirm, () => {
                    getExportPath(option, options, removeAssets);
                    pdfDialog.destroy();
                });
            } else {
                getExportPath(option, options, removeAssets);
                pdfDialog.destroy();
            }
        });
        return;
    }
    getExportPath(option);
    /// #endif
};

/// #if !BROWSER
const getExportPath = (option: { type: string, id: string }, pdfOption?: PrintToPDFOptions, removeAssets?: boolean) => {
    fetchPost("/api/block/getBlockInfo", {
        id: option.id
    }, (response) => {
        if (response.code === 2) {
            // 文件被锁定
            lockFile(response.data);
            return;
        }
        dialog.showSaveDialog({
            defaultPath: response.data.rootTitle,
            properties: ["showOverwriteConfirmation"],
        }).then((result: SaveDialogReturnValue) => {
            if (!result.canceled) {
                const id = showMessage(window.siyuan.languages.exporting, -1);
                let url = "/api/export/exportHTML";
                if (option.type === "htmlmd") {
                    url = "/api/export/exportMdHTML";
                } else if (option.type === "word") {
                    url = "/api/export/exportDocx";
                }
                fetchPost(url, {
                    id: option.id,
                    pdf: option.type === "pdf",
                    savePath: result.filePath
                }, exportResponse => {
                    if (option.type === "word") {
                        afterExport(result.filePath, id);
                    } else {
                        onExport(exportResponse, result.filePath, option.type, pdfOption, removeAssets, id);
                    }
                });
            }
        });
    });
};

const onExport = (data: IWebSocketData, filePath: string, type: string, pdfOptions?: PrintToPDFOptions, removeAssets?: boolean, msgId?:string) => {
    let themeName = window.siyuan.config.appearance.themeLight;
    let mode = 0;
    if (["html", "htmlmd"].includes(type) && window.siyuan.config.appearance.mode === 1) {
        themeName = window.siyuan.config.appearance.themeDark;
        mode = 1;
    }
    let style = "";
    const servePath = window.location.protocol + "//" + window.location.host;
    let cdn = servePath + "/stage/protyle";
    let mediaRenderScript = "";
    let urlPrefix = servePath + "/";
    let tableZoom = "";
    if (type === "pdf") {
        data.data.content = data.data.content.replace(/<iframe /g, "<no-iframe ");
        let pdfWidth = "";
        if (pdfOptions.pageSize === "A3") {
            if (pdfOptions.landscape) {
                pdfWidth = "16.5";
            } else {
                pdfWidth = "11.7";
            }
        } else if (pdfOptions.pageSize === "A4") {
            if (pdfOptions.landscape) {
                pdfWidth = "11.7";
            } else {
                pdfWidth = "8.8";
            }
        } else if (pdfOptions.pageSize === "A5") {
            if (pdfOptions.landscape) {
                pdfWidth = "8.3";
            } else {
                pdfWidth = "5.8";
            }
        } else if (pdfOptions.pageSize === "Legal") {
            if (pdfOptions.landscape) {
                pdfWidth = "14";
            } else {
                pdfWidth = "8.5";
            }
        } else if (pdfOptions.pageSize === "Letter") {
            if (pdfOptions.landscape) {
                pdfWidth = "11";
            } else {
                pdfWidth = "8.5";
            }
        } else if (pdfOptions.pageSize === "Tabloid") {
            if (pdfOptions.landscape) {
                pdfWidth = "17";
            } else {
                pdfWidth = "11";
            }
        }
        let pdfMargin = "0.66";
        if (pdfOptions.landscape) {
            pdfMargin = "1.69";
        }
        if (pdfOptions.marginsType !== 0) {
            if (pdfOptions.landscape) {
                pdfMargin = "1.69";
            } else {
                pdfMargin = "0.3";
            }
        }
        style = `::-webkit-scrollbar {
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
}`;

        tableZoom = `previewElement.querySelectorAll("table").forEach(item => {
        if (item.clientWidth > item.parentElement.clientWidth) {
            item.style.zoom = item.parentElement.clientWidth / item.clientWidth;
        }
    })`;
    } else {
        mediaRenderScript = "Protyle.mediaRender(previewElement);";
        style = "body {background-color: var(--b3-theme-background);color: var(--b3-theme-on-background)}";
        urlPrefix = "";
        cdn = "stage/protyle";
    }
    // 导出 html、pdf
    const html = `<!DOCTYPE html><html>
<head>
    <meta charset="utf-8">
    <meta http-equiv="X-UA-Compatible" content="IE=edge">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=0"/>
    <meta name="apple-mobile-web-app-capable" content="yes">
    <meta name="mobile-web-app-capable" content="yes"/>
    <meta name="apple-mobile-web-app-status-bar-style" content="black">
    <link rel="stylesheet" type="text/css" id="themeDefaultStyle" href="${urlPrefix}stage/build/export/base.css?${Constants.SIYUAN_VERSION}"/>
    <link rel="stylesheet" type="text/css" id="themeStyle" href="${urlPrefix}appearance/themes/${themeName}/${window.siyuan.config.appearance.customCSS ? "custom" : "theme"}.css?${Constants.SIYUAN_VERSION}"/>
    <title>${pathPosix().basename(filePath)} - ${window.siyuan.languages.siyuanNote}  v${Constants.SIYUAN_VERSION}</title>
    <style>
        ${style}
        ${setInlineStyle(false)}
    </style>
</head>
<body>
<div class="${["htmlmd", "word"].includes(type) ? "b3-typography" : "protyle-wysiwyg protyle-wysiwyg--attr"}" style="max-width: 800px;margin: 0 auto;" id="preview">${data.data.content}</div>
<script src="${urlPrefix}appearance/icons/${window.siyuan.config.appearance.icon}/icon.js?${Constants.SIYUAN_VERSION}"></script>
<script src="${urlPrefix}stage/build/export/protyle-method.js?${Constants.SIYUAN_VERSION}"></script>
<script src="${urlPrefix}stage/protyle/js/lute/lute.min.js?${Constants.SIYUAN_VERSION}"></script>    
<script>
    window.siyuan = {
      config: {
        appearance: { mode: ${mode}, codeBlockThemeDark: "${window.siyuan.config.appearance.codeBlockThemeDark}", codeBlockThemeLight: "${window.siyuan.config.appearance.codeBlockThemeLight}" },
        editor: { 
          codeLineWrap: true,
          codeLigatures: ${window.siyuan.config.editor.codeLigatures},
          plantUMLServePath: "${window.siyuan.config.editor.plantUMLServePath}",
          codeSyntaxHighlightLineNum: ${window.siyuan.config.editor.codeSyntaxHighlightLineNum},
        }
      },
      languages: {copy:"${window.siyuan.languages.copy}"}
    };
    const previewElement = document.getElementById('preview');
    Protyle.highlightRender(previewElement, "${cdn}");
    Protyle.mathRender(previewElement, "${cdn}", ${type === "pdf"});
    Protyle.mermaidRender(previewElement, "${cdn}");
    Protyle.flowchartRender(previewElement, "${cdn}");
    Protyle.graphvizRender(previewElement, "${cdn}");
    Protyle.chartRender(previewElement, "${cdn}");
    Protyle.mindmapRender(previewElement, "${cdn}");
    Protyle.abcRender(previewElement, "${cdn}");
    Protyle.plantumlRender(previewElement, "${cdn}");
    ${mediaRenderScript}
    document.querySelectorAll(".protyle-action__copy").forEach((item) => {
      item.addEventListener("click", (event) => {
            navigator.clipboard.writeText(item.parentElement.nextElementSibling.textContent.trimEnd());
            event.preventDefault();
            event.stopPropagation();
      })
    });
    ${tableZoom}
</script></body></html>`;

    if (type === "pdf") {
        const win = new BrowserWindow({
            show: false,
            width: 860,
            webPreferences: {
                nodeIntegration: true,
                webviewTag: true,
                webSecurity: false,
            },
        });
        require("@electron/remote/main").enable(win.webContents);
        win.loadURL("data:text/html;charset=UTF-8," + encodeURIComponent(html));
        const timeout = 1000 + (html.split('data-type="NodeCodeBlock"').length - 1) * 360;
        win.webContents.on("did-finish-load", () => {
            setTimeout(() => {
                try {
                    win.webContents.printToPDF(pdfOptions).then((pdfData) => {
                        const pdfFilePath = path.join(filePath, path.basename(filePath) + ".pdf");
                        fs.writeFileSync(pdfFilePath, pdfData);
                        fetchPost("/api/export/addPDFOutline", {
                            id: data.data.id,
                            path: pdfFilePath
                        }, () => {
                            afterExport(pdfFilePath, msgId);
                            if (removeAssets) {
                                const removePromise = (dir: string) => {
                                    return new Promise(function (resolve) {
                                        //先读文件夹
                                        fs.stat(dir, function (err, stat) {
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
                                        });
                                    });
                                };
                                removePromise(path.join(filePath, "assets"));
                            }
                        });
                        win.destroy();
                    }).catch((error: string) => {
                        showMessage("Export PDF error:" + error, 0);
                        win.destroy();
                    });
                } catch (e) {
                    showMessage("Export PDF error:" + e + ". Export HTML and use Chrome's printing function to convert to PDF", 0);
                }
            }, Math.min(timeout, 10000));
        });
    } else {
        const htmlPath = path.join(filePath, "index.html");
        fs.writeFileSync(htmlPath, html);
        afterExport(htmlPath, msgId);
    }
};
/// #endif

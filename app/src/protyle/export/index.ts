import {hideMessage, showMessage} from "../../dialog/message";
import {Constants} from "../../constants";
/// #if !BROWSER
import {ipcRenderer} from "electron";
import * as fs from "fs";
import * as path from "path";
import {afterExport} from "./util";
/// #endif
import {confirmDialog} from "../../dialog/confirmDialog";
import {getThemeMode, setInlineStyle} from "../../util/assets";
import {fetchPost, fetchSyncPost} from "../../util/fetch";
import {Dialog} from "../../dialog";
import {replaceLocalPath} from "../../editor/rename";
import {getScreenWidth, isInAndroid, isInHarmony, isInIOS, setStorageVal} from "../util/compatibility";
import {getFrontend} from "../../util/functions";

const getPluginStyle = async () => {
    const response = await fetchSyncPost("/api/petal/loadPetals", {frontend: getFrontend()});
    let css = "";
    // 为加快启动速度，不进行 await
    response.data.forEach((item: IPluginData) => {
        css += item.css || "";
    });
    return css;
};

const getIconScript = (servePath: string) => {
    const isBuiltInIcon = ["ant", "material"].includes(window.siyuan.config.appearance.icon);
    const html = isBuiltInIcon ? "" : `<script src="${servePath}appearance/icons/material/icon.js?v=${Constants.SIYUAN_VERSION}"></script>`;
    return html + `<script src="${servePath}appearance/icons/${window.siyuan.config.appearance.icon}/icon.js?v=${Constants.SIYUAN_VERSION}"></script>`;
};

export const saveExport = (option: IExportOptions) => {
    /// #if BROWSER
    if (["html", "htmlmd"].includes(option.type)) {
        const msgId = showMessage(window.siyuan.languages.exporting, -1);
        // 浏览器环境：先调用 API 生成资源文件，再在前端生成完整的 HTML
        const url = option.type === "htmlmd" ? "/api/export/exportMdHTML" : "/api/export/exportHTML";
        fetchPost(url, {
            id: option.id,
            pdf: false,
            removeAssets: false,
            merge: true,
            savePath: ""
        }, async exportResponse => {
            const html = await onExport(exportResponse, undefined, "", option);
            fetchPost("/api/export/exportBrowserHTML", {
                folder: exportResponse.data.folder,
                html: html,
                name: exportResponse.data.name
            }, zipResponse => {
                hideMessage(msgId);
                if (zipResponse.code === -1) {
                    showMessage(window.siyuan.languages._kernel[14].replace("%s", zipResponse.msg), 0, "error");
                    return;
                }
                window.open(zipResponse.data.zip);
                showMessage(window.siyuan.languages.exported);
            });
        });
        return;
    }
    /// #else
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
        wordDialog.element.setAttribute("data-key", Constants.DIALOG_EXPORTWORD);
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
        getExportPath(option, false, true);
    }
    /// #endif
};

const getSnippetCSS = () => {
    let snippetCSS = "";
    document.querySelectorAll("style").forEach((item) => {
        if (item.id.startsWith("snippetCSS")) {
            snippetCSS += item.outerHTML;
        }
    });
    return snippetCSS;
};

const getSnippetJS = () => {
    let snippetScript = "";
    document.querySelectorAll("script").forEach((item) => {
        if (item.id.startsWith("snippetJS")) {
            snippetScript += item.outerHTML;
        }
    });
    return snippetScript;
};

/// #if !BROWSER
const renderPDF = async (id: string) => {
    const localData = window.siyuan.storage[Constants.LOCAL_EXPORTPDF];
    if (typeof localData.paged === "undefined") {
        localData.paged = true;
    }
    const servePathWithoutTrailingSlash = window.location.protocol + "//" + window.location.host;
    const servePath = servePathWithoutTrailingSlash + "/";
    const isDefault = (window.siyuan.config.appearance.mode === 1 && window.siyuan.config.appearance.themeDark === "midnight") || (window.siyuan.config.appearance.mode === 0 && window.siyuan.config.appearance.themeLight === "daylight");
    let themeStyle = "";
    if (!isDefault) {
        themeStyle = `<link rel="stylesheet" type="text/css" id="themeStyle" href="${servePath}appearance/themes/${window.siyuan.config.appearance.themeLight}/theme.css?${Constants.SIYUAN_VERSION}"/>`;
    }
    const currentWindowId = await ipcRenderer.invoke(Constants.SIYUAN_GET, {
        cmd: "getContentsId",
    });
    // data-theme-mode="light" https://github.com/siyuan-note/siyuan/issues/7379
    const html = `<!DOCTYPE html>
<html lang="${window.siyuan.config.appearance.lang}" data-theme-mode="light" data-light-theme="${window.siyuan.config.appearance.themeLight}" data-dark-theme="${window.siyuan.config.appearance.themeDark}">
<head>
    <base href="${servePath}">
    <meta charset="utf-8">
    <meta http-equiv="X-UA-Compatible" content="IE=edge">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=0"/>
    <meta name="mobile-web-app-capable" content="yes"/>
    <meta name="apple-mobile-web-app-status-bar-style" content="black">
    <link rel="stylesheet" type="text/css" id="baseStyle" href="${servePath}stage/build/export/base.css?v=${Constants.SIYUAN_VERSION}"/>
    <link rel="stylesheet" type="text/css" id="themeDefaultStyle" href="${servePath}appearance/themes/daylight/theme.css?v=${Constants.SIYUAN_VERSION}"/>
    <script src="${servePath}stage/protyle/js/protyle-html.js?v=${Constants.SIYUAN_VERSION}"></script>
    ${themeStyle}
    <title>${window.siyuan.languages.export} PDF</title>
    <style>
        body {
          margin: 0;
          font-family: var(--b3-font-family);
        }
        
        #action {
          width: 232px;
          background: var(--b3-theme-surface);
          padding: 12px 0;
          position: fixed;
          right: 0;
          top: 0;
          overflow-y: auto;
          bottom: 0;
          overflow-x: hidden;
          z-index: 1;
          display: flex;
          flex-direction: column;
        }
        
        #preview {
          max-width: 800px;
          margin: 0 auto;
          position: absolute;
          right: 232px;
          left: 0;
          box-sizing: border-box;
        }
        
        #preview.exporting {
          position: inherit;
          max-width: none;
        }
        
        .b3-switch {
            margin-left: 14px;
        }
        
        .exporting::-webkit-scrollbar {
          width: 0;
          height: 0;
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
          padding-bottom: 12px;
          margin: 0 12px 12px 12px;
        }
        
        .b3-label:last-child {
            border-bottom: none;
        }
        
        #preview .render-node[data-subtype="plantuml"] object {
            max-width: 100%;
        }
        ${await setInlineStyle(false, servePath)}
        ${await getPluginStyle()}
    </style>
    ${getSnippetCSS()}
</head>
<body style="-webkit-print-color-adjust: exact;">
<div id="action">
    <div style="flex: 1;overflow-y:auto;overflow-x:hidden">
        <div class="b3-label">
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
        </div>
        <div class="b3-label">
            <div>
                ${window.siyuan.languages.exportPDF2}
            </div>
            <span class="fn__hr"></span>
            <select class="b3-select" id="marginsType">
                <option ${localData.marginType === "default" ? "selected" : ""} value="default">${window.siyuan.languages.defaultMargin}</option>
                <option ${localData.marginType === "none" ? "selected" : ""} value="none">${window.siyuan.languages.noneMargin}</option>
                <option ${localData.marginType === "printableArea" ? "selected" : ""} value="printableArea">${window.siyuan.languages.minimalMargin}</option>
                <option ${localData.marginType === "custom" ? "selected" : ""} value="custom">${window.siyuan.languages.customMargin}</option>
            </select>
            <div class="${localData.marginType === "custom" ? "" : "fn__none"}">
                <span class="fn__hr"></span>
                <small>${window.siyuan.languages.marginTop}</small>
                <div class="fn__hr--small"></div>
                <div class="fn__flex">
                    <input id="marginsTop" class="b3-text-field fn__block" value="${localData.marginTop || 0}" type="number" min="0" step="0.01">
                    <span class="fn__space"></span>
                    <small class="fn__flex-center" style="white-space: nowrap;">${window.siyuan.languages.unitInches}</small>
                </div>
                <div class="fn__hr"></div>
                <small>${window.siyuan.languages.marginRight}</small>
                <div class="fn__hr--small"></div>
                <div class="fn__flex">
                    <input id="marginsRight" class="b3-text-field fn__block" value="${localData.marginRight || 0}" type="number" min="0" step="0.01">
                    <span class="fn__space"></span>
                    <small class="fn__flex-center" style="white-space: nowrap;">${window.siyuan.languages.unitInches}</small>
                </div>
                <div class="fn__hr"></div>
                <small>${window.siyuan.languages.marginBottom}</small>
                <div class="fn__hr--small"></div>
                <div class="fn__flex">
                    <input id="marginsBottom" class="b3-text-field fn__block" value="${localData.marginBottom || 0}" type="number" min="0" step="0.01">
                    <span class="fn__space"></span>
                    <small class="fn__flex-center" style="white-space: nowrap;">${window.siyuan.languages.unitInches}</small>
                </div>
                <div class="fn__hr"></div>
                <small>${window.siyuan.languages.marginLeft}</small>
                <div class="fn__hr--small"></div>
                <div class="fn__flex">
                    <input id="marginsLeft" class="b3-text-field fn__block" value="${localData.marginLeft || 0}" type="number" min="0" step="0.01">
                    <span class="fn__space"></span>
                    <small class="fn__flex-center" style="white-space: nowrap;">${window.siyuan.languages.unitInches}</small>
                </div>
            </div>
        </div>
        <div class="b3-label">
            <div>
                ${window.siyuan.languages.exportPDF3}
                <span id="scaleTip" style="float: right;color: var(--b3-theme-on-background);">${localData.scale || 1}</span>
            </div>
            <span class="fn__hr"></span>
            <input style="width: 189px" value="${localData.scale || 1}" id="scale" step="0.1" class="b3-slider" type="range" min="0.1" max="2">
        </div>
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
        <label class="b3-label">
            <div>
                ${window.siyuan.languages.export27}
            </div>
            <span class="fn__hr"></span>
            <input id="watermark" class="b3-switch" type="checkbox" ${localData.watermark ? "checked" : ""}>
        </label>
        <label class="b3-label">
            <div>
                ${window.siyuan.languages.paged}
            </div>
            <span class="fn__hr"></span>
            <input id="paged" class="b3-switch" type="checkbox" ${localData.paged ? "checked" : ""}>
        </label>
    </div>
    <div class="fn__flex" style="padding: 0 12px">
      <div class="fn__flex-1"></div>
      <button class="b3-button b3-button--cancel">${window.siyuan.languages.cancel}</button>
      <div class="fn__space"></div>
      <button class="b3-button b3-button--text">${window.siyuan.languages.confirm}</button>
    </div>
</div>
<div style="zoom:${localData.scale || 1}" id="preview">
    <div class="fn__loading" style="left:0;height:100vh"><img width="48px" src="${servePath}stage/loading-pure.svg"></div>
</div>
${getIconScript(servePath)}
<script src="${servePath}stage/build/export/protyle-method.js?${Constants.SIYUAN_VERSION}"></script>
<script src="${servePath}stage/protyle/js/lute/lute.min.js?${Constants.SIYUAN_VERSION}"></script>    
<script>
    const previewElement = document.getElementById('preview');
    const fixBlockWidth = () => {
        const isLandscape = document.querySelector("#landscape").checked;
        let width = 800
        switch (document.querySelector("#action #pageSize").value) {
            case "A3":
              width = isLandscape ? 1587.84 : 1122.24 
              break;
            case "A4":
              width = isLandscape ? 1122.24 : 793.92
              break;
            case "A5":
              width = isLandscape ? 793.92 : 559.68
              break;
            case "Legal":
              width = isLandscape ? 1344: 816 
              break;
            case "Letter":
              width = isLandscape ? 1056 : 816
              break;
            case "Tabloid":
              width = isLandscape ? 1632 : 1056
              break;
        }
        width = width / parseFloat(document.querySelector("#scale").value);
        previewElement.style.width = width + "px";
        width = width - parseFloat(previewElement.style.paddingLeft) * 96 * 2;
        // 为保持代码块宽度一致，全部都进行宽度设定 https://github.com/siyuan-note/siyuan/issues/7692 
        previewElement.querySelectorAll('.hljs').forEach((item) => {
            // 强制换行 https://ld246.com/article/1679228783553
            item.parentElement.setAttribute("linewrap", "true");
            item.parentElement.style.width = "";
            item.parentElement.style.boxSizing = "border-box";
            item.parentElement.style.width = Math.min(item.parentElement.clientWidth, width) + "px";
            item.removeAttribute('data-render');
        })
        Protyle.highlightRender(previewElement, "${servePath}stage/protyle", document.querySelector("#scale").value);
        previewElement.querySelectorAll('[data-type="NodeMathBlock"]').forEach((item) => {
            // 超级块内不能移除 width https://github.com/siyuan-note/siyuan/issues/14318
            item.removeAttribute('data-render');
        })
        previewElement.querySelectorAll('[data-type="NodeCodeBlock"][data-subtype="mermaid"] svg').forEach((item) => {
            item.style.maxHeight = width * 1.414 + "px";
        })
        Protyle.mathRender(previewElement, "${servePath}stage/protyle", true);
        previewElement.querySelectorAll("table").forEach(item => {
            if (item.clientWidth > item.parentElement.clientWidth) {
                item.style.zoom = (item.parentElement.clientWidth / item.clientWidth).toFixed(2) - 0.01;
                item.parentElement.style.overflow = "hidden";
            }
        })
    }
    const setPadding = () => {
        const isLandscape = document.querySelector("#landscape").checked;
        const topElement = document.querySelector("#marginsTop")
        const rightElement = document.querySelector("#marginsRight")
        const bottomElement = document.querySelector("#marginsBottom")
        const leftElement = document.querySelector("#marginsLeft")
        switch (document.querySelector("#marginsType").value) {
            case "default":
                if (isLandscape) {
                    topElement.value = "0.42";
                    rightElement.value = "0.42";
                    bottomElement.value = "0.42";
                    leftElement.value = "0.42";
                } else {
                    topElement.value = "1";
                    rightElement.value = "0.54";
                    bottomElement.value = "1";
                    leftElement.value = "0.54";
                }
                break;
            case "none": // none
                topElement.value = "0";
                rightElement.value = "0";
                bottomElement.value = "0";
                leftElement.value = "0";
                break;
            case "printableArea": // minimal
                if (isLandscape) {
                    topElement.value = ".07";
                    rightElement.value = ".07";
                    bottomElement.value = ".07";
                    leftElement.value = ".07";
                } else {
                    topElement.value = "0.58";
                    rightElement.value = "0.1";
                    bottomElement.value = "0.58";
                    leftElement.value = "0.1";
                }
                break;
        }
        document.getElementById('preview').style.padding = topElement.value + "in " 
                             + rightElement.value + "in "
                             + bottomElement.value + "in "
                             + leftElement.value + "in";
        setTimeout(() => {
            fixBlockWidth();
        }, 300);
    }
    const fetchPost = (url, data, cb) => {
        fetch("${servePathWithoutTrailingSlash}" + url, {
            method: "POST",
            body: JSON.stringify(data)
        }).then((response) => {
            return response.json();
        }).then((response) => {
            cb(response);
        })
    }
    const renderPreview = (data) => {
        previewElement.innerHTML = '<div style="padding:8px 0 0 0" class="protyle-wysiwyg${window.siyuan.config.editor.displayBookmarkIcon ? " protyle-wysiwyg--attr" : ""}">' + data.content + '</div>';
        const wysElement = previewElement.querySelector(".protyle-wysiwyg");
        wysElement.setAttribute("data-doc-type", data.type || "NodeDocument");
        Object.keys(data.attrs).forEach(key => {
            wysElement.setAttribute(key, data.attrs[key]);
        })
        // https://github.com/siyuan-note/siyuan/issues/13669
        wysElement.querySelectorAll('[data-node-id]').forEach((item) => {
            if (item.querySelector(".img")) {
                item.insertAdjacentHTML("beforeend", "<hr style='margin:0;border:0'>");
            }
        })
        Protyle.mermaidRender(wysElement, "${servePath}stage/protyle");
        Protyle.flowchartRender(wysElement, "${servePath}stage/protyle");
        Protyle.graphvizRender(wysElement, "${servePath}stage/protyle");
        Protyle.chartRender(wysElement, "${servePath}stage/protyle");
        Protyle.mindmapRender(wysElement, "${servePath}stage/protyle");
        Protyle.abcRender(wysElement, "${servePath}stage/protyle");
        Protyle.htmlRender(wysElement);
        Protyle.plantumlRender(wysElement, "${servePath}stage/protyle");
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
        document.title = response.data.name
        window.siyuan = {
          config: {
            appearance: { mode: 0, codeBlockThemeDark: "${window.siyuan.config.appearance.codeBlockThemeDark}", codeBlockThemeLight: "${window.siyuan.config.appearance.codeBlockThemeLight}" },
            editor: { 
              allowSVGScriptTip: ${window.siyuan.config.editor.allowSVGScript},
              allowHTMLBLockScript: ${window.siyuan.config.editor.allowHTMLBLockScript},
              fontSize: ${window.siyuan.config.editor.fontSize},
              codeLineWrap: true,
              codeLigatures: ${window.siyuan.config.editor.codeLigatures},
              plantUMLServePath: "${window.siyuan.config.editor.plantUMLServePath}",
              codeSyntaxHighlightLineNum: ${window.siyuan.config.editor.codeSyntaxHighlightLineNum},
              katexMacros: decodeURI(\`${encodeURI(window.siyuan.config.editor.katexMacros)}\`),
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
                        const hash = linkAddress.substring(1);
                        previewElement.querySelector('[data-node-id="' + hash + '"], [id="' + hash + '"]').scrollIntoView();
                        event.stopPropagation();
                        event.preventDefault();
                        return;
                    }
                } else if (target.classList.contains("protyle-action__copy")) {
                    navigator.clipboard.writeText(target.parentElement.nextElementSibling.textContent.trimEnd().replace(/\u00A0/g, " ").replace(/\u200D\`\`\`/g, "\`\`\`"));
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
            refreshPreview();
        });
        const mergeSubdocsElement = actionElement.querySelector('#mergeSubdocs');
        mergeSubdocsElement.addEventListener('change', () => {
            refreshPreview();
        });
        const  watermarkElement = actionElement.querySelector('#watermark');
        const refreshPreview = () => {
            previewElement.innerHTML = '<div class="fn__loading" style="left:0;height: 100vh"><img width="48px" src="${servePath}stage/loading-pure.svg"></div>'
            fetchPost("/api/export/exportPreviewHTML", {
                id: "${id}",
                keepFold: keepFoldElement.checked,
                merge: mergeSubdocsElement.checked,
            }, response2 => {
                if (response2.code === 1) {
                    alert(response2.msg)
                    return;
                }
                setPadding();
                renderPreview(response2.data);
            })
        };

        actionElement.querySelector("#scale").addEventListener("input", () => {
            const scale = actionElement.querySelector("#scale").value;
            actionElement.querySelector("#scaleTip").innerText = scale;
            previewElement.style.zoom = scale;
            fixBlockWidth();
        })
        actionElement.querySelector("#pageSize").addEventListener('change', () => {
            fixBlockWidth();
        });
        actionElement.querySelector("#marginsType").addEventListener('change', (event) => {
            setPadding();
            if (event.target.value === "custom") {
                event.target.nextElementSibling.classList.remove("fn__none");
            } else {
                event.target.nextElementSibling.classList.add("fn__none");
            }
        });
        actionElement.querySelector("#marginsTop").addEventListener('change', () => {
            setPadding();
        });
        actionElement.querySelector("#marginsRight").addEventListener('change', () => {
            setPadding();
        });
        actionElement.querySelector("#marginsBottom").addEventListener('change', () => {
            setPadding();
        });
        actionElement.querySelector("#marginsLeft").addEventListener('change', () => {
            setPadding();
        });
        actionElement.querySelector("#landscape").addEventListener('change', (e) => {
            setPadding();
        });
        actionElement.querySelector('.b3-button--cancel').addEventListener('click', () => {
            const {ipcRenderer}  = require("electron");
            ipcRenderer.send("${Constants.SIYUAN_CMD}", "destroy")
        });
        const buildExportConfig = (unPagedPageSize) => {
            const pageSize = actionElement.querySelector("#pageSize").value;
            // https://www.electronjs.org/docs/latest/api/web-contents#contentsprinttopdfoptions
            // https://chromedevtools.github.io/devtools-protocol/tot/Page/#method-printToPDF
            return {
                title: "${window.siyuan.languages.export} PDF",
                pdfOptions: {
                    printBackground: true,
                    landscape: actionElement.querySelector("#landscape").checked,
                    marginType: actionElement.querySelector("#marginsType").value,
                    margins: {
                        top: parseFloat(document.querySelector("#marginsTop").value) || 0,
                        bottom: parseFloat(document.querySelector("#marginsBottom").value) || 0,
                        left: parseFloat(document.querySelector("#marginsLeft").value) || 0,
                        right: parseFloat(document.querySelector("#marginsRight").value) || 0,
                    },
                    scale: parseFloat(actionElement.querySelector("#scale").value),
                    pageSize: unPagedPageSize || pageSize,
                },
                pageSize,
                keepFold: keepFoldElement.checked,
                mergeSubdocs: mergeSubdocsElement.checked,
                watermark: watermarkElement.checked,
                removeAssets: actionElement.querySelector("#removeAssets").checked,
                paged: !unPagedPageSize,
                rootId: "${id}",
                rootTitle: response.data.name,
                parentWindowId: ${currentWindowId},
            };
        };
        actionElement.querySelector('.b3-button--text').addEventListener('click', () => {
            const {ipcRenderer}  = require("electron");
            const isPaged = actionElement.querySelector("#paged").checked;
            if (!isPaged) {
                const getPageSizeDimensions = () => {
                    // https://github.com/electron/electron/blob/3df3a6a736b93e0d69fa3b0c403b33f201287780/lib/browser/api/web-contents.ts#L89-L101
                    const pageSizes = {
                        "A3": { width: 11.7, height: 16.54 },
                        "A4": { width: 8.27, height: 11.7 },
                        "A5": { width: 5.83, height: 8.27 },
                        "Legal": { width: 8.5, height: 14 },
                        "Letter": { width: 8.5, height: 11 },
                        "Tabloid": { width: 11, height: 17 },
                    };
                    return pageSizes[actionElement.querySelector("#pageSize").value];
                };
                const previewHeight = Math.max(previewElement.scrollHeight / 96 - (parseFloat(document.querySelector("#marginsTop").value) || 0) - (parseFloat(document.querySelector("#marginsBottom").value) || 0), getPageSizeDimensions().height);
                ipcRenderer.send("${Constants.SIYUAN_EXPORT_PDF}", buildExportConfig(actionElement.querySelector("#landscape").checked ? {
                    height: getPageSizeDimensions().height,
                    width: previewHeight,
                } : {
                    width: getPageSizeDimensions().width,
                    height: previewHeight,
                }));
            } else {
                ipcRenderer.send("${Constants.SIYUAN_EXPORT_PDF}", buildExportConfig());
            }
            previewElement.classList.add("exporting");
            previewElement.style.zoom = "";
            previewElement.style.paddingTop = "6px";
            previewElement.style.paddingBottom = "0";
            fixBlockWidth();
            actionElement.remove();
        });
        setPadding();
        renderPreview(response.data);
        window.addEventListener("keydown", (event) => {
            if (event.key === "Escape") {
                const {ipcRenderer}  = require("electron");
                ipcRenderer.send("${Constants.SIYUAN_CMD}", "destroy")
                event.preventDefault();
            }
        })
    });
</script>
${getSnippetJS()}
</body></html>`;
    fetchPost("/api/export/exportTempContent", {content: html}, (response) => {
        ipcRenderer.send(Constants.SIYUAN_EXPORT_NEWWINDOW, response.data.url);
    });
};

const getExportPath = (option: IExportOptions, removeAssets?: boolean, mergeSubdocs?: boolean) => {
    fetchPost("/api/block/getBlockInfo", {
        id: option.id
    }, async (response) => {
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

        const result = await ipcRenderer.invoke(Constants.SIYUAN_GET, {
            cmd: "showOpenDialog",
            title: window.siyuan.languages.export + " " + exportType,
            properties: ["createDirectory", "openDirectory"],
        });
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
                        hideMessage(msgId);
                        showMessage(exportResponse.msg, 0, "error");
                        return;
                    }
                    afterExport(exportResponse.data.path, msgId);
                } else {
                    onExport(exportResponse, savePath, "", option, msgId);
                }
            });
        }
    });
};
/// #endif

export const onExport = async (data: IWebSocketData, filePath: string, servePath: string, exportOption: IExportOptions, msgId?: string) => {
    let themeName = window.siyuan.config.appearance.themeLight;
    let mode = 0;
    if (["html", "htmlmd"].includes(exportOption.type) && window.siyuan.config.appearance.mode === 1) {
        themeName = window.siyuan.config.appearance.themeDark;
        mode = 1;
    }
    const isDefault = (window.siyuan.config.appearance.mode === 1 && window.siyuan.config.appearance.themeDark === "midnight") || (window.siyuan.config.appearance.mode === 0 && window.siyuan.config.appearance.themeLight === "daylight");
    let themeStyle = "";
    if (!isDefault) {
        themeStyle = `<link rel="stylesheet" type="text/css" id="themeStyle" href="${servePath}appearance/themes/${themeName}/theme.css?${Constants.SIYUAN_VERSION}"/>`;
    }
    const screenWidth = getScreenWidth();
    const isInMobile = isInAndroid() || isInHarmony() || isInIOS();
    const mobileHtml = isInMobile ? {
        js: `document.body.style.minWidth = "${screenWidth}px";`,
        css: `@page { size: A4; margin: 10mm 0 10mm 0; background-color: var(--b3-theme-background); }
.protyle-wysiwyg {padding: 0; margin: 0;}`
    } : {js: "", css: ""};
    const html = `<!DOCTYPE html>
<html lang="${window.siyuan.config.appearance.lang}" data-theme-mode="${isInMobile ? "light" : getThemeMode()}" data-light-theme="${window.siyuan.config.appearance.themeLight}" data-dark-theme="${window.siyuan.config.appearance.themeDark}">
<head>
    <base href="${servePath}">
    <meta charset="utf-8">
    <meta http-equiv="X-UA-Compatible" content="IE=edge">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=0"/>
    <meta name="mobile-web-app-capable" content="yes"/>
    <meta name="apple-mobile-web-app-status-bar-style" content="black">
    <link rel="stylesheet" type="text/css" id="baseStyle" href="${servePath}stage/build/export/base.css?v=${Constants.SIYUAN_VERSION}"/>
    <link rel="stylesheet" type="text/css" id="themeDefaultStyle" href="${servePath}appearance/themes/${themeName}/theme.css?v=${Constants.SIYUAN_VERSION}"/>
    <script src="${servePath}stage/protyle/js/protyle-html.js?v=${Constants.SIYUAN_VERSION}"></script>
    ${themeStyle}
    <title>${data.data.name}</title>
    <!-- Exported by SiYuan v${Constants.SIYUAN_VERSION} -->
    <style>
        body {font-family: var(--b3-font-family);background-color: var(--b3-theme-background);color: var(--b3-theme-on-background)}
        ${await setInlineStyle(false, servePath)}
        ${await getPluginStyle()}
        ${mobileHtml.css}
    </style>
    ${getSnippetCSS()}
</head>
<body>
<div class="${["htmlmd", "word"].includes(exportOption.type) ? "b3-typography" : "protyle-wysiwyg" + (window.siyuan.config.editor.displayBookmarkIcon ? " protyle-wysiwyg--attr" : "")}" 
style="max-width: 800px;margin: 0 auto;" id="preview">${data.data.content}</div>
${getIconScript(servePath)}
<script src="${servePath}stage/build/export/protyle-method.js?v=${Constants.SIYUAN_VERSION}"></script>
<script src="${servePath}stage/protyle/js/lute/lute.min.js?v=${Constants.SIYUAN_VERSION}"></script>  
<script>
    ${mobileHtml.js}
    window.siyuan = {
      config: {
        appearance: { mode: ${mode}, codeBlockThemeDark: "${window.siyuan.config.appearance.codeBlockThemeDark}", codeBlockThemeLight: "${window.siyuan.config.appearance.codeBlockThemeLight}" },
        editor: { 
          codeLineWrap: true,
          fontSize: ${window.siyuan.config.editor.fontSize},
          codeLigatures: ${window.siyuan.config.editor.codeLigatures},
          plantUMLServePath: "${window.siyuan.config.editor.plantUMLServePath}",
          codeSyntaxHighlightLineNum: ${window.siyuan.config.editor.codeSyntaxHighlightLineNum},
          katexMacros: decodeURI(\`${encodeURI(window.siyuan.config.editor.katexMacros)}\`),
        }
      },
      languages: {copy:"${window.siyuan.languages.copy}"}
    };
    const previewElement = document.getElementById('preview');
    Protyle.highlightRender(previewElement, "stage/protyle");
    Protyle.mathRender(previewElement, "stage/protyle", ${exportOption.type === "pdf"});
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
            navigator.clipboard.writeText(item.parentElement.nextElementSibling.textContent.trimEnd().replace(/\u00A0/g, " ").replace(/\u200D\`\`\`/g, "\`\`\`"));
            event.preventDefault();
            event.stopPropagation();
      })
    });
</script>
${getSnippetJS()}</body></html>`;
    // 移动端导出 pdf、浏览器导出 HTML
    if (typeof filePath === "undefined") {
        return html;
    }
    /// #if !BROWSER
    const htmlPath = path.join(filePath, "index.html");
    fs.writeFileSync(htmlPath, html);
    afterExport(htmlPath, msgId);
    /// #endif
};

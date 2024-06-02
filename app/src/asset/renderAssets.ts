import {Constants} from "../constants";
/// #if !MOBILE
import {getAllModels} from "../layout/getAll";
/// #endif
import {pathPosix} from "../util/pathName";
import * as dayjs from "dayjs";
import { webViewerLoad } from "./zotero";

export const renderAssetsPreview = (pathString: string) => {
    if (!pathString) {
        return "";
    }
    const type = pathPosix().extname(pathString).toLowerCase();
    if (Constants.SIYUAN_ASSETS_IMAGE.includes(type)) {
        return `<img style="max-height: 100%" src="${pathString}">`;
    } else if (Constants.SIYUAN_ASSETS_AUDIO.includes(type)) {
        return `<audio style="max-width: 100%" controls="controls" src="${pathString}"></audio>`;
    } else if (Constants.SIYUAN_ASSETS_VIDEO.includes(type)) {
        return `<video style="max-width: 100%" controls="controls" src="${pathString}"></video>`;
    } else {
        return pathString;
    }
};

export const pdfResize = () => {
    /// #if !MOBILE
    getAllModels().asset.forEach(async(item) => {
        const pdfInstance = item.pdfObject;
        if (!pdfInstance) {
            return;
        }
        const {pdfDocument, pdfViewer} = pdfInstance;
        if (!pdfDocument) {
            return;
        }
        if (item.readerObject._lastView._iframe.ownerDocument.defaultView){
            return;
        }
        // https://github.com/siyuan-note/siyuan/issues/8097
        let {fileName,url} = item.readerObject._data;
        let filePath = url+fileName;
        item.element.innerHTML = ""
        item.readerObject = await webViewerLoad(filePath,item.element,pdfViewer.currentPageNumber,pdfViewer.currentPageNumber)
        item.pdfObject = item.readerObject._primaryView._iframeWindow.PDFViewerApplication
    });
    /// #endif
};

export const genAssetHTML = (type: string, pathString: string, imgName: string, linkName: string) => {
    let html = "";
    if (Constants.SIYUAN_ASSETS_AUDIO.includes(type)) {
        html = `<div data-node-id="${Lute.NewNodeID()}" data-type="NodeAudio" class="iframe" updated="${dayjs().format("YYYYMMDDHHmmss")}"><div class="iframe-content"><audio controls="controls" src="${pathString}" data-src="${pathString}"></audio>${Constants.ZWSP}</div><div class="protyle-attr" contenteditable="false">${Constants.ZWSP}</div></div>`;
    } else if (Constants.SIYUAN_ASSETS_IMAGE.includes(type)) {
        let netHTML = "";
        if (!pathString.startsWith("assets/")) {
            netHTML = '<span class="img__net"><svg><use xlink:href="#iconLanguage"></use></svg></span>';
        }
        html = `<span contenteditable="false" data-type="img" class="img"><span> </span><span><span class="protyle-action protyle-icons"><span class="protyle-icon protyle-icon--only"><svg><use xlink:href="#iconMore"></use></svg></span></span><img src="${pathString}" data-src="${pathString}" alt="${imgName}" /><span class="protyle-action__drag"></span>${netHTML}<span class="protyle-action__title"></span></span><span> </span></span>`;
    } else if (Constants.SIYUAN_ASSETS_VIDEO.includes(type)) {
        html = `<div data-node-id="${Lute.NewNodeID()}" data-type="NodeVideo" class="iframe" updated="${dayjs().format("YYYYMMDDHHmmss")}"><div class="iframe-content">${Constants.ZWSP}<video controls="controls" src="${pathString}" data-src="${pathString}"></video><span class="protyle-action__drag" contenteditable="false"></span></div><div class="protyle-attr" contenteditable="false">${Constants.ZWSP}</div></div>`;
    } else {
        html = `<span data-type="a" data-href="${pathString}">${linkName}</span>`;
    }
    return html;
};

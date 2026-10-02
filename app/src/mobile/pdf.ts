import {escapeHtmlTextAndAttr} from "../util/escape";
import {getPdfViewerHTML} from "../asset/pdf/viewerTemplate";
import {showMessage} from "../dialog/message";
import {fetchSyncPost} from "../util/fetch";
import {getAssetPathWithoutQuery, getDisplayName} from "../util/pathName";
import {openModel} from "./menu/model";
import {bindPdfTheme, loadPdfViewerModule} from "../asset/pdfViewer";

const resolvePdfPage = async (path: string, pdfParams: number | string | undefined, signal: AbortSignal) => {
    if (typeof pdfParams !== "string") {
        return pdfParams;
    }
    let response: IWebSocketData;
    try {
        response = await fetchSyncPost("/api/asset/getFileAnnotation", {
            path: path + ".sya",
        }, undefined, false, signal);
    } catch (error) {
        if (error?.name === "AbortError") {
            throw error;
        }
        console.warn("load PDF annotation failed", error);
        return undefined;
    }
    if (response.code === 1 || !response.data?.data) {
        return undefined;
    }
    try {
        const annotation = JSON.parse(response.data.data)[pdfParams];
        if (!annotation) {
            return undefined;
        }
        const pageIndex = typeof annotation.page === "number" ? annotation.page : annotation.pages?.[0]?.index;
        return typeof pageIndex === "number" ? pageIndex + 1 : undefined;
    } catch (error) {
        console.warn("parse PDF annotation failed", error);
        return undefined;
    }
};

export const openMobilePDF = (path: string, pdfParams?: number | string) => {
    let pdfObject: any;
    let modelElement: HTMLElement | undefined;
    let isDestroyed = false;
    const abortController = new AbortController();
    const title = escapeHtmlTextAndAttr(getDisplayName(getAssetPathWithoutQuery(path)));

    openModel({
        title,
        html: getPdfViewerHTML(),
        bindEvent: (element) => {
            modelElement = element;
            element.classList.add("pdf-viewer--mobile");
            element.setAttribute("data-prevent-swipe", "true");
            bindPdfTheme(element);
            void Promise.all([
                loadPdfViewerModule(),
                resolvePdfPage(path, pdfParams, abortController.signal),
            ]).then(([pdfViewerModule, page]) => {
                if (isDestroyed || !element.isConnected) {
                    return;
                }
                const baseURL = document.getElementById("baseURL").getAttribute("href");
                const file = path.startsWith("file") ? path : `${baseURL}/${path}`;
                pdfObject = pdfViewerModule.webViewerLoad(file, element, page,
                    typeof pdfParams === "string" ? pdfParams : undefined);
                element.setAttribute("data-loading", "true");
            }).catch((error) => {
                if (!isDestroyed && error?.name !== "AbortError") {
                    showMessage(error?.message || window.siyuan.languages.loadingError, 0, "error");
                }
            });
        },
        destroyCallback: () => {
            isDestroyed = true;
            abortController.abort();
            if (modelElement) {
                modelElement.classList.remove("pdf-viewer--mobile");
                modelElement.removeAttribute("data-prevent-swipe");
            }
            if (pdfObject) {
                void pdfObject.destroy();
                pdfObject = undefined;
            }
        },
    });
};

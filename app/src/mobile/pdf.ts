import {Constants} from "../constants";
import {getPdfViewerHTML} from "../asset/pdf/viewerTemplate";
import {showMessage} from "../dialog/message";
import {fetchSyncPost} from "../util/fetch";
import {getAssetPathWithoutQuery, getDisplayName} from "../util/pathName";
import {setStorageVal} from "../protyle/util/compatibility";
import {openModel} from "./menu/model";

const PDF_JS_VERSION = "4.8.69";
const PDF_JS_SCRIPT_ID = "mobilePdfScript";

interface IPromiseWithResolversConstructor {
    withResolvers?: <T>() => {
        promise: Promise<T>,
        resolve: (value: T | PromiseLike<T>) => void,
        reject: (reason?: unknown) => void,
    };
}

interface IPdfViewerModule {
    webViewerLoad: (file: string, element: HTMLElement, page?: number, annotationId?: string) => any;
}

let pdfViewerModulePromise: Promise<IPdfViewerModule> | undefined;

const ensurePromiseWithResolvers = () => {
    const promiseConstructor = Promise as unknown as IPromiseWithResolversConstructor;
    if (promiseConstructor.withResolvers) {
        return;
    }
    promiseConstructor.withResolvers = <T>() => {
        let resolve!: (value: T | PromiseLike<T>) => void;
        let reject!: (reason?: unknown) => void;
        const promise = new Promise<T>((promiseResolve, promiseReject) => {
            resolve = promiseResolve;
            reject = promiseReject;
        });
        return {promise, resolve, reject};
    };
};

const loadPdfScript = () => new Promise<void>((resolve, reject) => {
    if (window.pdfjsLib) {
        resolve();
        return;
    }
    const scriptElement = document.createElement("script");
    scriptElement.id = PDF_JS_SCRIPT_ID;
    scriptElement.type = "module";
    scriptElement.src = `${Constants.PROTYLE_CDN}/js/pdf/pdf.min.mjs?v=${PDF_JS_VERSION}`;
    scriptElement.onload = () => {
        if (window.pdfjsLib) {
            resolve();
        } else {
            scriptElement.remove();
            reject(new Error(window.siyuan.languages.loadingError));
        }
    };
    scriptElement.onerror = () => {
        scriptElement.remove();
        reject(new Error(window.siyuan.languages.loadingError));
    };
    document.head.appendChild(scriptElement);
});

const loadPdfViewerModule = () => {
    if (!pdfViewerModulePromise) {
        ensurePromiseWithResolvers();
        pdfViewerModulePromise = loadPdfScript().then(async () => {
            // @ts-ignore PDF.js viewer 由上游 JavaScript 源码构建，没有 TypeScript 声明
            return import("../asset/pdf/viewer") as Promise<IPdfViewerModule>;
        }).catch((error) => {
            pdfViewerModulePromise = undefined;
            throw error;
        });
    }
    return pdfViewerModulePromise;
};

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

const bindPdfTheme = (element: HTMLElement) => {
    const localPDF = window.siyuan.storage[Constants.LOCAL_PDFTHEME];
    const darkElement = element.querySelector("#pdfDark") as HTMLElement;
    const lightElement = element.querySelector("#pdfLight") as HTMLElement;
    const outerElement = element.firstElementChild;
    const pdfTheme = window.siyuan.config.appearance.mode === 0 ? localPDF.light : localPDF.dark;
    const setTheme = (theme: "light" | "dark") => {
        if (window.siyuan.config.appearance.mode === 0) {
            localPDF.light = theme;
        } else {
            localPDF.dark = theme;
        }
        outerElement.classList.toggle("pdf__outer--dark", theme === "dark");
        lightElement.classList.toggle("toggled", theme === "light");
        darkElement.classList.toggle("toggled", theme === "dark");
        setStorageVal(Constants.LOCAL_PDFTHEME, localPDF);
    };
    outerElement.classList.toggle("pdf__outer--dark", pdfTheme === "dark");
    lightElement.classList.toggle("toggled", pdfTheme !== "dark");
    darkElement.classList.toggle("toggled", pdfTheme === "dark");
    lightElement.addEventListener("click", () => {
        setTheme("light");
    });
    darkElement.addEventListener("click", () => {
        setTheme("dark");
    });
};

export const openMobilePDF = (path: string, pdfParams?: number | string) => {
    let pdfObject: any;
    let modelElement: HTMLElement | undefined;
    let isDestroyed = false;
    const abortController = new AbortController();
    const title = Lute.EscapeHTMLStr(getDisplayName(getAssetPathWithoutQuery(path)));

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

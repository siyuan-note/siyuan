import {Constants} from "../constants";
import {setStorageVal} from "../protyle/util/compatibility";

const PDF_JS_VERSION = "6.4.299-siyuan.1";

interface IPromiseWithResolversConstructor {
    withResolvers?: <T>() => {
        promise: Promise<T>,
        resolve: (value: T | PromiseLike<T>) => void,
        reject: (reason?: unknown) => void,
    };
}

interface IPdfViewerModule {
    webViewerLoad: (file: string, element: HTMLElement, page?: number, annotationId?: string, previewOnly?: boolean) => any;
}

let pdfViewerModulePromise: Promise<IPdfViewerModule> | undefined;

const loadPdfScript = () => new Promise<void>((resolve, reject) => {
    if (window.pdfjsLib) {
        resolve();
        return;
    }
    const scriptElement = document.createElement("script");
    scriptElement.id = "mobilePdfScript";
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

export const loadPdfViewerModule = () => {
    if (!pdfViewerModulePromise) {
        const promiseConstructor = Promise as unknown as IPromiseWithResolversConstructor;
        if (!promiseConstructor.withResolvers) {
            promiseConstructor.withResolvers = <T>() => {
                let resolve!: (value: T | PromiseLike<T>) => void;
                let reject!: (reason?: unknown) => void;
                const promise = new Promise<T>((promiseResolve, promiseReject) => {
                    resolve = promiseResolve;
                    reject = promiseReject;
                });
                return {promise, resolve, reject};
            };
        }
        pdfViewerModulePromise = loadPdfScript().then(async () => {
            // @ts-ignore PDF.js viewer 由上游 JavaScript 源码构建，没有 TypeScript 声明
            return import("./pdf/viewer") as Promise<IPdfViewerModule>;
        }).catch((error) => {
            pdfViewerModulePromise = undefined;
            throw error;
        });
    }
    return pdfViewerModulePromise;
};

export const bindPdfTheme = (element: HTMLElement) => {
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
    lightElement.addEventListener("click", () => setTheme("light"));
    darkElement.addEventListener("click", () => setTheme("dark"));
};

import {Constants} from "../constants";
import {patchAppearancePreference} from "../config/tabs/appearancePreferences";
import {ensureBrowserCompatibility} from "../protyle/util/browserCompat";

const PDF_JS_VERSION = "6.4.299-siyuan.1";

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
        pdfViewerModulePromise = ensureBrowserCompatibility().then(loadPdfScript).then(async () => {
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
    const localPDF = window.siyuan.config.appearance.pdfTheme;
    const darkElement = element.querySelector("#pdfDark") as HTMLElement;
    const lightElement = element.querySelector("#pdfLight") as HTMLElement;
    const outerElement = element.firstElementChild;
    const pdfTheme = window.siyuan.config.appearance.mode === 0 ? localPDF.light : localPDF.dark;
    const setTheme = (theme: "light" | "dark") => {
        if (window.siyuan.config.readonly || window.siyuan.isPublish) return;
        outerElement.classList.toggle("pdf__outer--dark", theme === "dark");
        lightElement.classList.toggle("toggled", theme === "light");
        darkElement.classList.toggle("toggled", theme === "dark");
        void patchAppearancePreference(`pdfTheme.${window.siyuan.config.appearance.mode === 0 ? "light" : "dark"}`, theme);
    };
    outerElement.classList.toggle("pdf__outer--dark", pdfTheme === "dark");
    lightElement.classList.toggle("toggled", pdfTheme !== "dark");
    darkElement.classList.toggle("toggled", pdfTheme === "dark");
    lightElement.addEventListener("click", () => setTheme("light"));
    darkElement.addEventListener("click", () => setTheme("dark"));
};

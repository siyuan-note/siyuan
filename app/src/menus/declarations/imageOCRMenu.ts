import {IMenuDeclaration} from "./menuDeclaration";

export interface IImageOCRMenuContext {
    textAvailable: boolean;
    localAvailable: boolean;
    aiAvailable: boolean;
    getStatus: () => Promise<boolean | undefined>;
    openResult: () => void;
    copyText: () => void;
    runLocal: () => void;
    runAI: () => void;
}

export const IMAGE_OCR_MENU: IMenuDeclaration<IImageOCRMenuContext> = {
    id: "ocr",
    label: () => "OCR",
    simple: false,
    type: "entry",
    behavior: context => ({
        ignore: !context.textAvailable,
        bind(element) {
            context.getStatus().then(hasText => {
                if (!element.isConnected || hasText === undefined) {
                    return;
                }
                const localLabel = element.querySelector('[data-id="reOCR"] .b3-menu__label');
                if (localLabel) {
                    localLabel.textContent = hasText ? window.siyuan.languages.reOCR : window.siyuan.languages.performOCR;
                }
                const aiLabel = element.querySelector('[data-id="reAIOCR"] .b3-menu__label');
                if (aiLabel) {
                    aiLabel.textContent = hasText ? window.siyuan.languages.reAIOCR : window.siyuan.languages.performAIOCR;
                }
            });
        },
    }),
    children: [{
        id: "ocrResult",
        label: () => window.siyuan.languages.ocrResult,
        simple: false,
        type: "entry",
        icon: "iconEdit",
        behavior: context => ({click: context.openResult}),
    }, {
        id: "copyOCRText",
        label: () => `${window.siyuan.languages.copy} OCR`,
        simple: false,
        type: "entry",
        icon: "iconCopy",
        behavior: context => ({click: context.copyText}),
    }, {
        id: "separator_reOCR",
        label: () => "",
        simple: true,
        type: "separator",
        behavior: context => ({ignore: !context.localAvailable && !context.aiAvailable}),
    }, {
        id: "reOCR",
        label: () => window.siyuan.languages.performOCR,
        simple: false,
        type: "entry",
        icon: "iconOCR",
        behavior: context => ({ignore: !context.localAvailable, click: context.runLocal}),
    }, {
        id: "reAIOCR",
        label: () => window.siyuan.languages.performAIOCR,
        simple: false,
        type: "entry",
        icon: "iconSparkles",
        behavior: context => ({ignore: !context.aiAvailable, click: context.runAI}),
    }],
};

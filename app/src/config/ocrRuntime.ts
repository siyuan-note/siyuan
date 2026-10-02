export const OCR_CHANGED_EVENT = "siyuan-ocr-changed";

export const notifyOCRChanged = () => {
    window.dispatchEvent(new CustomEvent(OCR_CHANGED_EVENT));
};

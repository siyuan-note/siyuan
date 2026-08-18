export const normalizePasteResponse = (response: IClipboardData, files: IClipboardData["files"] = []) => ({
    textHTML: response.textHTML ?? "",
    textPlain: response.textPlain ?? "",
    siyuanHTML: response.siyuanHTML ?? "",
    files: response.files ?? files,
});

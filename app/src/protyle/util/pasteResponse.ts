export const normalizePasteResponse = (response: IClipboardData) => ({
    textHTML: response.textHTML ?? "",
    textPlain: response.textPlain ?? "",
    siyuanHTML: response.siyuanHTML ?? "",
    files: response.files ?? [],
});

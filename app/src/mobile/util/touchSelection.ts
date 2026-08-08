export const hasVisibleSelectionText = (text: string) => text.replaceAll("\u200b", "").trim() !== "";

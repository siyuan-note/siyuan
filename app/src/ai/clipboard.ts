export const formatAIGeneratedClipboardText = (text: string, label: string) => {
    return text.trim() ? `${label}\n\n${text}` : text;
};

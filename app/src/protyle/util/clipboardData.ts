export const encodeBase64 = (text: string): string => {
    if (typeof Buffer !== "undefined") {
        return Buffer.from(text, "utf8").toString("base64");
    } else {
        const encoder = new TextEncoder();
        const bytes = encoder.encode(text);
        let binary = "";
        const chunkSize = 0x8000; // 避免栈溢出

        for (let i = 0; i < bytes.length; i += chunkSize) {
            const chunk = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
            binary += String.fromCharCode(...chunk);
        }

        return btoa(binary);
    }
};

export const buildWebClipboardHTML = (textHTML: string, textSiyuan: string) => {
    if (!textSiyuan) {
        return textHTML;
    }
    return `<!--data-siyuan='${encodeBase64(textSiyuan)}'-->${textHTML}`;
};

export const getTextSiyuanFromTextHTML = (html: string) => {
    if (html.trimStart().startsWith("<html") &&
        html.substring(0, html.indexOf(">")).includes('xmlns:x="urn:schemas-microsoft-com:office:excel"')) {
        // 移除 Microsoft Excel 中的 data-siyuan https://github.com/siyuan-note/siyuan/pull/16338
        return {
            textSiyuan: "",
            textHtml: html.replace(/<!--data-siyuan='[^']+'-->/g, "")
        };
    }
    const siyuanMatch = html.match(/<!--data-siyuan='([^']+)'-->/);
    let textSiyuan = "";
    let textHtml = html;
    if (siyuanMatch) {
        try {
            if (typeof Buffer !== "undefined") {
                const decodedBytes = Buffer.from(siyuanMatch[1], "base64");
                textSiyuan = decodedBytes.toString("utf8");
            } else {
                const decoder = new TextDecoder();
                const bytes = Uint8Array.from(atob(siyuanMatch[1]), char => char.charCodeAt(0));
                textSiyuan = decoder.decode(bytes);
            }
            // 移除注释节点，保持原有的 text/html 内容
            textHtml = html.replace(/<!--data-siyuan='[^']+'-->/g, "");
        } catch (e) {
            console.log("Failed to decode siyuan data from HTML comment:", e);
        }
    }
    return {
        textSiyuan,
        textHtml
    };
};

export const getTextSiyuanFromClipboardData = (clipboardData: {getData(type: string): string}) => {
    return clipboardData.getData("text/siyuan") ||
        getTextSiyuanFromTextHTML(clipboardData.getData("text/html")).textSiyuan;
};

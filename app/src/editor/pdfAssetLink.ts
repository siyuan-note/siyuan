export interface IPdfAssetLink {
    linkAddress: string;
    pdfParams?: number | string;
}

const PDF_ANNOTATION_PATH = /^(assets\/.+\.pdf)\/(\d{14}-\w{7})$/i;

const decodeQueryComponent = (value: string) => {
    try {
        return decodeURIComponent(value.replace(/\+/g, " "));
    } catch {
        return value;
    }
};

export const appendPdfAnnotationId = (linkAddress: string, annotationId: string) => {
    const queryIndex = linkAddress.indexOf("?");
    if (queryIndex < 0) {
        return `${linkAddress}/${annotationId}`;
    }
    return `${linkAddress.substring(0, queryIndex)}/${annotationId}${linkAddress.substring(queryIndex)}`;
};

export const resolvePdfAssetLink = (linkAddress: string): IPdfAssetLink => {
    const hashIndex = linkAddress.indexOf("#");
    const addressWithoutHash = hashIndex < 0 ? linkAddress : linkAddress.substring(0, hashIndex);
    const queryIndex = addressWithoutHash.indexOf("?");
    const path = queryIndex < 0 ? addressWithoutHash : addressWithoutHash.substring(0, queryIndex);
    const annotationMatch = PDF_ANNOTATION_PATH.exec(path);
    const pdfPath = annotationMatch?.[1] || path;
    if (!/^assets\/.+\.pdf$/i.test(pdfPath)) {
        return {linkAddress};
    }

    const query = queryIndex < 0 ? "" : addressWithoutHash.substring(queryIndex + 1);
    let page: string | undefined;
    const remainingQuery = query ? query.split("&").filter((item) => {
        const separatorIndex = item.indexOf("=");
        const key = separatorIndex < 0 ? item : item.substring(0, separatorIndex);
        if (decodeQueryComponent(key) !== "page") {
            return true;
        }
        if (typeof page === "undefined") {
            const value = separatorIndex < 0 ? "" : item.substring(separatorIndex + 1);
            page = decodeQueryComponent(value);
        }
        return false;
    }).join("&") : "";
    const parsedPage = typeof page === "undefined" ? undefined : Number.parseInt(page, 10);
    const pdfParams = annotationMatch?.[2] || (Number.isNaN(parsedPage) ? undefined : parsedPage);

    return {
        linkAddress: pdfPath + (remainingQuery ? `?${remainingQuery}` : ""),
        pdfParams,
    };
};

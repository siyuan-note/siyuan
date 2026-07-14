import {escapeAttr} from "../../../util/escape";

const TRANSPARENT_IMAGE = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

export const getCardCoverImageHTML = (coverURL: string, imageURL: string, fitImage: boolean) => {
    if (coverURL.startsWith("background")) {
        return `<img class="av__gallery-img" src="${TRANSPARENT_IMAGE}" style="${escapeAttr(coverURL)}">`;
    }
    return `<img loading="lazy" class="av__gallery-img${fitImage ? " av__gallery-img--fit" : ""}" src="${escapeAttr(imageURL)}">`;
};

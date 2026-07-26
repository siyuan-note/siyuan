import {escapeAttr} from "../../../util/escape";

const TRANSPARENT_IMAGE = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

const clampPosition = (value: number) => Math.min(100, Math.max(0, value));

export const calculateCardCoverPosition = (startX: number, startY: number, deltaX: number, deltaY: number,
                                           overflowX: number, overflowY: number) => {
    return {
        x: overflowX > 0 ? clampPosition(startX - deltaX / overflowX * 100) : startX,
        y: overflowY > 0 ? clampPosition(startY - deltaY / overflowY * 100) : startY,
    };
};

export const isCardCoverPointerMoveActive = (activePointerID: number, pointerID: number, pointerType: string,
                                             buttons: number) => {
    return activePointerID === pointerID && (pointerType !== "mouse" || buttons !== 0);
};

export const getCardCoverSource = (view: IAVGallery | IAVKanban) => {
    if (view.coverFrom === 1) {
        return "content";
    }
    if (view.coverFrom === 2 && view.coverFromAssetKeyID) {
        return `asset:${view.coverFromAssetKeyID}`;
    }
    return "";
};

export const getCardCoverImageHTML = (coverURL: string, imageURL: string, fitImage: boolean,
                                      position?: IAVCardCoverPosition) => {
    if (coverURL.startsWith("background")) {
        return `<img class="av__gallery-img" src="${TRANSPARENT_IMAGE}" style="${escapeAttr(coverURL)}">`;
    }
    const objectPosition = position?.image === coverURL ? ` style="object-position:${position.x}% ${position.y}%"` : "";
    return `<img loading="lazy" class="av__gallery-img${fitImage ? " av__gallery-img--fit" : ""}" src="${escapeAttr(imageURL)}"${objectPosition}>`;
};

export const getCardCoverHTML = (coverClass: string, coverURL: string, imageURL: string, fitImage: boolean,
                                 source: string, position?: IAVCardCoverPosition) => {
    const effectivePosition = position?.image === coverURL ? position : undefined;
    const imageHTML = getCardCoverImageHTML(coverURL, imageURL, fitImage, effectivePosition);
    if (coverURL.startsWith("background") || !source) {
        return `<div class="${coverClass}">${imageHTML}</div>`;
    }
    const x = effectivePosition?.x ?? 50;
    const y = effectivePosition?.y ?? 50;
    return `<div class="${coverClass}" data-cover-url="${escapeAttr(coverURL)}" data-cover-source="${escapeAttr(source)}" data-cover-position-x="${x}" data-cover-position-y="${y}" data-cover-position-custom="${effectivePosition ? "true" : "false"}">${imageHTML}</div>`;
};

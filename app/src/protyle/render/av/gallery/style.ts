export const CARD_WIDTH_MIN = 140;
export const CARD_WIDTH_MAX = 600;
export const CARD_ASPECT_RATIO_MIN = 0.25;
export const CARD_ASPECT_RATIO_MAX = 2.5;

export const CARD_WIDTH_PRESETS = [180, 260, 320];
export const CARD_ASPECT_RATIO_PRESETS = [16 / 9, 9 / 16, 4 / 3, 3 / 4, 3 / 2, 2 / 3, 1];

export const getCardWidth = (view: IAVGallery | IAVKanban) => {
    if (Number.isInteger(view.cardWidth) && view.cardWidth >= CARD_WIDTH_MIN && view.cardWidth <= CARD_WIDTH_MAX) {
        return view.cardWidth;
    }
    return CARD_WIDTH_PRESETS[view.cardSize] || CARD_WIDTH_PRESETS[1];
};

export const getCardAspectRatioValue = (view: IAVGallery | IAVKanban) => {
    if (Number.isFinite(view.cardAspectRatioValue) &&
        view.cardAspectRatioValue >= CARD_ASPECT_RATIO_MIN &&
        view.cardAspectRatioValue <= CARD_ASPECT_RATIO_MAX) {
        return view.cardAspectRatioValue;
    }
    return CARD_ASPECT_RATIO_PRESETS[view.cardAspectRatio] || CARD_ASPECT_RATIO_PRESETS[0];
};

export const getCardAspectRatio = (ratio: number) => {
    switch (ratio) {
        case 0:
            return "16:9";
        case 1:
            return "9:16";
        case 2:
            return "4:3";
        case 3:
            return "3:4";
        case 4:
            return "3:2";
        case 5:
            return "2:3";
        case 6:
            return "1:1";
    }
    return "16:9";
};

export const getCardAspectRatioLabel = (ratio: number) => {
    return ratio.toFixed(2);
};

export const getCardStyle = (view: IAVGallery | IAVKanban) => {
    return `--b3-av-card-width: ${getCardWidth(view)}px; --b3-av-card-aspect-ratio: ${getCardAspectRatioValue(view)};`;
};

export const CARD_LAYOUT_LIST = 0;
export const CARD_LAYOUT_COMPACT = 1;

export const getCardFieldsClass = (cardLayout: number, hasVisibleFields = true) => {
    const compactClass = cardLayout === CARD_LAYOUT_COMPACT ? " av__gallery-fields--compact" : "";
    const hiddenClass = hasVisibleFields ? "" : " fn__none";
    return `av__gallery-fields${compactClass}${hiddenClass}`;
};

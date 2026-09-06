export const fitSelectWidthToOptions = (selectElement: HTMLSelectElement) => {
    const style = getComputedStyle(selectElement);
    const measureContext = document.createElement("canvas").getContext("2d");
    if (!measureContext) {
        return;
    }
    measureContext.font = style.font;
    const optionWidth = Array.from(selectElement.options).reduce((width, option) =>
        Math.max(width, measureContext.measureText(option.text).width), 0);
    const paddingWidth = Number.parseFloat(style.paddingLeft) + Number.parseFloat(style.paddingRight);
    selectElement.style.minWidth = `${Math.ceil(optionWidth + paddingWidth)}px`;
};

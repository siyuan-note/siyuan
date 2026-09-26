export const updateFrozenColumns = (blockElement: HTMLElement) => {
    if (blockElement.dataset.avType !== "table") {
        return;
    }
    const scrollElement = blockElement.querySelector<HTMLElement>(".av__scroll");
    if (!scrollElement || scrollElement.clientWidth === 0) {
        return;
    }
    // 为未固定列保留至少 80 像素，宽度不足时仅暂停当前视图的固定定位。
    blockElement.querySelectorAll<HTMLElement>(".av__body").forEach(body => {
        const frozen = body.querySelector<HTMLElement>(".av__row--header .av__colsticky--freeze");
        body.classList.toggle("av__body--unfreeze", !!frozen &&
            frozen.getBoundingClientRect().width + 80 > scrollElement.clientWidth);
    });
};

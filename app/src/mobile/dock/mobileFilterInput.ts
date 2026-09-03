interface IMobileFilterClassTarget {
    classList: {
        add(className: string): void;
        remove(className: string): void;
    };
}

interface IMobileFilterInput extends IMobileFilterClassTarget {
    select(): void;
}

export const MOBILE_FILTER_TRIGGER_DEACTIVATE_CLASS = "toolbar__icon-deactivate";

export const showMobileFilterInput = (
    inputElement: IMobileFilterInput,
    triggerElement: IMobileFilterClassTarget,
    scheduleFrame: (callback: () => void) => void = callback => window.requestAnimationFrame(callback),
) => {
    // Android WebView 在按压元素因输入框显示而移位时会残留背景，当前点击结束后再恢复按压样式
    triggerElement.classList.add(MOBILE_FILTER_TRIGGER_DEACTIVATE_CLASS);
    inputElement.classList.remove("fn__none");
    inputElement.select();
    scheduleFrame(() => triggerElement.classList.remove(MOBILE_FILTER_TRIGGER_DEACTIVATE_CLASS));
};

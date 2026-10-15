import {isIOSPlatform} from "../../protyle/util/browserCompatibility";

export const isMobileLandscape = (target = window) => {
    const orientationType = target.screen.orientation?.type;
    if (orientationType?.startsWith("landscape")) {
        return true;
    }
    if (orientationType?.startsWith("portrait")) {
        return false;
    }
    // 旧版 iOS 的角度以竖屏为基准；其他设备的自然方向可能是横屏，不能通用角度判断。
    if (isIOSPlatform(target.navigator) && typeof target.orientation === "number") {
        return Math.abs(target.orientation) === 90;
    }
    // 使用不受软键盘影响的屏幕尺寸，避免把编辑视口缩短误判为旋转。
    return target.screen.width > target.screen.height;
};

export const bindMobileOrientationChange = (onChange: () => void, target = window) => {
    let landscape = isMobileLandscape(target);
    const onOrientationChange = () => {
        const nextLandscape = isMobileLandscape(target);
        if (nextLandscape === landscape) {
            return;
        }
        landscape = nextLandscape;
        onChange();
    };
    const orientation = target.screen.orientation;
    orientation?.addEventListener?.("change", onOrientationChange);
    target.addEventListener("orientationchange", onOrientationChange);
    target.addEventListener("resize", onOrientationChange);
    return () => {
        orientation?.removeEventListener?.("change", onOrientationChange);
        target.removeEventListener("orientationchange", onOrientationChange);
        target.removeEventListener("resize", onOrientationChange);
    };
};

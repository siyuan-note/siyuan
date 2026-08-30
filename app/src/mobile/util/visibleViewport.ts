import {isInMobileApp} from "../../protyle/util/compatibility";

export const getVisibleViewportBounds = () => {
    if (!isInMobileApp() && window.visualViewport) {
        return {
            top: window.visualViewport.offsetTop,
            bottom: window.visualViewport.offsetTop + window.visualViewport.height,
        };
    }
    return {
        top: 0,
        bottom: window.innerHeight,
    };
};

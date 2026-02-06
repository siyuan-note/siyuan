export const callMobileAppShowKeyboard = () => {
    if (window.JSAndroid && window.JSAndroid.showKeyboard) {
        window.JSAndroid.showKeyboard();
    } else if (window.JSHarmony && window.JSHarmony.showKeyboard) {
        window.JSHarmony.showKeyboard();
    }
};

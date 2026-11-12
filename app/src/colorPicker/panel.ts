import {MobileDialog} from "../dialog/mobileDialog";
import {registerColorPickerRuntime} from "./runtime";

export const registerColorPickerWindow = () => {
    registerColorPickerRuntime(document, options => new MobileDialog(options), () =>
        window.siyuan.isReady ? window.siyuan.languages : undefined);
};

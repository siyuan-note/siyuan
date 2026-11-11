import {MobileDialog} from "../dialog/mobileDialog";
import {registerDatePickerRuntime} from "./runtime";

export const registerDatePickerWindow = () => {
    registerDatePickerRuntime(document, options => new MobileDialog(options), () =>
        window.siyuan.isReady ? window.siyuan.languages : undefined);
};

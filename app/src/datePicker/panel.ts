import {AdaptiveDialog} from "../dialog/adaptiveDialog";
import {registerDatePickerRuntime} from "./runtime";

export const registerDatePickerWindow = () => {
    registerDatePickerRuntime(document, options => new AdaptiveDialog(options), () =>
        window.siyuan.isReady ? window.siyuan.languages : undefined);
};

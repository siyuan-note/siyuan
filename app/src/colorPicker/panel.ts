import {AdaptiveDialog} from "../dialog/adaptiveDialog";
import {registerColorPickerRuntime} from "./runtime";

export const registerColorPickerWindow = () => {
    registerColorPickerRuntime(document, options => new AdaptiveDialog(options), () =>
        window.siyuan.isReady ? window.siyuan.languages : undefined);
};

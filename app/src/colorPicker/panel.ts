import {Dialog} from "../dialog";
import {registerColorPickerRuntime} from "./runtime";

export const registerColorPickerWindow = () => {
    registerColorPickerRuntime(document, options => new Dialog(options), () =>
        window.siyuan.isReady ? window.siyuan.languages : undefined);
};

import {confirmDialog} from "../dialog/confirmDialog";
import {Plugin} from "./index";
import {showMessage} from "../dialog/message";
import {Dialog} from "../dialog";

export const API = {
    Plugin: Plugin,
    confirm: confirmDialog,
    showMessage,
    Dialog
};

import {confirmDialog} from "../dialog/confirmDialog";
import {Plugin} from "./index";
import {showMessage} from "../dialog/message";

export const API = {
    Plugin: Plugin,
    Confirm: confirmDialog,
    Message: showMessage
};

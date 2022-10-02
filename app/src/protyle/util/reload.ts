import {addLoading} from "../ui/initUI";
import {fetchPost} from "../../util/fetch";
import {Constants} from "../../constants";
import {onGet} from "./onGet";
import {saveScroll} from "../scroll/saveScroll";

export const reloadProtyle = (protyle:IProtyle) => {
    if (protyle.options.backlinkData) {
        return;
    }
    if (window.siyuan.config.editor.displayBookmarkIcon) {
        protyle.wysiwyg.element.classList.add("protyle-wysiwyg--attr");
    } else {
        protyle.wysiwyg.element.classList.remove("protyle-wysiwyg--attr");
    }
    protyle.lute.SetProtyleMarkNetImg(window.siyuan.config.editor.displayNetImgMark);
    addLoading(protyle);
    fetchPost("/api/filetree/getDoc", {
        id: protyle.block.showAll ? protyle.block.id : protyle.block.rootID,
        mode: 0,
        size: protyle.block.showAll ? Constants.SIZE_GET_MAX : Constants.SIZE_GET,
    }, getResponse => {
        onGet(getResponse, protyle, protyle.block.showAll ? [Constants.CB_GET_ALL, Constants.CB_GET_FOCUS] : [Constants.CB_GET_FOCUS], saveScroll(protyle, true), true);
    });
};

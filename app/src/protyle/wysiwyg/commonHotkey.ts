import {matchHotKey} from "../util/hotKey";
import {fetchPost} from "../../util/fetch";
import {writeText} from "../util/compatibility";
import {focusByOffset, getSelectionOffset} from "../util/selection";
import {fullscreen, netImg2LocalAssets} from "../breadcrumb/action";
import {setPadding} from "../ui/initUI";
import {openBacklink, openGraph, openOutline} from "../../layout/dock/util";
import {reloadProtyle} from "../util/reload";

export const commonHotkey = (protyle: IProtyle, event: KeyboardEvent) => {
    const target = event.target as HTMLElement;
    if (matchHotKey(window.siyuan.config.keymap.editor.general.copyHPath.custom, event)) {
        fetchPost("/api/filetree/getHPathByID", {
            id: protyle.block.rootID
        }, (response) => {
            writeText(response.data);
        });
        event.preventDefault();
        event.stopPropagation();
        return true;
    }

    if (matchHotKey(window.siyuan.config.keymap.editor.general.refresh.custom, event)) {
        reloadProtyle(protyle);
        event.preventDefault();
        event.stopPropagation();
        return true;
    }

    if (matchHotKey(window.siyuan.config.keymap.editor.general.fullscreen.custom, event)) {
        fullscreen(protyle.element);
        setPadding(protyle);
        event.preventDefault();
        event.stopPropagation();
        return true;
    }
    if (matchHotKey(window.siyuan.config.keymap.editor.general.netImg2LocalAsset.custom, event)) {
        netImg2LocalAssets(protyle);
        event.preventDefault();
        event.stopPropagation();
        return;
    }
    if (protyle.model) {
        if (matchHotKey(window.siyuan.config.keymap.editor.general.backlinks.custom, event)) {
            event.preventDefault();
            event.stopPropagation();
            openBacklink(protyle);
            return true;
        }
        if (matchHotKey(window.siyuan.config.keymap.editor.general.graphView.custom, event)) {
            event.preventDefault();
            event.stopPropagation();
            openGraph(protyle);
            return true;
        }
        if (matchHotKey(window.siyuan.config.keymap.editor.general.outline.custom, event)) {
            event.preventDefault();
            event.stopPropagation();
            const offset = getSelectionOffset(target);
            openOutline(protyle);
            // switchWnd 后，range会被清空，需要重新设置
            focusByOffset(target, offset.start, offset.end);
            return true;
        }
    }
};

import {confirmDialog} from "../../dialog/confirmDialog";
import {showMessage} from "../../dialog/message";
import {escapeHtml} from "../../util/escape";
import {fetchSyncPost} from "../../util/fetch";

export const openPluginPublishData = async (packageName: string) => {
    const response = await fetchSyncPost("/api/petal/getPluginPublishInfo", {packageName});
    if (response.code !== 0 || !response.data) {
        return;
    }
    const {fields, granted} = response.data;
    if (fields.length === 0) {
        showMessage(window.siyuan.languages.pluginPublishDataUnavailable);
        return;
    }
    confirmDialog(window.siyuan.languages.pluginPublishData,
        `<div>${escapeHtml(packageName)}</div>` +
        escapeHtml(granted ? window.siyuan.languages.pluginPublishDataRevokeTip :
            window.siyuan.languages.pluginPublishDataGrantTip) +
        `<ul>${fields.map(field => `<li>${escapeHtml(field)}</li>`).join("")}</ul>`, () => {
            void fetchSyncPost("/api/petal/setPluginPublishDataGrant", {
                packageName,
                fields,
                enabled: !granted,
            });
        });
};

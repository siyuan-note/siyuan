import {renderSnippet} from "../config/util/snippets";
import {Constants} from "../constants";
import {initMessage} from "../dialog/message";
import {setTitle} from "../dialog/processSystem";
import {addScript} from "../protyle/util/addScript";
import {getLocalStorage} from "../protyle/util/compatibility";
import {fetchGet, fetchPost} from "../util/fetch";
import {setNoteBook} from "../util/pathName";

export const initApp = async () => {
    await Promise.all([
        addScript(
            `${Constants.PROTYLE_CDN}/js/lute/lute.min.js?v=${Constants.SIYUAN_VERSION}`,
            Constants.ELEMENT_ID_PROTYLE_LUTE_SCRIPT,
            Constants.ELEMENT_ID_META_ANCHOR.PROTYLE_SCRIPT,
        ),
        addScript(
            `${Constants.PROTYLE_CDN}/js/protyle-html.js?v=${Constants.SIYUAN_VERSION}`,
            Constants.ELEMENT_ID_PROTYLE_HTML_SCRIPT,
            Constants.ELEMENT_ID_META_ANCHOR.PROTYLE_SCRIPT,
        ),
        new Promise(resolve => setNoteBook(resolve)),
        new Promise<void>(resolve => getLocalStorage(resolve)),
        new Promise<void>(resolve => renderSnippet(resolve)),
        new Promise(async resolve => fetchGet(`/appearance/langs/${window.siyuan.config.appearance.lang}.json?v=${Constants.SIYUAN_VERSION}`, response => {
            window.siyuan.languages = response;
            resolve(null);
        })),
        new Promise(async resolve => fetchPost("/api/setting/getCloudUser", {}, response => {
            window.siyuan.user = response.data;
            resolve(null);
        })),
        new Promise(async resolve => fetchPost("/api/system/getEmojiConf", {}, response => {
            window.siyuan.emojis = response.data;
            resolve(null);
        })),
    ]);
    initMessage();
    setTitle(window.siyuan.languages.siyuanNote);
};

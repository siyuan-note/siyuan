import {fetchPost} from "../../util/fetch";

export const setReadOnly = (readOnly: boolean) => {
    window.siyuan.config.editor.readOnly = readOnly;
    fetchPost("/api/setting/setEditor", window.siyuan.config.editor);
};

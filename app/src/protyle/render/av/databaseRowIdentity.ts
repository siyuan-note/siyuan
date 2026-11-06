import {isEncryptedBox} from "../../../util/pathName";

export const isSameDatabaseRowDomain = (left?: string, right?: string) => {
    if (!left || !right || !window.siyuan.notebooks?.some(notebook => notebook.id === left) ||
        !window.siyuan.notebooks.some(notebook => notebook.id === right)) return false;
    return isEncryptedBox(left) || isEncryptedBox(right) ? left === right : true;
};

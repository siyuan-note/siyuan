import {isLocalPath, pathPosix} from "../util/pathName";
/// #if !BROWSER
import {shell} from "electron";
/// #endif
import {getSearch} from "../util/functions";
import {openByMobile} from "../protyle/util/compatibility";
import {Constants} from "../constants";
import {showMessage} from "../dialog/message";
import {openAsset, openBy} from "./util";

export const openLink = (protyle: IProtyle, aLink: string, event?: MouseEvent, ctrlIsPressed = false) => {
    let linkAddress = Lute.UnEscapeHTMLStr(aLink);
    let pdfParams;
    if (isLocalPath(linkAddress) && !linkAddress.startsWith("file://") && linkAddress.indexOf(".pdf") > -1) {
        const pdfAddress = linkAddress.split("/");
        if (pdfAddress.length === 3 && pdfAddress[0] === "assets" && pdfAddress[1].endsWith(".pdf") && /\d{14}-\w{7}/.test(pdfAddress[2])) {
            linkAddress = `assets/${pdfAddress[1]}`;
            pdfParams = pdfAddress[2];
        } else {
            pdfParams = parseInt(getSearch("page", linkAddress));
            linkAddress = linkAddress.split("?page")[0];
        }
    }
    /// #if MOBILE
    openByMobile(linkAddress);
    /// #else
    if (isLocalPath(linkAddress)) {
        if (Constants.SIYUAN_ASSETS_EXTS.includes(pathPosix().extname(linkAddress)) &&
            (!linkAddress.endsWith(".pdf") ||
                (linkAddress.endsWith(".pdf") && !linkAddress.startsWith("file://")))
        ) {
            if (event && event.altKey) {
                openAsset(protyle.app, linkAddress, pdfParams);
            } else if (ctrlIsPressed) {
                /// #if !BROWSER
                openBy(linkAddress, "folder");
                /// #else
                openByMobile(linkAddress);
                /// #endif
            } else if (event && event.shiftKey) {
                /// #if !BROWSER
                openBy(linkAddress, "app");
                /// #else
                openByMobile(linkAddress);
                /// #endif
            } else {
                openAsset(protyle.app, linkAddress, pdfParams, "right");
            }
        } else {
            /// #if !BROWSER
            if (ctrlIsPressed) {
                openBy(linkAddress, "folder");
            } else {
                openBy(linkAddress, "app");
            }
            /// #else
            openByMobile(linkAddress);
            /// #endif
        }
    } else if (linkAddress) {
        if (0 > linkAddress.indexOf(":")) {
            // 使用 : 判断，不使用 :// 判断 Open external application protocol invalid https://github.com/siyuan-note/siyuan/issues/10075
            // Support click to open hyperlinks like `www.foo.com` https://github.com/siyuan-note/siyuan/issues/9986
            linkAddress = `https://${linkAddress}`;
        }
        /// #if !BROWSER
        shell.openExternal(linkAddress).catch((e) => {
            showMessage(e);
        });
        /// #else
        openByMobile(linkAddress);
        /// #endif
    }
    /// #endif
};

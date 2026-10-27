import {installStartupError} from "../boot/startupError";
import {installInertFallback} from "../boot/inert";
import "../assets/scss/startup.scss";

declare const SIYUAN_VERSION: string;

installStartupError(window, SIYUAN_VERSION);
installInertFallback(document);

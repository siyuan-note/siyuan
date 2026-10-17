import {installStartupError} from "../boot/startupError";
import "../assets/scss/startup.scss";

declare const SIYUAN_VERSION: string;

installStartupError(window, SIYUAN_VERSION);

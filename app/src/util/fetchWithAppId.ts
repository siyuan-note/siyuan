import {Constants} from "../constants";
import {withAPIAppId} from "./fetchAppId";

// 宿主接口请求携带调用窗口标识，其他地址保持原生 fetch 行为。
export const fetchWithAppId: typeof fetch = (input: RequestInfo | URL, init?: RequestInit) =>
    fetch(input, withAPIAppId(input, init, Constants.SIYUAN_APPID, document.baseURI, location.origin));

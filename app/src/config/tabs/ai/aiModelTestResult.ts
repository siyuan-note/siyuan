import type {AIModelTestData} from "../../../types/api";
import {escapeHtmlTextAndAttr} from "../../../util/escape";

type ModelTestMessages = {
    testConnectionSuccess: string;
    testConnectionFail: string;
    testConnectionFailMsg: string;
};

export const getModelTestMessage = (data: AIModelTestData, messages: ModelTestMessages): string => {
    if (data.matched) {
        return messages.testConnectionSuccess;
    }
    // 模型清单与生成探测的结果独立，失败时优先显示实际请求错误。
    return data.msg
        ? messages.testConnectionFailMsg.replace("${msg}", escapeHtmlTextAndAttr(data.msg))
        : messages.testConnectionFail;
};

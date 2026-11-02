import type {MarkdownFailure} from "./contracts";

export const markdownErrorKey = (error?: MarkdownFailure): string => ({
    permission: "markdownPermissionDenied",
    readonly: "markdownReadOnly",
    offline: "markdownFileOffline",
    unavailable: "markdownFileUnavailable",
    deleted: "markdownFileDeleted",
    "identity-changed": "markdownFileReplaced",
    encoding: "agentSkillEncodingTip",
    size: "markdownTooLarge",
    space: "markdownNoSpace",
    io: "markdownError",
    protocol: "markdownError",
}[error?.code] ?? "markdownError");

export interface AgentNotificationTarget {
    sessionID: string;
    kind: "confirm" | "question";
    interactionID: string;
}

export const isAgentNotificationID = (value: unknown): value is string =>
    typeof value === "string" && value.length > 0 && value.length <= 512 &&
    Array.from(value).every(character => character.charCodeAt(0) > 31 && character.charCodeAt(0) !== 127);

export const parseAgentNotificationTarget = (value: unknown): AgentNotificationTarget | undefined => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return;
    }
    const target = value as Record<string, unknown>;
    if (!isAgentNotificationID(target.sessionID) || !isAgentNotificationID(target.interactionID) ||
        (target.kind !== "confirm" && target.kind !== "question")) {
        return;
    }
    return {sessionID: target.sessionID, kind: target.kind, interactionID: target.interactionID};
};

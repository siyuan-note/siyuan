import {escapeHtml} from "../../../util/escape";

export const renderAgentConfirmArgs = (args: Record<string, unknown>) =>
    escapeHtml(JSON.stringify(args, null, 2)).replace(/(?<![\w-])\d{14}-[a-z0-9]{7}(?![\w-])/g,
        id => `<a href="siyuan://blocks/${id}">${id}</a>`);

export const genAgentConfirmActionButtons = (forced: boolean, labels: {
    reject: string;
    approve: string;
    allowSession: string;
    allowSessionDescription: string;
}) => '<button class="b3-button b3-button--cancel agent-chat__confirm-reject">' + labels.reject + "</button>" +
    '<button class="b3-button b3-button--text agent-chat__confirm-approve">' + labels.approve + "</button>" +
    (forced ? "" : '<button class="b3-button b3-button--text agent-chat__confirm-always ariaLabel" data-position="n" aria-label="' +
        labels.allowSessionDescription + '">' + labels.allowSession + "</button>");

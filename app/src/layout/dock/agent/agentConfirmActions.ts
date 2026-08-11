export const genAgentConfirmActionButtons = (forced: boolean, labels: {
    reject: string;
    approve: string;
    allowSession: string;
    allowSessionDescription: string;
}) => '<button class="b3-button b3-button--cancel agent-chat__confirm-reject">' + labels.reject + "</button>" +
    '<button class="b3-button b3-button--text agent-chat__confirm-approve">' + labels.approve + "</button>" +
    (forced ? "" : '<button class="b3-button b3-button--text agent-chat__confirm-always ariaLabel" data-position="n" aria-label="' +
        labels.allowSessionDescription + '">' + labels.allowSession + "</button>");

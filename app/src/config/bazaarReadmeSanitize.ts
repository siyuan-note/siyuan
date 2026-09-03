export const BAZAAR_README_ALLOWED_URI_REGEXP = /^(?:(?:(?:f|ht)tps?|mailto|tel|callto|sms|cid|xmpp|matrix|siyuan|web\+siyuan):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i;

export const BAZAAR_README_SANITIZE_OPTIONS = {
    FORBID_TAGS: ["iframe", "frame", "frameset"],
    ALLOWED_URI_REGEXP: BAZAAR_README_ALLOWED_URI_REGEXP,
};

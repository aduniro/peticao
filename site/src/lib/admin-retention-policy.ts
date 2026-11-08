/** Explicit owner decision, 2026-11-08: email content, attachments and admin drafts. */
export const ADMIN_CONTENT_RETENTION_DAYS = 30;
export const ADMIN_CONTENT_RETENTION_MS = ADMIN_CONTENT_RETENTION_DAYS * 86400000;
export const adminContentDeadline = (now = Date.now()) => new Date(now + ADMIN_CONTENT_RETENTION_MS);

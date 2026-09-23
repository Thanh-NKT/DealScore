export const PURGE_AFTER_DAYS = 30;
const MS_PER_DAY = 86_400_000;

/** Accounts with deleted_at earlier than this cutoff are due for hard deletion. */
export function purgeCutoff(now: Date): Date {
  return new Date(now.getTime() - PURGE_AFTER_DAYS * MS_PER_DAY);
}

/** Hard-deletion date shown to the user. */
export function purgeDate(deletedAt: Date): Date {
  return new Date(deletedAt.getTime() + PURGE_AFTER_DAYS * MS_PER_DAY);
}

export const PURGE_AFTER_DAYS = 30;
const MS_PER_DAY = 86_400_000;

/** Tài khoản có deleted_at < mốc này thì đủ hạn xóa hẳn. */
export function purgeCutoff(now: Date): Date {
  return new Date(now.getTime() - PURGE_AFTER_DAYS * MS_PER_DAY);
}

/** Ngày xóa hẳn hiển thị cho người dùng. */
export function purgeDate(deletedAt: Date): Date {
  return new Date(deletedAt.getTime() + PURGE_AFTER_DAYS * MS_PER_DAY);
}

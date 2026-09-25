# ✅ Checklist Admin — Personal Shopping Intelligence

> Tách từ mục **1.8 Admin tối thiểu** của [`feature-checklist.md`](feature-checklist.md) (Giai đoạn 1).
> Làm sau, như một đợt riêng. Đánh dấu `[x]` khi hoàn thành.

## Đã có sẵn trong code / DB (điểm nối)
- Bảng `match_candidates` — hàng đợi offer → variant (1.9 Matching v0 ghi vào đây khi confidence < 95%).
- `products.status = 'draft'` — sản phẩm tạo tự động từ ingest khi dán URL lạ, chờ duyệt.
- `offers.match_status` (`auto` / `manual` / `rejected` / `pending`).
- Bảng `collector_runs` — nguồn cho dashboard sức khỏe pipeline.
- View doanh thu / tỷ lệ khớp affiliate (1.5, migration `0007`).

## Quyết định cần chốt trước khi làm
- [ ] Ai là admin: `app_metadata.role = 'admin'` (kiểm được cả trong SQL) hay danh sách `ADMIN_EMAILS` trong env
- [ ] Phạm vi UI: trang `/admin` riêng hay dùng Supabase Studio cho việc hiếm

## Tính năng
- [ ] Chặn quyền: helper `requireAdmin()` + mọi server action admin kiểm quyền trước, dùng client `admin`
- [ ] Quản lý catalog: thêm / sửa / verify sản phẩm & variant (`draft` → `verified`)
- [ ] Hàng đợi duyệt matching: duyệt / từ chối / gán lại offer → variant từ `match_candidates`
- [ ] Merge sản phẩm (gộp variant, chuyển offer, Watch và lịch sử giá) / split sản phẩm
- [ ] Dashboard sức khỏe pipeline: lượt collector gần nhất, tỷ lệ lỗi, offer stale > 48 giờ
- [ ] Cảnh báo khi sync fail / stale (email cho admin)
- [ ] Báo cáo affiliate: doanh thu, tỷ lệ khớp đơn ↔ click (đọc view có sẵn)

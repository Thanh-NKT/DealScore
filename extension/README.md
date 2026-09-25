# Kairo — Chrome Extension (Manifest V3)

Hiện giá Kairo ghi nhận, Deal Score và kết luận Nên mua / Có thể chờ / Chưa nên mua ngay trên trang sản phẩm
Shopee; đặt Watch một chạm; và (nếu người dùng bật) chia sẻ giá đang xem để Kairo có thêm dữ liệu.
Spec: `docs/superpowers/specs/2026-09-25-giai-doan-2-nhom-bc.md` §6.

## Chạy thử (dev)

1. `pnpm dev` (Kairo ở `http://localhost:3000`). Không đặt `EXTENSION_IDS` thì mọi extension "unpacked" được
   gọi API ở môi trường dev.
2. Chrome → `chrome://extensions` → bật *Developer mode* → *Load unpacked* → chọn thư mục `extension/`.
3. Mở popup Kairo → *Nâng cao* → chọn `localhost:3000`. Đăng nhập Kairo trên cùng Chrome.
4. Mở một sản phẩm Shopee đã có trong catalog Kairo.

## Production

- Đặt `EXTENSION_IDS=<id của extension trên Chrome Web Store>` cho app (nhiều id cách nhau bằng dấu phẩy).
  API `/api/extension/*` từ chối mọi Origin khác, kể cả trang web khác có cookie Kairo.
- `host_permissions` gồm `https://kairo.vn/*`; nếu đổi domain, sửa `manifest.json` và `DEFAULT_ORIGIN` trong
  `src/background.js`.
- Thêm icon 16/48/128 px vào `manifest.json` trước khi nộp Web Store.

## Giả định cần kiểm lại trên trang thật (E1)

`src/parse-shopee.js` đọc giá từ chữ hiển thị (`₫2.390.000`, khoảng giá khi chưa chọn phân loại, badge `-NN%`,
"N sản phẩm có sẵn") và phân loại đang chọn từ nút `aria-pressed/aria-checked="true"`. Nếu Shopee đổi giao diện,
parser trả về "không đọc được" thay vì đoán; khung Kairo vẫn hiện (nhận diện sản phẩm chỉ dựa vào URL).

## Dữ liệu gửi đi

Chỉ khi bật "Chia sẻ giá": item id, giá, giá niêm yết, tồn kho, freeship, voucher, tên phân loại đang chọn.
Mỗi sản phẩm tối đa 1 lần / 30 phút / trình duyệt; server giới hạn 60 lượt / giờ / người góp. Giá chỉ vào lịch sử
khi được xác nhận chéo (`src/lib/extension/corroborate.ts`).

## Giả định E2 — cookie phiên

Service worker gọi Kairo với `credentials: "include"`; Chrome gửi cookie Kairo cho host có trong
`host_permissions`. Nếu cookie phiên (SameSite=Lax) không được gửi trên bản Chrome đang dùng, panel sẽ luôn hiện
"Đăng nhập Kairo…" — khi đó cần chuyển sang token riêng cho extension.

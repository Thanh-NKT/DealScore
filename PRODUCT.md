# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Người mua hàng trên các sàn thương mại điện tử Việt Nam, bất kể ngành hàng, có nhu cầu cân nhắc giá trước khi mua và tra cứu trên web. Công việc của họ: đứng trước một sản phẩm (thường là một link sàn), cần biết giá lúc này có tốt không, nên mua ngay hay chờ, và đợt "giảm giá" có thật không.

Họ không phải chuyên gia dữ liệu: cần một câu trả lời rõ ràng kèm lý do đọc hiểu được, không phải một bảng số để tự phân tích.

## Product Purpose

Kairo là nền tảng theo dõi giá (Personal Shopping Intelligence): lưu lịch sử giá chuẩn hóa theo variant, chấm Deal Score có giải thích, và trả lời **Nên mua / Có thể chờ / Chưa nên mua**, sau đó theo dõi (Watch) và báo (Alert) khi đến thời điểm tốt.

Thành công: người dùng tin câu trả lời đủ để hành động theo nó. North Star là số Watch đang hoạt động; các cổng kiểm chứng gồm Alert→Click ≥ 15%, Retention D30 ≥ 25%, backtest Buy/Wait đúng ≥ 80%.

## Positioning

Đối thủ (BeeCost, Lichsugia, Mua Thông Minh, AliPrice, BigBuy360) chủ yếu đưa biểu đồ lịch sử giá. Kairo đưa **câu trả lời có giải thích**: Deal Score kèm 2–4 lý do tự sinh, khuyến nghị mua/chờ, phát hiện giảm giá chưa thực chất (giá niêm yết bị thổi, tăng giá trước sale), trên lịch sử chuẩn hóa theo variant và gộp nhiều offer/seller của cùng một sản phẩm. Khi chưa đủ dữ liệu, Kairo nói thẳng là chưa đủ thay vì đoán.

## Operating Context

- Cửa vào chính: dán URL sàn (hiện là Shopee) → trang sản phẩm; tìm kiếm từ khóa trong catalog (chịu gõ sai, gõ không dấu); PWA share target trên Android (Share từ app Shopee → Kairo).
- Trang sản phẩm là nơi quyết định: giá hiện tại theo variant, danh sách offer, biểu đồ 7/30/90 ngày, Low/Median/High, Deal Score + lý do, khuyến nghị, cảnh báo sale ảo, thời điểm cập nhật dữ liệu, nút mua qua `/go/…`.
- Sau đó: tạo Watch với điều kiện (giá ≤ mục tiêu, giảm ≥ X%, chạm đáy, Deal Score ≥ X, có hàng lại), nhận alert qua email / web push.
- Doanh thu từ affiliate (Shopee Affiliate), về sau Premium và sponsored có gắn nhãn.

## Capabilities and Constraints

- Stack: Next.js 16 App Router, React 19, Tailwind 4, Supabase (Postgres, RLS). Toàn bộ chữ hiển thị bằng **tiếng Việt**.
- Nguồn dữ liệu hiện chỉ có Shopee; TikTok Shop rồi Lazada ở giai đoạn 2. Catalog khởi đầu (G1) tập trung ngách công nghệ, sẽ mở rộng sang ngách lân cận.
- Deal Score v0: percentile giá 50% / khoảng cách tới đáy 30% / so sánh offer 20% (62.5/37.5 khi không có offer so sánh). Chỉ chấm khi có ≥ 14 ngày và ≥ 10 quan sát hợp lệ; dưới ngưỡng là trạng thái "Chưa đủ dữ liệu".
- Thuật ngữ cố định: Deal Score, Nên mua / Có thể chờ / Chưa nên mua / Chưa đủ dữ liệu, "Giảm giá chưa thực chất", Watch, Alert, variant, offer.
- Trang sản phẩm và `/tim-kiem` phải SSR và dùng được đầy đủ khi tắt JavaScript (phục vụ SEO).
- Không bịa số: thiếu dữ liệu thì nói thiếu, không hiện `0 ₫`, `−0%`, không nội suy biểu đồ. Offer chưa khớp chắc chắn (`pending`) không được hiển thị như cùng sản phẩm.
- Chưa quyết: tài khoản (magic link), kênh alert, trang Watch — thuộc các spec sau.

## Brand Commitments

- Tên: **Kairo**.
- Tagline: **"Đừng chỉ tìm giá rẻ. Tìm đúng thời điểm để mua."**
- Minh bạch affiliate: luôn có dòng disclosure cạnh nút mua; nội dung sponsored bắt buộc gắn nhãn; hoa hồng không được ảnh hưởng tới khuyến nghị.

## Evidence on Hand

- Chưa có logo, ảnh thương hiệu, testimonial, số liệu người dùng, press hay case study. Không được bịa bất kỳ thứ nào trong số này.
- Dữ liệu seed dev (`scripts/seed-dev.ts`) chỉ dùng cho phát triển, không phải số liệu thật để quảng bá.
- Tài liệu sản phẩm: `docs/feature-checklist.md`, `docs/superpowers/specs/`.

## Product Principles

1. **Trả lời, không chỉ trưng số.** Mỗi màn hình quan trọng dẫn tới một khuyến nghị rõ ràng kèm lý do.
2. **Trung thực hơn tự tin.** Chưa đủ dữ liệu thì nói chưa đủ; không nội suy, không làm tròn cho đẹp.
3. **Lợi ích người mua đứng trước hoa hồng.** Affiliate luôn được công khai và không bao giờ bẻ cong khuyến nghị.
4. **Giải thích khớp với phép tính.** Lý do và trọng số hiển thị phải đúng với cái engine thực sự đã dùng.
5. **Nhanh và nhẹ ở cửa vào.** Dán link là ra câu trả lời, kể cả trên điện thoại và khi không có JS.

## Accessibility & Inclusion

Màu không bao giờ là kênh thông tin duy nhất: mọi trạng thái khuyến nghị và cảnh báo đều có chữ đi kèm (người mù màu ~8% nam giới). Hỗ trợ cả giao diện sáng và tối theo `prefers-color-scheme`.

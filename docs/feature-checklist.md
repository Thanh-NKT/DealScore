# ✅ Checklist Feature — Personal Shopping Intelligence

> Trích & tổ chức từ `product_backlog_personal_shopping_intelligence_v2.md`.
> Checklist theo lộ trình 5 giai đoạn. Đánh dấu `[x]` khi hoàn thành.

**North Star:** số Watch đang hoạt động.
**Nguyên tắc chặn:** Collector phải chạy từ tuần đầu Giai đoạn 0 — lịch sử giá bỏ lỡ không lấy lại được.

---

## 🧪 Giai đoạn 0 — Kiểm chứng & gom dữ liệu (tuần 1–4)

### Hạ tầng dữ liệu (ưu tiên cao nhất)
- [ ] Đăng ký Shopee Affiliate + lấy quyền Open API
- [ ] Spike API: cấp giá (listing/variant), original price, stock, rating, voucher, flash sale, rate limit, phạm vi phủ, trường conversion report
- [ ] Kiểm tra bảng commission thực tế của ngách công nghệ
- [ ] Dựng catalog khởi đầu 500–2.000 sản phẩm (brand, model, variant, specs)
- [ ] Collector chạy ổn định, ghi `price_observations` + `collector_runs`

### Chiến lược & pháp lý
- [ ] Phân tích đối thủ (BeeCost, Lichsugia, Mua Thông Minh, AliPrice, BigBuy360)
- [ ] Landing page + waitlist
- [ ] Privacy policy, terms, affiliate disclosure (bản cơ bản)

**Điều kiện sang G1:** biết rõ API cung cấp gì · collector chạy ≥ 2 tuần, lỗi < 5% · vài trăm người waitlist.

---

## 🚀 Giai đoạn 1 — MVP "Watch & Alert" (tháng 2–3)

### 1.1 Tra cứu (cửa vào chính)
- [ ] Dán URL Shopee → trả về trang sản phẩm (P0)
- [ ] Search từ khóa trong catalog (tên/brand/model/SKU) + autocomplete + chịu lỗi gõ sai
- [ ] Filter: danh mục, brand, khoảng giá — Sort: Deal Score, giá, mới cập nhật
- [ ] PWA share target (nếu khả thi)

### 1.2 Trang sản phẩm
- [ ] Giá hiện tại theo variant + giá niêm yết + % giảm
- [ ] Danh sách offer cùng variant (nhiều seller), sắp theo giá
- [ ] Chart giá 7/30/90 ngày, đánh dấu điểm flash sale
- [ ] Low / Median / High + "Bắt đầu theo dõi từ ngày…"
- [ ] Deal Score v0 + giải thích (2–4 lý do tự sinh)
- [ ] Buy / Wait / Avoid (gồm trạng thái "Chưa đủ dữ liệu")
- [ ] Nhãn "Giảm giá chưa thực chất" (Fake Sale Detector v0)
- [ ] Hiển thị thời điểm cập nhật dữ liệu
- [ ] Nút mua qua `/go/…` (affiliate) + dòng disclosure

### 1.3 Watch (gộp Wishlist + Target Price + Alert)
- [ ] Tạo / sửa / xóa Watch cho một variant
- [ ] Điều kiện trigger: giá ≤ target, giảm ≥ X%, chạm đáy, Deal Score ≥ X, có hàng lại
- [ ] Hiển thị khoảng cách tới target + thay đổi giá + trạng thái alert
- [ ] Danh sách "Watch của tôi"

### 1.4 Alert
- [ ] Kênh email + web push
- [ ] Chống spam: tối đa 1 alert/Watch/24h + gộp nhiều alert thành 1 email
- [ ] Nội dung alert: giá mới, Deal Score, lý do, link mua, link quản lý Watch
- [ ] Bật/tắt từng kênh, chọn tần suất

### 1.5 Affiliate
- [ ] Sinh + cache affiliate link / short link
- [ ] Redirect `/go/{marketplace}/{offer_id}` + ghi `click_events` với sub_id
- [ ] Nhập conversion report vào bảng `conversions`

### 1.6 Tài khoản
- [ ] Đăng nhập email (magic link)
- [ ] Cài đặt thông báo, xóa tài khoản, xuất dữ liệu

### 1.7 SEO nền tảng
- [ ] SSR cho trang sản phẩm / danh mục / brand
- [ ] URL chuẩn (`/ssd/samsung-990-pro-2tb`, `/brand/…`, `/danh-muc/…`)
- [ ] Sitemap + structured data (Product, Offer) + OG image

### 1.8 Admin tối thiểu
- [ ] Quản lý catalog (thêm/sửa/verify sản phẩm & variant)
- [ ] Hàng đợi duyệt matching (offer → variant)
- [ ] Merge / split sản phẩm
- [ ] Dashboard sức khỏe pipeline + cảnh báo sync fail / stale

### 1.9 Product matching v0
- [ ] Gợi ý tự động từ brand + model + dung lượng/màu/size
- [ ] Confidence ≥ 95% → tự gán; thấp hơn → hàng đợi duyệt

### 1.10 Hạ tầng
- [ ] Pipeline: Collector → Normalizer → Matcher → Price DB → Deal Engine → Alert Engine
- [ ] Backtest job chạy hằng tuần
- [ ] Rate limiting + chống bot cho lookup URL + backup DB
- [ ] Error tracking (Sentry) + uptime monitoring

### 1.11 Analytics
- [ ] Event tracking cho các chỉ số North Star (PostHog / GA4)

**Điều kiện sang G2:** ≥ 1.000 Watch · Alert→Click ≥ 15% · Retention D30 ≥ 25% · có đơn affiliate đối soát · backtest Buy/Wait ≥ 80%.

---

## 📈 Giai đoạn 2 — Mở rộng & tạo moat (tháng 4–6)
- [ ] Chrome Extension (nhận diện trang Shopee, Deal Score, tạo Watch, thu quan sát giá có đồng ý)
- [ ] Mở rộng nguồn: TikTok Shop → Lazada
- [ ] So sánh giữa các sàn (khi ≥ 2 sàn)
- [ ] Product comparison A vs B
- [ ] Price Drop Radar (trang sản phẩm giảm mạnh)
- [ ] Trang "Trending / Most Watched"
- [ ] Share deal kèm OG image
- [ ] Deal Score v1 (thêm trend, volatility, stock, seller quality)
- [ ] Product matching v1 + dashboard chất lượng dữ liệu
- [ ] Google login
- [ ] Filter nâng cao (rating, freeship, voucher)
- [ ] Mở rộng catalog sang ngách lân cận

**Điều kiện sang G3:** dữ liệu ≥ 2 sàn ổn định, matching ≥ 95% · Watch & doanh thu affiliate tăng theo tháng · SEO chiếm tỷ trọng traffic đáng kể.

---

## 🧠 Giai đoạn 3 — Intelligence (tháng 6–12)
- [ ] Search hiểu ý định ("SSD 2TB dưới 3 triệu")
- [ ] Natural language search
- [ ] Shopping Mission (mô tả nhu cầu → shortlist 3 sản phẩm)
- [ ] Mission tự theo dõi (Watch nhiều sản phẩm)
- [ ] Cá nhân hóa (Deal Feed + ranking + recommendation)
- [ ] Kênh alert mới: Telegram bot, Zalo
- [ ] Voucher & Effective Price
- [ ] User preferences (brand/danh mục/giá/sàn)

---

## 🏢 Giai đoạn 4 — Kinh doanh hóa (năm 2+)
- [ ] Premium (alert tần suất cao, nhiều Watch, phân tích nâng cao, Pro agent)
- [ ] Sponsored / featured (bắt buộc gắn nhãn)
- [ ] Public API (`/products`, `/prices`, `/history`, `/deals`, `/search`)
- [ ] B2B Price Intelligence
- [ ] Mobile app native + visual/voice search + quốc tế
- [ ] Price prediction (dạng xác suất)

---

## 📌 Tham chiếu spec
- **Deal Score v0:** percentile giá 50% / khoảng cách tới đáy 30% / so sánh offer 20% (reweight 62.5/37.5 khi không có bestOffer).
- **Ngưỡng dữ liệu:** ≥ 14 ngày & ≥ 10 quan sát hợp lệ mới chấm điểm.
- **Buy/Wait/Avoid:** 🟢 ≥75 & P≤median · 🟡 50–74 · 🔴 <50 hoặc P>median×1.05 · ⚪ chưa đủ dữ liệu.
- **Fake Sale v0:** giảm niêm yết ≥20% nhưng P≥median×0.95, hoặc tăng giá trước sale (median 14d > median 60d ×1.15).

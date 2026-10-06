# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Mọi người mua sắm online ở Việt Nam, 18–55 tuổi, đa số không rành công nghệ. Họ mua đủ loại hàng: gia dụng, mỹ phẩm, thời trang, mẹ & bé, thực phẩm, điện tử. Nhiều người lần đầu biết đến khái niệm "lịch sử giá".

Việc họ cần làm: biết **giá hiện tại có thật sự tốt không** và **nên mua ở sàn nào**, trong vài giây, không cần hiểu biểu đồ hay thuật ngữ.

Các ví dụ công nghệ (SSD, laptop, card đồ họa) trong backlog, spec và dữ liệu seed chỉ là minh họa từ giai đoạn đầu, không phản ánh tệp người dùng hay ngành hàng mục tiêu.

## Product Purpose

DealScore (Personal Shopping Intelligence) lưu lịch sử giá chuẩn hóa theo variant, gom các listing khác nhau về cùng một sản phẩm, chấm Deal Score có giải thích và trả lời **Nên mua / Có thể chờ / Chưa nên mua**. Sau đó người dùng đặt giá mục tiêu (Watch) và nhận Alert khi đến lúc.

Vòng lặp lõi cần chứng minh: Search → hiểu đúng sản phẩm → giá hiện tại → giá lịch sử → Deal Score → Buy/Wait → đặt mục tiêu → nhận alert → bấm link affiliate → có hoa hồng.

Thành công: người dùng tin câu trả lời đủ để hành động theo. North Star là số Watch đang hoạt động; các cổng kiểm chứng gồm Alert→Click ≥ 15%, Retention D30 ≥ 25%, backtest Buy/Wait đúng ≥ 80%.

## Positioning

Đối thủ (BeeCost, Lichsugia, Mua Thông Minh, AliPrice, BigBuy360) chủ yếu đưa biểu đồ lịch sử giá. DealScore đưa **câu trả lời có giải thích**, nói như một người bạn am hiểu mua sắm: Deal Score kèm 2–4 lý do bằng lời thường, khuyến nghị mua/chờ, so sánh giữa các sàn và seller, cảnh báo giảm giá chưa thực chất. Khi chưa đủ dữ liệu, DealScore nói thẳng là chưa đủ.

DealScore không phải công cụ phân tích tài chính và không phải trang khuyến mãi ồn ào.

## Operating Context

- **Thiết bị:** thiết kế ưu tiên **desktop** (quyết định của chủ sản phẩm, theo backlog), responsive trên tablet và mobile. Nhưng rất nhiều người dùng tới từ điện thoại: đang lướt Shopee/TikTok Shop rồi mở sang DealScore để kiểm tra giá, kết nối có thể chậm. Luồng tra cứu nhanh phải chạy tốt trên điện thoại và mạng chậm.
- **Cửa vào:** dán URL sàn → trang sản phẩm; tìm kiếm từ khóa (chịu gõ sai, gõ không dấu); PWA share target trên Android (Share từ app sàn → DealScore); về sau là Chrome Extension.
- **Trang sản phẩm là nơi quyết định:** giá hiện tại theo variant, giá giữa các sàn/seller, biểu đồ giá, thấp nhất/trung vị/cao nhất, Deal Score + lý do, khuyến nghị, cảnh báo sale chưa thực chất, thời điểm cập nhật, nút mua qua `/go/…`.
- **Sau đó:** Watch với điều kiện (giá ≤ mục tiêu, giảm ≥ X%, chạm đáy, Deal Score ≥ X, có hàng lại), Alert qua email / web push.
- **Doanh thu:** affiliate (Phase 1); về sau sponsored/featured có gắn nhãn, Premium.

## Capabilities and Constraints

- Stack: Next.js 16 App Router, React 19, Tailwind 4, Supabase (Postgres, RLS).
- **Giao diện tiếng Việt.** Định dạng giá kiểu **2.399.000đ**.
- Nguồn dữ liệu hiện chỉ có Shopee; TikTok Shop rồi Lazada sau, Tiki nếu phù hợp. So sánh giữa các sàn chỉ hiện khi có ≥ 2 sàn thật, không giả lập.
- Deal Score v0: percentile giá 50% / khoảng cách tới đáy 30% / so sánh offer 20% (62.5/37.5 khi không có offer so sánh). Chỉ chấm khi có ≥ 14 ngày và ≥ 10 quan sát hợp lệ; dưới ngưỡng là "Chưa đủ dữ liệu". **Hoa hồng affiliate không bao giờ là đầu vào của Deal Score.**
- Thuật ngữ cố định: Deal Score, Nên mua / Có thể chờ / Chưa nên mua / Chưa đủ dữ liệu, "Giảm giá chưa thực chất". Vì người dùng không rành thuật ngữ, mỗi con số hay khái niệm lạ phải đi kèm một câu giải thích bằng lời thường.
- Watch và Alert là tên nội bộ (code, spec, analytics). Trên giao diện và trong email chỉ dùng: **theo dõi giá** / **Đang theo dõi** (Watch), **thông báo giá** (Alert; không dùng "cảnh báo"), **giá mong muốn** (giá người dùng đặt; không dùng "giá mục tiêu"), **Giảm giá thật** (trang /radar; không dùng "Radar"), **Đến <sàn>** cho mọi nút ra sàn, **nơi bán** cho một listing (không dùng "offer"). Không viết tắt tiếng Anh như "7d", "90d".
- Trang sản phẩm và `/search` phải SSR và dùng được đầy đủ khi tắt JavaScript.
- Không bịa số: thiếu dữ liệu thì nói thiếu, không hiện `0đ`, `−0%`, không nội suy biểu đồ. Offer chưa khớp chắc chắn không được hiển thị như cùng sản phẩm. Dùng "giá được hệ thống ghi nhận", không tuyên bố là toàn bộ lịch sử giá.
- Giá sau voucher và giá ước tính phải phân biệt rõ với giá thực tế; không hứa người dùng chắc chắn nhận được voucher.

## Brand Commitments

- Tên: **DealScore**. Tagline: **"Đừng chỉ tìm giá rẻ. Tìm đúng thời điểm để mua."**
- **Cảm giác:** đáng tin, trung lập, dễ hiểu như lời khuyên của một người bạn am hiểu mua sắm.
- **Giọng điệu:** ngắn gọn, bình tĩnh, nói theo dữ liệu. Không hứa hẹn ("chắc chắn giá sẽ giảm"), không quy kết người bán ("lừa đảo"). Ví dụ đúng: "Mức giá hiện tại chưa thấp hơn đáng kể so với lịch sử quan sát."
- **Trung lập với mọi sàn:** không ưu ái sàn nào; thứ tự và khuyến nghị chỉ theo dữ liệu.
- **Minh bạch affiliate:** luôn có dòng disclosure cạnh nút mua ("Nếu bạn mua qua liên kết, chúng tôi có thể nhận hoa hồng. Điều này không làm thay đổi giá bạn trả."); sponsored/featured bắt buộc gắn nhãn.
- **Minh bạch độ tin cậy dữ liệu:** luôn cho biết dữ liệu cập nhật lúc nào và đủ hay chưa đủ để kết luận.

## Evidence on Hand

- Chưa có logo, ảnh thương hiệu, testimonial, số liệu người dùng, press hay case study. Không được bịa bất kỳ thứ nào trong số này.
- Dữ liệu seed dev (`scripts/seed-dev.ts`) chỉ để phát triển, không phải số liệu thật để quảng bá.
- Tài liệu sản phẩm: backlog `product_backlog_personal_shopping_intelligence.md` (ngoài repo), `docs/feature-checklist.md`, `docs/superpowers/specs/`.

## Product Principles

1. **Câu trả lời trong vài giây.** Mỗi trang quan trọng mở đầu bằng một kết luận rõ ràng bằng lời thường; biểu đồ và số chi tiết là phần để kiểm chứng, không phải để tự suy ra.
2. **Trung thực hơn tự tin.** Chưa đủ dữ liệu thì nói chưa đủ; không nội suy, không làm tròn cho đẹp, không hứa về giá tương lai.
3. **Trung lập với sàn và người bán.** Hoa hồng không bao giờ bẻ cong khuyến nghị hay thứ tự; nói về giá, không phán xét người bán.
4. **Giải thích khớp với phép tính.** Lý do và trọng số hiển thị phải đúng với cái engine thực sự đã dùng.
5. **Chạy được ở nơi người dùng đang đứng.** Tra nhanh từ điện thoại, mạng chậm, không có JS vẫn phải ra câu trả lời.

## Accessibility & Inclusion

- Người dùng 18–55 tuổi, đa số không rành công nghệ: chữ đủ lớn, nhãn rõ, tránh biệt ngữ tiếng Anh khi có từ tiếng Việt thông dụng.
- Màu không bao giờ là kênh thông tin duy nhất: mọi trạng thái khuyến nghị và cảnh báo đều có chữ đi kèm.
- Hỗ trợ giao diện sáng và tối theo `prefers-color-scheme`.

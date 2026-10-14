import { RADAR_MIN_DROP } from "@/lib/discovery";
import { TrendDownIcon, TrendUpIcon } from "@/components/ui/icons";

/** Heading copy of the discovery pages (/radar, /trending). */
export const RADAR_MIN_DROP_PCT = Math.round(RADAR_MIN_DROP * 100);

export const RADAR_HEADING = {
  eyebrow: (
    <>
      <TrendDownIcon className="size-3.5 text-buy" strokeWidth={2.4} />
      Radar giảm giá
    </>
  ),
  title: "Giảm giá thật hôm nay",
  lead: (
    <>
      Những sản phẩm đang rẻ hơn ít nhất <strong className="font-semibold text-ink">{RADAR_MIN_DROP_PCT}%</strong> so với giá
      trung vị 30 ngày mà DealScore ghi nhận. Chúng tôi so với giá đã bán thật, không so với giá niêm yết người bán tự đặt,
      nên “giảm 50%” trên giấy không lọt vào đây.
    </>
  ),
};

export const TRENDING_HEADING = {
  eyebrow: (
    <>
      <TrendUpIcon className="size-3.5 text-primary" strokeWidth={2.4} />
      Bảng xếp hạng
    </>
  ),
  title: "Xu hướng",
};

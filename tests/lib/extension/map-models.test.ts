import { describe, expect, it } from "vitest";
import { mapModelsToOffers } from "@/lib/extension/contribute";
import type { ObservationModel } from "@/lib/extension/payload";

const model = (o: Partial<ObservationModel>): ObservationModel => ({ modelId: null, name: "", price: 1_000, originalPrice: null, stock: null, ...o });
const offer = (id: string, externalModelId: string | null, variantKey: string | null = null) => ({ id, externalModelId, variantId: null, variantKey });

describe("mapModelsToOffers", () => {
  it("maps by Shopee model id first, then by variant key", () => {
    const offers = [offer("a", "111", "Đen"), offer("b", "222", "Trắng")];
    const r = mapModelsToOffers([model({ modelId: "222", name: "Đen" }), model({ name: "đen" })], offers);
    expect(r.map((m) => m.offerId)).toEqual(["b", "a"]);
  });

  it("a one-model page on a one-offer listing maps to that offer", () => {
    expect(mapModelsToOffers([model({ name: "Mặc định" })], [offer("d", "default")]).map((m) => m.offerId)).toEqual(["d"]);
  });

  it("several page models are never all filed under the single 'default' offer of an API listing", () => {
    const models = [model({ name: "128GB", price: 5_000_000 }), model({ name: "256GB", price: 6_500_000 }), model({ name: "512GB", price: 8_000_000 })];
    expect(mapModelsToOffers(models, [offer("d", "default")])).toEqual([]);
  });

  it("on a multi-model page only the model that matches the single offer is kept", () => {
    const models = [model({ name: "128GB", price: 5_000_000 }), model({ name: "256GB", price: 6_500_000 })];
    const r = mapModelsToOffers(models, [offer("d", "default", "256GB")]);
    expect(r).toEqual([{ model: models[1], offerId: "d" }]);
  });

  it("ambiguous names are dropped", () => {
    expect(mapModelsToOffers([model({ name: "Đen" })], [offer("a", "1", "Đen"), offer("b", "2", "Đen")])).toEqual([]);
  });
});

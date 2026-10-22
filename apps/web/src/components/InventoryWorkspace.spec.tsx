import { describe, expect, it } from "vitest";
import { summarizeInventoryEntries } from "./InventoryWorkspace";

describe("summarizeInventoryEntries", () => {
  it("groups balanced ledger rows by item, state, and location", () => {
    const result = summarizeInventoryEntries([
      { item_id: "sku-1", stock_state: "RELEASED", site_id: "site-1", location_id: "loc-1", uom_id: "uom-1", quantity_delta: -8 },
      { item_id: "sku-1", stock_state: "RELEASED", site_id: "site-1", location_id: "loc-1", uom_id: "uom-1", quantity_delta: 3 },
      { item_id: "sku-1", stock_state: "RESERVED", site_id: "site-1", location_id: "loc-1", uom_id: "uom-1", quantity_delta: 8 },
    ], {
      skus: [{ id: "sku-1", code: "ABC", name: "Widget" }],
      warehouses: [{ id: "site-1", name: "Bengaluru" }],
      locations: [{ id: "loc-1", name: "Main rack" }],
    });

    expect(result).toHaveLength(2);
    expect(result.find((entry) => entry.stock_state === "RELEASED")).toMatchObject({ quantity_delta: -5, entryCount: 2, skuLabel: "ABC · Widget" });
    expect(result.find((entry) => entry.stock_state === "RESERVED")).toMatchObject({ quantity_delta: 8, warehouseLabel: "Bengaluru", locationLabel: "Main rack" });
  });

  it("removes balanced groups that net to zero", () => {
    const result = summarizeInventoryEntries([
      { item_id: "sku-1", stock_state: "RELEASED", site_id: "site-1", location_id: "loc-1", uom_id: "uom-1", quantity_delta: -10 },
      { item_id: "sku-1", stock_state: "RELEASED", site_id: "site-1", location_id: "loc-1", uom_id: "uom-1", quantity_delta: 10 },
    ], {});

    expect(result).toEqual([]);
  });
});

import { describe, expect, it } from '@jest/globals';
import { normalizeDocument } from './document-extractor';

describe('normalizeDocument',()=>{
  it('normalizes an Amazon appointment',()=>{
    const result=normalizeDocument(`Amazon Vendor Central
Shipments > Appointments > 998424004985
Status : Confirmed
Appointment Time : 06/10/2026 09:30 PM IST
Carton Count : 729
Unit Count : 5827
POs : 4S2BJXYY
Destination FC : BLR4
Appointment Id : 998424004985`);
    expect(result).toMatchObject({platform:'AMAZON_RK',kind:'APPOINTMENT',appointmentId:'998424004985',fcCode:'BLR4',totalQuantity:5827,cartonCount:729});
    expect(result.linkedPoIds).toContain('4S2BJXYY');
  });

  it('normalizes an Amazon purchase order',()=>{
    const result=normalizeDocument(`PO: 4S2BJXYY
Status Confirmed
Vendor O17F2
Ship to location BLR4 - BENGALURU, KARNATAKA
Ordered On 09/09/2026
Purchasing entity RK WORLDINFOCOM PRIVATE LIMITED
PO items (1)
B0H8DSTSQT SKU: BABY-DIAPER-S
33073090
Delivery window 09/10/2026 143 0 143 0 143 329.27 INR`);
    expect(result).toMatchObject({platform:'AMAZON_RK',kind:'PURCHASE_ORDER',externalId:'4S2BJXYY',fcCode:'BLR4'});
    expect(result.lines[0]).toMatchObject({asin:'B0H8DSTSQT',ordered:143,approved:143});
  });

  it('normalizes a Flipkart consignment',()=>{
    const result=normalizeDocument(`FLIPKART INDIA PRIVATE LIMITED
Ship To Address
Name
ANJ_BTS_01
Purchase Order Details
PO Numbers
FLSSO8YIFZOI
Supplier Name
Novel Tissues Pvt Ltd
Delivery Date
2026-10-03
Consignment Quantity
5199
Consignment Products
8
Consignment Value
860542.98 INR
Product Details
WIPFJY2TYPBFPWFU
hsn 33073090
mrp 780
1190 INR`);
    expect(result).toMatchObject({platform:'FLIPKART',kind:'CONSIGNMENT',externalId:'FLSSO8YIFZOI',totalQuantity:5199,totalValue:860542.98});
  });

  it('normalizes a Blinkit recommended order',()=>{
    const result=normalizeDocument(`Recommended Quantity Order (R.O.)
Issued by Blinkit Seller Hub
BLINK COMMERCE PRIVATE LIMITED
R.O. Number : 49990010116382
Date : Sept. 30, 2026, 12:25 p.m.
Currency : INR
Delivered To : BLINK COMMERCE PRIVATE LIMITED Bengaluru B5 Feeder Warehouse
Total Quantity: 1502
Net amount 144798.00`);
    expect(result).toMatchObject({platform:'BLINKIT',kind:'PURCHASE_ORDER',externalId:'49990010116382',currency:'INR',totalQuantity:1502,totalValue:144798});
  });

  it('returns review warnings for an unknown document',()=>{
    const result=normalizeDocument('unstructured scan without usable fields');
    expect(result.confidence).toBe(0);
    expect(result.warnings.length).toBeGreaterThanOrEqual(3);
  });
});

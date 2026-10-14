import { describe, expect, it } from '@jest/globals';
import { mergeDocumentFallback, normalizeDocument } from './document-extractor';

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

  it('uses the PO printed in an appointment letter when AI misses it',()=>{
    const fallback=normalizeDocument(`Amazon Vendor Central
Shipments > Appointments > 1000955004985
POs : 5VDQRWJX
Destination FC : BLR4
Appointment Id : 1000955004985`);
    const ai={...fallback,linkedPoIds:[]};
    expect(mergeDocumentFallback(ai,fallback).linkedPoIds).toEqual(['5VDQRWJX']);
    expect(mergeDocumentFallback({...ai,linkedPoIds:['4S2BJXYY']},fallback).linkedPoIds).toEqual(['5VDQRWJX']);
  });

  it('normalizes common appointment number labels',()=>{
    const result=normalizeDocument(`Amazon Vendor Central
Appointment Number: APT-4455
Appointment Date and Time: 2026-10-07T09:30:00+05:30
Facility: BLR4
PO Number: 4S2BJXYY`);
    expect(result.kind).toBe('APPOINTMENT');
    expect(result.appointmentId).toBe('APT-4455');
    expect(result.appointmentAt).toContain('2026-10-07T09:30:00');
    expect(result.destination).toBe('BLR4');
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

  it('fills missing AI quantities from the PDF table parser',()=>{
    const fallback=normalizeDocument(`PO: 4S2BJXYY
Status Confirmed
Ship to location BLR4 - BENGALURU, KARNATAKA
PO items (1)
B0H8DSTSQT SKU: BABY-DIAPER-S
33073090
Delivery window 09/10/2026 143 0 143 0 143 329.27 INR`);
    const ai={...fallback, lines:[{...fallback.lines[0], ordered:null, approved:null}]} as any;
    const merged=mergeDocumentFallback(ai,fallback);
    expect(merged.lines[0]).toMatchObject({asin:'B0H8DSTSQT',ordered:143,approved:143});
  });

  it('keeps separate PO lines for the same ASIN',()=>{
    const result=normalizeDocument('PO: 4S2BJXYY\nShip to location BLR4\nB0H8DSTSQT SKU: PACK-S\nDelivery window 09/10/2026 75 0 75 0 75 329.27 INR\nB0H8DSTSQT SKU: PACK-S\nDelivery window 09/11/2026 25 0 25 0 25 329.27 INR');
    expect(result.lines.map(line=>line.ordered)).toEqual([75,25]);
    const merged=mergeDocumentFallback({...result,lines:result.lines.map(line=>({...line,ordered:undefined,approved:undefined}))},result);
    expect(merged.lines.map(line=>line.ordered)).toEqual([75,25]);
  });

  it('parses Amazon PDF rows when delivery labels and quantities wrap across lines',()=>{
    const result=normalizeDocument('PO: 4S2BJXYY\nShip to location BLR4 - BENGALURU, KARNATAKA\nPO items (2)\nB0H8DSTSQT SKU: Baby Diaper (S) 78 Pants\nNovel Baby Diaper Pants\nDelivery\nwindow\n(Prepaid)\n09/10/2026 143 0 143 0 143 329.27 INR 47085.61 INR\nB0H8DQV1RZ EAN: 8906006352599\nBaby Diaper (L) 62 Pants\nDelivery\nwindow\n(Prepaid)\n09/10/2026 23 0 23 0 23 329.27 INR 7573.21 INR');
    expect(result.lines).toHaveLength(2);
    expect(result.lines.map(line=>line.ordered)).toEqual([143,23]);
    expect(result.lines.map(line=>line.approved)).toEqual([143,23]);
    expect(result.lines[0].unitPrice).toBe(329.27);
  });

  it('stops address extraction before PO items or appointment footer',()=>{
    const po=normalizeDocument('Amazon PO: 4S2BJXYY\nDelivery Address: BLR4 RK WORLDINFOCOM BENGALURU 562149 India PO items (1) B0H8DSTSQT');
    expect(po.destinationAddress).toBe('BLR4 RK WORLDINFOCOM BENGALURU 562149 India');
    const appointment=normalizeDocument('Amazon Appointment Id: 998424004985\nPOs: 4S2BJXYY\nDestination: BLR4 ASN : Appointment Id: 998424004985 © All Rights Reserved');
    expect(appointment.destination).toBe('BLR4');
  });

  it('stops customer extraction before PO summary totals',()=>{
    const po=normalizeDocument('Amazon PO: 4S2BJXYY\nPurchasing entity RK WORLDINFOCOM PRIVATE LIMITED Items Quantity Submitted Total cost Submitted 25 10,960 1617043.28 INR');
    expect(po.customer).toBe('RK WORLDINFOCOM PRIVATE LIMITED');
  });

  it('removes PDF table and footer contamination from AI fields',()=>{
    const fallback=normalizeDocument('Amazon PO: 4S2BJXYY\nDelivery Address: BLR4 RK WORLDINFOCOM BENGALURU 562149 India\nPurchasing entity RK WORLDINFOCOM PRIVATE LIMITED');
    const ai={...fallback,destinationAddress:'BLR4 RK WORLDINFOCOM BENGALURU 562149 India PO items (25) ASIN External Id',customer:'RK WORLDINFOCOM PRIVATE LIMITED Items Quantity Submitted Total cost'};
    const merged=mergeDocumentFallback(ai,fallback);
    expect(merged.destinationAddress).toBe('BLR4 RK WORLDINFOCOM BENGALURU 562149 India');
    expect(merged.customer).toBe('RK WORLDINFOCOM PRIVATE LIMITED');
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

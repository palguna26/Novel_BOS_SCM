import { useEffect, useState } from 'react';
import { AlertTriangle, UploadCloud, XCircle } from 'lucide-react';
import { DOCUMENT_ACCEPT, DOCUMENT_FORMATS, prepareDocumentUpload, validateDocumentFile } from '../lib/document-upload';
import { Button } from './ui/button';
import { Card, CardContent, CardHeader } from './ui/card';
import { Input } from './ui/input';
import { Label } from './ui/label';

type Mode = 'appointment' | 'consignment' | 'pod' | 'invoice';
type Props = { apiBase: string; mode: Mode; po: any; onClose: () => void; onSaved: () => void };

function toDateTimeLocal(input: string | null | undefined) {
  if (!input) return '';
  const date = new Date(input);
  return Number.isNaN(date.getTime()) ? String(input).slice(0, 16) : new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

export function DocumentWorkflowModal({ apiBase, mode, po, onClose, onSaved }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [document, setDocument] = useState<any>(null);
  const [masters, setMasters] = useState<any>({ warehouses: [], locations: [] });
  const [busy, setBusy] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [error, setError] = useState('');
  const [fields, setFields] = useState<any>({ appointmentId: '', appointmentAt: '', sourceWarehouseId: po.source_site_id || po.warehouse?.id || '', sourceLocationId: po.source_location_id || '', location: po.destination || '', facilityName: '', fcCode: '', reportingAt: '', unloadingSlot: '', cartonCount: '', unitCount: '', carrier: '', proNumber: '', consignmentNumber: '', consignmentDeliveryAt: '', receiver: '', deliveryAt: new Date().toISOString().slice(0, 16), number: '', invoiceDate: new Date().toISOString().slice(0, 10), amount: po.totalValue || 0 });
  const title = mode === 'appointment' ? 'Attach appointment' : mode === 'consignment' ? 'Attach consignment' : mode === 'pod' ? 'Confirm proof of delivery' : 'Upload invoice';
  const outstandingLines = (po.shipments || []).flatMap((shipment: any) => (shipment.lines || []).filter((line: any) => Number(line.dispatched_quantity) > Number(line.delivered_quantity || 0)).map((line: any) => ({ shipmentLineId: line.id, outstanding: Number(line.dispatched_quantity) - Number(line.delivered_quantity || 0) })));
  const [podLines, setPodLines] = useState<Record<string, any>>(() => Object.fromEntries(outstandingLines.map((line: any) => [line.shipmentLineId, { confirmed: 0, short: 0, damaged: 0, rejected: 0 }])));

  useEffect(() => {
    if (mode !== 'appointment') return;
    fetch(`${apiBase}/api/masters`, { headers: { Authorization: `Bearer ${localStorage.getItem('scm_token')}` } })
      .then(response => response.json()).then(value => setMasters(value || {})).catch(() => undefined);
  }, [apiBase, mode]);

  const chooseFile = async (selected: File | null, input: HTMLInputElement) => {
    if (!selected) { setFile(null); setDocument(null); return; }
    try {
      validateDocumentFile(selected); setFile(selected); setDocument(null); setError(''); setExtracting(true);
      const token = localStorage.getItem('scm_token');
      const { form, warning } = await prepareDocumentUpload(selected);
      const response = await fetch(`${apiBase}/api/documents/preview`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.message || 'Document extraction failed');
      setDocument(result);
      const extracted = result.extracted || {};
      if (mode === 'appointment') setFields((current: any) => ({ ...current, appointmentId: extracted.appointmentId || current.appointmentId, appointmentAt: toDateTimeLocal(extracted.appointmentAt) || current.appointmentAt, location: extracted.destination || current.location, facilityName: extracted.facilityName || current.facilityName, fcCode: extracted.fcCode || current.fcCode, cartonCount: extracted.cartonCount ?? current.cartonCount, unitCount: extracted.totalQuantity ?? current.unitCount, sourceWarehouseId: current.sourceWarehouseId || (masters.warehouses || []).find((warehouse: any) => String(warehouse.city || '').toLowerCase() === String(extracted.sourceCity || '').toLowerCase())?.id || '' }));
      if (mode === 'consignment') setFields((current: any) => ({ ...current, consignmentNumber: extracted.consignmentId || current.consignmentNumber, location: extracted.destination || current.location, consignmentDeliveryAt: toDateTimeLocal(extracted.deliveryAt) || current.consignmentDeliveryAt }));
      const warnings = [warning, ...(result.warnings || [])].filter(Boolean);
      if (warnings.length) setError(warnings.join(' '));
    } catch (cause: any) { setFile(null); setDocument(null); setError(cause?.name === 'TypeError' ? 'API is unavailable. Start the SCM API service on port 4000.' : cause.message || 'Document extraction failed'); input.value = ''; }
    finally { setExtracting(false); }
  };

  const submit = async () => {
    if (!file) return setError(`Choose a ${DOCUMENT_FORMATS} file first.`);
    if (!document) return setError('The document could not be extracted. Check the API connection or complete the fields manually.');
    setBusy(true); setError('');
    try {
      const token = localStorage.getItem('scm_token');
      const { form } = await prepareDocumentUpload(file);
      const upload = await fetch(`${apiBase}/api/documents/extract`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Idempotency-Key': crypto.randomUUID() }, body: form });
      const savedDocument = await upload.json().catch(() => ({}));
      if (!upload.ok) throw new Error(savedDocument.message || 'Document upload failed');
      const endpoint = mode === 'appointment' ? `/api/pos/${po.id}/appointment` : mode === 'consignment' ? `/api/pos/${po.id}/consignments` : mode === 'pod' ? `/api/pos/${po.id}/pods` : `/api/pos/${po.id}/invoice`;
      const shipmentLines = outstandingLines.map((line: any) => ({ shipmentLineId: line.shipmentLineId, ...(podLines[line.shipmentLineId] || {}) }));
      const extracted = savedDocument.extracted || document.extracted || {};
      const appointmentMatchDetails = { sourceAddress: extracted.sourceAddress || null, destinationAddress: extracted.destinationAddress || extracted.destination || fields.location || null, sourceCity: extracted.sourceCity || null, destinationCity: extracted.destinationCity || null, sourceState: extracted.sourceState || null, destinationState: extracted.destinationState || null, sourcePostalCode: extracted.sourcePostalCode || null, destinationPostalCode: extracted.destinationPostalCode || null, facilityName: fields.facilityName || extracted.facilityName || null, fcCode: fields.fcCode || extracted.fcCode || null, extractionConfidence: savedDocument.confidence ?? extracted.confidence ?? null, reportingAt: fields.reportingAt ? new Date(fields.reportingAt).toISOString() : null, unloadingSlot: fields.unloadingSlot || null, cartonCount: fields.cartonCount === '' ? null : Number(fields.cartonCount), unitCount: fields.unitCount === '' ? null : Number(fields.unitCount), carrier: fields.carrier || null, proNumber: fields.proNumber || null, sourceWarehouseId: fields.sourceWarehouseId || null, sourceLocationId: fields.sourceLocationId || null };
      const payload = mode === 'appointment' ? { documentVersionId: savedDocument.documentVersionId, appointmentId: fields.appointmentId || extracted.appointmentId, appointmentAt: fields.appointmentAt ? new Date(fields.appointmentAt).toISOString() : extracted.appointmentAt, location: fields.location || extracted.destinationAddress || extracted.destination, matchStatus: 'MATCHED', matchDetails: appointmentMatchDetails } : mode === 'consignment' ? { documentVersionId: savedDocument.documentVersionId, consignmentNumber: fields.consignmentNumber || extracted.consignmentId, deliveryAt: fields.consignmentDeliveryAt ? new Date(fields.consignmentDeliveryAt).toISOString() : null, destinationName: fields.location || extracted.destination || extracted.destinationAddress, totalQuantity: extracted.totalQuantity, totalValue: extracted.totalValue, currency: extracted.currency || 'INR', extracted } : mode === 'pod' ? { documentVersionId: savedDocument.documentVersionId, receiver: fields.receiver, deliveryAt: fields.deliveryAt, lines: shipmentLines } : { documentVersionId: savedDocument.documentVersionId, number: fields.number || extracted.externalId, invoiceDate: fields.invoiceDate, amount: Number(fields.amount), currency: 'INR', recipients: [] };
      const response = await fetch(`${apiBase}${endpoint}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'Idempotency-Key': crypto.randomUUID() }, body: JSON.stringify(payload) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.message || `${title} failed`);
      onSaved(); onClose();
    } catch (cause: any) { setError(cause?.name === 'TypeError' ? 'API is unavailable. Start the SCM API service on port 4000.' : cause.message || `${title} failed`); }
    finally { setBusy(false); }
  };

  const locations = (masters.locations || []).filter((location: any) => location.site_id === fields.sourceWarehouseId && location.active !== false && location.virtual !== true);
  return <div className="fixed inset-0 z-40 flex items-center justify-center overflow-y-auto bg-black/40 p-6"><Card className="w-full max-w-2xl"><CardHeader><div className="flex items-center justify-between"><div><div className="text-xs font-semibold uppercase tracking-widest text-emerald-600">{po.externalId}</div><h2 className="mt-1 text-xl font-semibold">{title}</h2></div><button onClick={onClose}><XCircle /></button></div></CardHeader><CardContent>
    <label className="flex min-h-36 cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed border-slate-200 bg-slate-50"><UploadCloud className="text-emerald-600" /><span className="mt-2 text-sm font-semibold">{file?.name || `Choose ${DOCUMENT_FORMATS}`}</span><span className="mt-1 text-xs text-slate-400">10 MB maximum</span><input className="hidden" type="file" accept={DOCUMENT_ACCEPT} onChange={event => chooseFile(event.target.files?.[0] || null, event.target)} /></label>
    {extracting && <div className="mt-4 text-sm text-slate-500">Reading document…</div>}{document?.extracted && <div className="mt-4 rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800">Document extracted ({Math.round(Number(document.extracted.confidence || 0) * 100)}% confidence). Review the fields before saving.</div>}
    {mode === 'appointment' && <div className="mt-5 grid gap-4 sm:grid-cols-2"><Label>Appointment ID<Input className="mt-2" value={fields.appointmentId} onChange={e => setFields({ ...fields, appointmentId: e.target.value })} /></Label><Label>Reporting / appointment time<Input type="datetime-local" className="mt-2" value={fields.appointmentAt} onChange={e => setFields({ ...fields, appointmentAt: e.target.value })} /></Label><Label>Source warehouse<select className="mt-2 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={fields.sourceWarehouseId || ''} onChange={e => setFields({ ...fields, sourceWarehouseId: e.target.value, sourceLocationId: '' })}><option value="">Use PO warehouse</option>{(masters.warehouses || []).filter((warehouse: any) => warehouse.active !== false).map((warehouse: any) => <option key={warehouse.id} value={warehouse.id}>{warehouse.code} · {warehouse.name} · {warehouse.city}</option>)}</select></Label><Label>Stock location<select className="mt-2 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={fields.sourceLocationId || ''} onChange={e => setFields({ ...fields, sourceLocationId: e.target.value })} disabled={!fields.sourceWarehouseId}><option value="">Auto-select warehouse stock location</option>{locations.map((location: any) => <option key={location.id} value={location.id}>{location.code} · {location.name}</option>)}</select></Label><Label>Location<Input className="mt-2" value={fields.location} onChange={e => setFields({ ...fields, location: e.target.value })} /></Label><Label>Facility name<Input className="mt-2" value={fields.facilityName} onChange={e => setFields({ ...fields, facilityName: e.target.value })} /></Label><Label>FC code<Input className="mt-2" value={fields.fcCode} onChange={e => setFields({ ...fields, fcCode: e.target.value })} /></Label><Label>Reporting time, if different<Input type="datetime-local" className="mt-2" value={fields.reportingAt} onChange={e => setFields({ ...fields, reportingAt: e.target.value })} /></Label><Label>Unloading slot<Input className="mt-2" placeholder="08:00 AM - 10:00 AM" value={fields.unloadingSlot} onChange={e => setFields({ ...fields, unloadingSlot: e.target.value })} /></Label><Label>Carton count<Input type="number" min="0" className="mt-2" value={fields.cartonCount} onChange={e => setFields({ ...fields, cartonCount: e.target.value })} /></Label><Label>Unit count<Input type="number" min="0" className="mt-2" value={fields.unitCount} onChange={e => setFields({ ...fields, unitCount: e.target.value })} /></Label><Label>Carrier<Input className="mt-2" value={fields.carrier} onChange={e => setFields({ ...fields, carrier: e.target.value })} /></Label><Label>PRO / LR number<Input className="mt-2" value={fields.proNumber} onChange={e => setFields({ ...fields, proNumber: e.target.value })} /></Label></div>}
    {mode === 'consignment' && <div className="mt-5 grid gap-4 sm:grid-cols-2"><Label>Consignment number<Input className="mt-2" value={fields.consignmentNumber} onChange={e => setFields({ ...fields, consignmentNumber: e.target.value })} /></Label><Label>Delivery date<Input type="datetime-local" className="mt-2" value={fields.consignmentDeliveryAt} onChange={e => setFields({ ...fields, consignmentDeliveryAt: e.target.value })} /></Label><Label className="sm:col-span-2">Destination<Input className="mt-2" value={fields.location} onChange={e => setFields({ ...fields, location: e.target.value })} /></Label></div>}
    {mode === 'pod' && <div className="mt-5 space-y-4"><div className="grid gap-4 sm:grid-cols-2"><Label>Receiver<Input className="mt-2" value={fields.receiver} onChange={e => setFields({ ...fields, receiver: e.target.value })} /></Label><Label>Delivery time<Input type="datetime-local" className="mt-2" value={fields.deliveryAt} onChange={e => setFields({ ...fields, deliveryAt: e.target.value })} /></Label></div><div className="rounded-xl border border-slate-100 p-4"><div className="mb-3 text-sm font-semibold">Delivered quantities</div>{outstandingLines.length === 0 && <div className="text-sm text-slate-500">No outstanding shipment lines found.</div>}{outstandingLines.map((line: any) => <div key={line.shipmentLineId} className="mb-4 last:mb-0"><div className="mb-2 text-xs text-slate-500">Outstanding: {line.outstanding}</div><div className="grid grid-cols-4 gap-2">{(['confirmed', 'short', 'damaged', 'rejected'] as const).map(key => <Label key={key}>{key[0].toUpperCase() + key.slice(1)}<Input type="number" min="0" value={podLines[line.shipmentLineId]?.[key] || 0} onChange={e => setPodLines({ ...podLines, [line.shipmentLineId]: { ...podLines[line.shipmentLineId], [key]: Number(e.target.value) } })} /></Label>)}</div></div>)}</div></div>}
    {mode === 'invoice' && <div className="mt-5 grid gap-4 sm:grid-cols-2"><Label>Invoice number<Input className="mt-2" value={fields.number} onChange={e => setFields({ ...fields, number: e.target.value })} /></Label><Label>Invoice date<Input type="date" className="mt-2" value={fields.invoiceDate} onChange={e => setFields({ ...fields, invoiceDate: e.target.value })} /></Label><Label>Amount<Input type="number" className="mt-2" value={fields.amount} onChange={e => setFields({ ...fields, amount: e.target.value })} /></Label></div>}
    {error && <div className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-700"><AlertTriangle className="mr-2 inline" size={16} />{error}</div>}<Button disabled={busy || extracting} onClick={submit} className="mt-6 w-full bg-ink text-white">{busy ? 'Saving…' : title}</Button>
  </CardContent></Card></div>;
}

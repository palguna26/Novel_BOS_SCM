import { useState } from 'react';
import { Plus, Trash2, XCircle } from 'lucide-react';
import { DocumentLink } from './DocumentLink';

type Props = {
  po: any;
  masters: any;
  onClose: () => void;
  onAction: (path: string, body: any, onError?: (message: string) => void) => Promise<boolean>;
  onSaved: () => void;
};

const input = 'mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm';
const toLocalDateTime = (value: string | null) => {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};
const lineFields = (line: any) => ({
  skuId: line.skuId || line.item_id || '',
  ordered: Number(line.ordered ?? line.ordered_quantity ?? 0),
  unitPrice: Number(line.unitPrice ?? line.unit_price ?? 0),
  taxRate: Number(line.taxRate ?? line.tax_rate ?? 0),
  channelItemCode: line.channelItemCode ?? line.channel_item_code ?? '',
  description: line.description || '',
  uomId: line.uomId ?? line.uom_id ?? '',
  deliveryWindowStart: line.deliveryWindowStart ?? line.delivery_window_start ?? '',
  deliveryWindowEnd: line.deliveryWindowEnd ?? line.delivery_window_end ?? '',
  minimumResidualShelfLifeDays: Number(line.minimumResidualShelfLifeDays ?? line.minimum_residual_shelf_life_days ?? 0),
});

export function EditPoModal({ po, masters, onClose, onAction, onSaved }: Props) {
  const originalLines = (po.lines || []).map(lineFields);
  const [lines, setLines] = useState<any[]>(originalLines);
  const [form, setForm] = useState<any>({
    platformId: po.channel_id || po.platform?.id || '',
    externalId: po.externalId || '',
    poDate: po.poDate ? String(po.poDate).slice(0, 10) : '',
    deadline: toLocalDateTime(po.deadline),
    customer: po.customer || '',
    totalValue: Number(po.totalValue || 0),
    currency: po.currency || 'INR',
    sourceWarehouseId: po.source_site_id || '',
    sourceLocationId: po.source_location_id || '',
    sourceAddress: po.sourceAddress || '',
    sourceCity: po.source_city || '',
    sourceState: po.source_state || '',
    sourcePostalCode: po.source_postal_code || '',
    destination: po.destination_key || po.destinationCity || po.destination || '',
    destinationName: po.destination || '',
    destinationAddress: po.destination_address || '',
    destinationCity: po.destination_city || '',
    destinationState: po.destinationState || '',
    destinationPostalCode: po.destinationPostalCode || '',
    reason: '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const update = (name: string, value: any) => setForm((current: any) => ({ ...current, [name]: value }));
  const updateLine = (index: number, name: string, value: any) => setLines(current => current.map((line, i) => i === index ? { ...line, [name]: value } : line));
  const plannedShipments = (po.shipments || []).filter((shipment: any) => ['PLANNED', 'VEHICLE_ASSIGNED', 'LOADING'].includes(shipment.status));
  const linesChanged = JSON.stringify(lines) !== JSON.stringify(originalLines);
  const routeChanged = form.sourceWarehouseId !== (po.source_site_id || '')
    || form.sourceLocationId !== (po.source_location_id || '')
    || form.sourceAddress !== (po.sourceAddress || '')
    || form.sourceCity !== (po.source_city || '')
    || form.sourceState !== (po.source_state || '')
    || form.sourcePostalCode !== (po.source_postal_code || '')
    || form.platformId !== (po.channel_id || po.platform?.id || '')
    || form.destination !== (po.destination_key || po.destinationCity || po.destination || '')
    || form.destinationName !== (po.destination_name || '')
    || form.destinationAddress !== (po.destination_address || '')
    || form.destinationCity !== (po.destination_city || '')
    || form.destinationState !== (po.destination_state || '')
    || form.destinationPostalCode !== (po.destination_postal_code || '');

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    if (!form.platformId || !form.externalId.trim() || !form.poDate || !form.destination.trim()) {
      setError('Platform, PO ID, date and destination are required.'); return;
    }
    if (!lines.length || lines.some(line => !line.skuId || Number(line.ordered) <= 0 || Number(line.unitPrice) < 0)) {
      setError('Add at least one SKU with a positive quantity and valid price.'); return;
    }
    setBusy(true);
    const payload = {
      ...form,
      deadline: form.deadline ? new Date(form.deadline).toISOString() : '',
      expectedUpdatedAt: po.updated_at,
      ...(linesChanged ? { lines: lines.map(line => ({
        ...line,
        deliveryWindowStart: line.deliveryWindowStart ? new Date(line.deliveryWindowStart).toISOString() : null,
        deliveryWindowEnd: line.deliveryWindowEnd ? new Date(line.deliveryWindowEnd).toISOString() : null,
      })) } : {}),
    };
    const saved = await onAction(`/api/pos/${po.id}/update`, payload, setError);
    setBusy(false);
    if (saved) onSaved();
  };

  return <div className="fixed inset-0 z-30 overflow-y-auto bg-black/40 p-3 sm:p-6" role="dialog" aria-modal="true" aria-label={`Edit PO ${po.externalId}`}>
    <form onSubmit={save} className="mx-auto max-w-5xl rounded-2xl bg-white p-5 shadow-xl sm:p-7">
      <div className="flex items-start justify-between gap-4"><div><h2 className="text-xl font-semibold">Edit purchase order</h2><p className="mt-1 text-sm text-slate-500">Correct the saved PO. The original document stays attached and changes are audited.</p></div><button type="button" onClick={onClose} aria-label="Close edit PO"><XCircle size={22} /></button></div>
      {plannedShipments.length > 0 && <div className="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">Changing SKU lines, source, or route will cancel {plannedShipments.length} planned shipment{plannedShipments.length === 1 ? '' : 's'}. Recreate the shipment plan after saving.</div>}
      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <label className="text-sm">Platform<select className={input} required value={form.platformId} onChange={e => update('platformId', e.target.value)}><option value="">Select platform</option>{(masters.platforms || []).map((x: any) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
        <label className="text-sm">PO ID<input className={input} required value={form.externalId} onChange={e => update('externalId', e.target.value)} /></label>
        <label className="text-sm">PO date<input className={input} type="date" required value={form.poDate} onChange={e => update('poDate', e.target.value)} /></label>
        <label className="text-sm">Booking deadline<input className={input} type="datetime-local" value={form.deadline} onChange={e => update('deadline', e.target.value)} /></label>
        <label className="text-sm">Customer / vendor<input className={input} value={form.customer} onChange={e => update('customer', e.target.value)} /></label>
        <label className="text-sm">Total PO value<input className={input} type="number" min="0" step="0.01" value={form.totalValue} onChange={e => update('totalValue', e.target.value)} /></label>
        <label className="text-sm">Currency<input className={input} maxLength={3} value={form.currency} onChange={e => update('currency', e.target.value.toUpperCase())} /></label>
      </div>
      <h3 className="mt-7 font-semibold">Source</h3>
      <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <label className="text-sm">Warehouse<select className={input} value={form.sourceWarehouseId} onChange={e => { const warehouse = (masters.warehouses || []).find((x: any) => x.id === e.target.value); setForm((current: any) => ({ ...current, sourceWarehouseId: e.target.value, sourceLocationId: '', sourceCity: warehouse?.city || current.sourceCity, sourceState: warehouse?.state || current.sourceState })); }}><option value="">Select warehouse</option>{(masters.warehouses || []).map((x: any) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
        <label className="text-sm">Stock location<select className={input} disabled={!form.sourceWarehouseId} value={form.sourceLocationId} onChange={e => update('sourceLocationId', e.target.value)}><option value="">Auto-select stock location</option>{(masters.locations || []).filter((x: any) => x.site_id === form.sourceWarehouseId && x.active !== false && !x.virtual).map((x: any) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
        <label className="text-sm">Source address<input className={input} value={form.sourceAddress} onChange={e => update('sourceAddress', e.target.value)} /></label>
        <label className="text-sm">Source city<input className={input} value={form.sourceCity} onChange={e => update('sourceCity', e.target.value)} /></label>
        <label className="text-sm">Source state<input className={input} value={form.sourceState} onChange={e => update('sourceState', e.target.value)} /></label>
        <label className="text-sm">Source postal code<input className={input} value={form.sourcePostalCode} onChange={e => update('sourcePostalCode', e.target.value)} /></label>
      </div>
      <h3 className="mt-7 font-semibold">Destination</h3>
      <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <label className="text-sm">Destination key<input className={input} required value={form.destination} onChange={e => update('destination', e.target.value)} /></label>
        <label className="text-sm">Destination name<input className={input} value={form.destinationName} onChange={e => update('destinationName', e.target.value)} /></label>
        <label className="text-sm">Destination address<input className={input} value={form.destinationAddress} onChange={e => update('destinationAddress', e.target.value)} /></label>
        <label className="text-sm">Destination city<input className={input} value={form.destinationCity} onChange={e => update('destinationCity', e.target.value)} /></label>
        <label className="text-sm">Destination state<input className={input} value={form.destinationState} onChange={e => update('destinationState', e.target.value)} /></label>
        <label className="text-sm">Destination postal code<input className={input} value={form.destinationPostalCode} onChange={e => update('destinationPostalCode', e.target.value)} /></label>
      </div>
      <div className="mt-7 flex items-center justify-between"><h3 className="font-semibold">SKU lines</h3><button type="button" onClick={() => setLines(current => [...current, lineFields({})])} className="inline-flex items-center gap-1 text-sm font-semibold text-emerald-700"><Plus size={16} />Add SKU</button></div>
      <div className="mt-3 space-y-3">{lines.map((line, index) => <div key={index} className="grid gap-3 rounded-xl bg-slate-50 p-3 sm:grid-cols-[minmax(0,2fr)_repeat(3,minmax(0,1fr))_36px]">
        <label className="text-xs">SKU<select className={input} value={line.skuId} onChange={e => updateLine(index, 'skuId', e.target.value)}><option value="">Select SKU</option>{(masters.skus || []).map((x: any) => <option key={x.id} value={x.id}>{x.code} · {x.name}</option>)}</select></label>
        <label className="text-xs">Quantity<input className={input} type="number" min="0.000001" step="any" value={line.ordered} onChange={e => updateLine(index, 'ordered', e.target.value)} /></label>
        <label className="text-xs">Unit price<input className={input} type="number" min="0" step="any" value={line.unitPrice} onChange={e => updateLine(index, 'unitPrice', e.target.value)} /></label>
        <label className="text-xs">Tax %<input className={input} type="number" min="0" max="100" step="any" value={line.taxRate} onChange={e => updateLine(index, 'taxRate', e.target.value)} /></label>
        <button type="button" aria-label={`Remove line ${index + 1}`} onClick={() => setLines(current => current.filter((_, i) => i !== index))} className="self-end rounded-lg p-2 text-red-600"><Trash2 size={17} /></button>
        <label className="text-xs sm:col-span-2">Platform item code<input className={input} value={line.channelItemCode} onChange={e => updateLine(index, 'channelItemCode', e.target.value)} /></label>
        <label className="text-xs sm:col-span-2">Description<input className={input} value={line.description} onChange={e => updateLine(index, 'description', e.target.value)} /></label>
        <label className="text-xs">Unit<select className={input} value={line.uomId} onChange={e => updateLine(index, 'uomId', e.target.value)}><option value="">SKU default</option>{(masters.uoms || []).map((unit: any) => <option key={unit.id} value={unit.id}>{unit.code || unit.name}</option>)}</select></label>
        <label className="text-xs">Delivery window start<input className={input} type="datetime-local" value={line.deliveryWindowStart ? toLocalDateTime(line.deliveryWindowStart) : ''} onChange={e => updateLine(index, 'deliveryWindowStart', e.target.value)} /></label>
        <label className="text-xs">Delivery window end<input className={input} type="datetime-local" value={line.deliveryWindowEnd ? toLocalDateTime(line.deliveryWindowEnd) : ''} onChange={e => updateLine(index, 'deliveryWindowEnd', e.target.value)} /></label>
        <label className="text-xs">Minimum shelf life (days)<input className={input} type="number" min="0" value={line.minimumResidualShelfLifeDays} onChange={e => updateLine(index, 'minimumResidualShelfLifeDays', e.target.value)} /></label>
      </div>)}</div>
      {po.document?.id && <div className="mt-6 text-sm"><span className="mr-3 text-slate-500">Original PO file</span><DocumentLink documentVersionId={po.document.id} filename={po.document.filename} /></div>}
      <label className="mt-6 block text-sm">Reason for correction<input className={input} value={form.reason} onChange={e => update('reason', e.target.value)} placeholder="Optional note for the audit log" /></label>
      {plannedShipments.length > 0 && (linesChanged || routeChanged) && <p className="mt-4 text-sm font-medium text-amber-700">Saving these changes will cancel the planned shipments listed above.</p>}
      {routeChanged && po.appointment && <p className="mt-2 text-sm font-medium text-amber-700">Changing the route or platform will require a new appointment letter. Reserved stock will be released until the appointment is updated.</p>}
      {error && <div role="alert" className="mt-5 rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</div>}
      <div className="mt-6 flex justify-end gap-3"><button type="button" onClick={onClose} className="rounded-lg border px-4 py-2 text-sm font-semibold">Cancel</button><button disabled={busy} className="rounded-lg bg-ink px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy ? 'Saving…' : 'Save PO changes'}</button></div>
    </form>
  </div>;
}

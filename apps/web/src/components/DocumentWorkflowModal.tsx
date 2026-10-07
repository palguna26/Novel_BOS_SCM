import { useState } from 'react';
import { AlertTriangle, UploadCloud, XCircle } from 'lucide-react';
import { DOCUMENT_ACCEPT, DOCUMENT_FORMATS, prepareDocumentUpload, validateDocumentFile } from '../lib/document-upload';
import { Button } from './ui/button';
import { Card, CardContent, CardHeader } from './ui/card';
import { Input } from './ui/input';
import { Label } from './ui/label';

type Mode = 'appointment' | 'pod' | 'invoice';
type Props = { apiBase: string; mode: Mode; po: any; onClose: () => void; onSaved: () => void };

export function DocumentWorkflowModal({ apiBase, mode, po, onClose, onSaved }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [fields, setFields] = useState<any>({
    appointmentId: '', appointmentAt: '', location: po.destination || '',
    receiver: '', deliveryAt: new Date().toISOString().slice(0, 16),
    number: '', invoiceDate: new Date().toISOString().slice(0, 10), amount: po.totalValue || 0,
  });
  const title = mode === 'appointment' ? 'Attach appointment' : mode === 'pod' ? 'Confirm proof of delivery' : 'Upload invoice';
  const outstandingLines = (po.shipments || []).flatMap((shipment: any) => (shipment.lines || []).filter((line: any) => Number(line.dispatched_quantity) > Number(line.delivered_quantity || 0)).map((line: any) => ({ shipmentLineId: line.id, outstanding: Number(line.dispatched_quantity) - Number(line.delivered_quantity || 0) })));
  const [podLines, setPodLines] = useState<Record<string, any>>(() => Object.fromEntries(outstandingLines.map((line: any) => [line.shipmentLineId, { confirmed: line.outstanding, short: 0, damaged: 0, rejected: 0 }])));

  const chooseFile = (selected: File | null, input: HTMLInputElement) => {
    if (!selected) return setFile(null);
    try { validateDocumentFile(selected); setFile(selected); setError(''); }
    catch (cause: any) { setFile(null); setError(cause.message); input.value = ''; }
  };

  const submit = async () => {
    if (!file) return setError(`Choose a ${DOCUMENT_FORMATS} file first.`);
    setBusy(true); setError('');
    try {
      const token = localStorage.getItem('scm_token');
      const { form } = await prepareDocumentUpload(file);
      const upload = await fetch(`${apiBase}/api/documents/extract`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Idempotency-Key': crypto.randomUUID() }, body: form });
      const document = await upload.json();
      if (!upload.ok) throw new Error(document.message || 'Document upload failed');
      const endpoint = mode === 'appointment' ? `/api/pos/${po.id}/appointment` : mode === 'pod' ? `/api/pos/${po.id}/pods` : `/api/pos/${po.id}/invoice`;
      const shipmentLines = outstandingLines.map((line: any) => ({ shipmentLineId: line.shipmentLineId, ...(podLines[line.shipmentLineId] || {}) }));
      const extracted = document.extracted || {};
      const appointmentMatchDetails = {
        sourceAddress: extracted.sourceAddress || null,
        destinationAddress: extracted.destinationAddress || extracted.destination || null,
        sourceCity: extracted.sourceCity || null,
        destinationCity: extracted.destinationCity || null,
        sourceState: extracted.sourceState || null,
        destinationState: extracted.destinationState || null,
        sourcePostalCode: extracted.sourcePostalCode || null,
        destinationPostalCode: extracted.destinationPostalCode || null,
        facilityName: extracted.facilityName || null,
        fcCode: extracted.fcCode || null,
        extractionConfidence: document.confidence ?? extracted.confidence ?? null,
      };
      const payload = mode === 'appointment'
        ? { documentVersionId: document.documentVersionId, appointmentId: fields.appointmentId || extracted.appointmentId, appointmentAt: fields.appointmentAt || extracted.appointmentAt, location: fields.location || extracted.destinationAddress || extracted.destination, matchStatus: 'MATCHED', matchDetails: appointmentMatchDetails }
        : mode === 'pod'
          ? { documentVersionId: document.documentVersionId, receiver: fields.receiver, deliveryAt: fields.deliveryAt, lines: shipmentLines }
          : { documentVersionId: document.documentVersionId, number: fields.number || document.extracted?.externalId, invoiceDate: fields.invoiceDate, amount: Number(fields.amount), currency: 'INR', recipients: [] };
      const response = await fetch(`${apiBase}${endpoint}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'Idempotency-Key': crypto.randomUUID() }, body: JSON.stringify(payload) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || `${title} failed`);
      onSaved(); onClose();
    } catch (cause: any) { setError(cause.message); } finally { setBusy(false); }
  };

  return <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-6"><Card className="w-full max-w-xl"><CardHeader><div className="flex items-center justify-between"><div><div className="text-xs font-semibold uppercase tracking-widest text-emerald-600">{po.externalId}</div><h2 className="mt-1 text-xl font-semibold">{title}</h2></div><button onClick={onClose}><XCircle/></button></div></CardHeader><CardContent><label className="flex min-h-36 cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed border-slate-200 bg-slate-50"><UploadCloud className="text-emerald-600"/><span className="mt-2 text-sm font-semibold">{file?.name || `Choose ${DOCUMENT_FORMATS}`}</span><span className="mt-1 text-xs text-slate-400">10 MB maximum</span><input className="hidden" type="file" accept={DOCUMENT_ACCEPT} onChange={event => chooseFile(event.target.files?.[0] || null, event.target)}/></label>{mode === 'appointment' && <div className="mt-5 grid gap-4 sm:grid-cols-2"><Label>Appointment ID<Input className="mt-2" value={fields.appointmentId} onChange={e => setFields({...fields, appointmentId: e.target.value})}/></Label><Label>Appointment time<Input type="datetime-local" className="mt-2" value={fields.appointmentAt} onChange={e => setFields({...fields, appointmentAt: e.target.value})}/></Label><Label>Location<Input className="mt-2" value={fields.location} onChange={e => setFields({...fields, location: e.target.value})}/></Label></div>}{mode === 'pod' && <div className="mt-5 space-y-4"><div className="grid gap-4 sm:grid-cols-2"><Label>Receiver<Input className="mt-2" value={fields.receiver} onChange={e => setFields({...fields, receiver: e.target.value})}/></Label><Label>Delivery time<Input type="datetime-local" className="mt-2" value={fields.deliveryAt} onChange={e => setFields({...fields, deliveryAt: e.target.value})}/></Label></div><div className="rounded-xl border border-slate-100 p-4"><div className="mb-3 text-sm font-semibold">Delivered quantities</div>{outstandingLines.length===0&&<div className="text-sm text-slate-500">No outstanding shipment lines found.</div>}{outstandingLines.map((line:any)=><div key={line.shipmentLineId} className="mb-4 last:mb-0"><div className="mb-2 text-xs text-slate-500">Outstanding: {line.outstanding}</div><div className="grid grid-cols-4 gap-2"><Label>Delivered<Input type="number" min="0" value={podLines[line.shipmentLineId]?.confirmed||0} onChange={e=>setPodLines({...podLines,[line.shipmentLineId]:{...podLines[line.shipmentLineId],confirmed:Number(e.target.value)}})}/></Label><Label>Short<Input type="number" min="0" value={podLines[line.shipmentLineId]?.short||0} onChange={e=>setPodLines({...podLines,[line.shipmentLineId]:{...podLines[line.shipmentLineId],short:Number(e.target.value)}})}/></Label><Label>Damaged<Input type="number" min="0" value={podLines[line.shipmentLineId]?.damaged||0} onChange={e=>setPodLines({...podLines,[line.shipmentLineId]:{...podLines[line.shipmentLineId],damaged:Number(e.target.value)}})}/></Label><Label>Rejected<Input type="number" min="0" value={podLines[line.shipmentLineId]?.rejected||0} onChange={e=>setPodLines({...podLines,[line.shipmentLineId]:{...podLines[line.shipmentLineId],rejected:Number(e.target.value)}})}/></Label></div></div>)}</div></div>}{mode === 'invoice' && <div className="mt-5 grid gap-4 sm:grid-cols-2"><Label>Invoice number<Input className="mt-2" value={fields.number} onChange={e => setFields({...fields, number: e.target.value})}/></Label><Label>Invoice date<Input type="date" className="mt-2" value={fields.invoiceDate} onChange={e => setFields({...fields, invoiceDate: e.target.value})}/></Label><Label>Amount<Input type="number" className="mt-2" value={fields.amount} onChange={e => setFields({...fields, amount: e.target.value})}/></Label></div>}{error && <div className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-700"><AlertTriangle className="mr-2 inline" size={16}/>{error}</div>}<Button disabled={busy} onClick={submit} className="mt-6 w-full bg-ink text-white">{busy ? 'Saving…' : title}</Button></CardContent></Card></div>;
}

import { useState } from 'react';
import { AlertTriangle, UploadCloud, XCircle } from 'lucide-react';
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

  const submit = async () => {
    if (!file) return setError('Choose a PDF first.');
    setBusy(true); setError('');
    try {
      const token = localStorage.getItem('scm_token');
      const form = new FormData(); form.append('file', file);
      const upload = await fetch(`${apiBase}/api/documents/extract`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Idempotency-Key': crypto.randomUUID() }, body: form });
      const document = await upload.json();
      if (!upload.ok) throw new Error(document.message || 'Document upload failed');
      const endpoint = mode === 'appointment' ? `/api/pos/${po.id}/appointment` : mode === 'pod' ? `/api/pos/${po.id}/pods` : `/api/pos/${po.id}/invoice`;
      const shipmentLines = (po.shipments || []).flatMap((shipment: any) => (shipment.lines || []).filter((line: any) => Number(line.dispatched_quantity) > Number(line.delivered_quantity || 0)).map((line: any) => ({ shipmentLineId: line.id, confirmed: Number(line.dispatched_quantity) - Number(line.delivered_quantity || 0), short: 0, damaged: 0, rejected: 0 })));
      const payload = mode === 'appointment'
        ? { documentVersionId: document.documentVersionId, appointmentId: fields.appointmentId || document.extracted?.appointmentId, appointmentAt: fields.appointmentAt || document.extracted?.appointmentAt, location: fields.location || document.extracted?.destination, matchStatus: 'MATCHED' }
        : mode === 'pod'
          ? { documentVersionId: document.documentVersionId, receiver: fields.receiver, deliveryAt: fields.deliveryAt, lines: shipmentLines }
          : { documentVersionId: document.documentVersionId, number: fields.number || document.extracted?.externalId, invoiceDate: fields.invoiceDate, amount: Number(fields.amount), currency: 'INR', recipients: [] };
      const response = await fetch(`${apiBase}${endpoint}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'Idempotency-Key': crypto.randomUUID() }, body: JSON.stringify(payload) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || `${title} failed`);
      onSaved(); onClose();
    } catch (cause: any) { setError(cause.message); } finally { setBusy(false); }
  };

  return <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-6"><Card className="w-full max-w-xl"><CardHeader><div className="flex items-center justify-between"><div><div className="text-xs font-semibold uppercase tracking-widest text-emerald-600">{po.externalId}</div><h2 className="mt-1 text-xl font-semibold">{title}</h2></div><button onClick={onClose}><XCircle/></button></div></CardHeader><CardContent><label className="flex min-h-36 cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed border-slate-200 bg-slate-50"><UploadCloud className="text-emerald-600"/><span className="mt-2 text-sm font-semibold">{file?.name || 'Choose PDF'}</span><input className="hidden" type="file" accept="application/pdf,.pdf" onChange={event => setFile(event.target.files?.[0] || null)}/></label>{mode === 'appointment' && <div className="mt-5 grid gap-4 sm:grid-cols-2"><Label>Appointment ID<Input className="mt-2" value={fields.appointmentId} onChange={e => setFields({...fields, appointmentId: e.target.value})}/></Label><Label>Appointment time<Input type="datetime-local" className="mt-2" value={fields.appointmentAt} onChange={e => setFields({...fields, appointmentAt: e.target.value})}/></Label><Label>Location<Input className="mt-2" value={fields.location} onChange={e => setFields({...fields, location: e.target.value})}/></Label></div>}{mode === 'pod' && <div className="mt-5 grid gap-4 sm:grid-cols-2"><Label>Receiver<Input className="mt-2" value={fields.receiver} onChange={e => setFields({...fields, receiver: e.target.value})}/></Label><Label>Delivery time<Input type="datetime-local" className="mt-2" value={fields.deliveryAt} onChange={e => setFields({...fields, deliveryAt: e.target.value})}/></Label></div>}{mode === 'invoice' && <div className="mt-5 grid gap-4 sm:grid-cols-2"><Label>Invoice number<Input className="mt-2" value={fields.number} onChange={e => setFields({...fields, number: e.target.value})}/></Label><Label>Invoice date<Input type="date" className="mt-2" value={fields.invoiceDate} onChange={e => setFields({...fields, invoiceDate: e.target.value})}/></Label><Label>Amount<Input type="number" className="mt-2" value={fields.amount} onChange={e => setFields({...fields, amount: e.target.value})}/></Label></div>}{error && <div className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-700"><AlertTriangle className="mr-2 inline" size={16}/>{error}</div>}<Button disabled={busy} onClick={submit} className="mt-6 w-full bg-ink text-white">{busy ? 'Saving…' : title}</Button></CardContent></Card></div>;
}

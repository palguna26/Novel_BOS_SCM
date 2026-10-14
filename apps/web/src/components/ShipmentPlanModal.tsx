import { useEffect, useMemo, useState } from 'react';
import { CalendarDays, ChevronLeft, Truck, XCircle } from 'lucide-react';
import { Button } from './ui/button';
import { Card, CardContent, CardHeader } from './ui/card';
import { Input } from './ui/input';
import { Label } from './ui/label';

type Props = { pos: any[]; onClose: () => void; onAction: Function };
type Vehicle = { truckNumber: string; driverName: string; driverPhone: string; plannedDispatchAt: string };

const emptyVehicle = (): Vehicle => ({ truckNumber: '', driverName: '', driverPhone: '', plannedDispatchAt: '' });
const remaining = (line: any) => Math.max(0, Number(line.availableToPlan ?? (Number(line.allocated || 0) - Number(line.planned || 0))));
const draftKey = (poId: string) => `scm-shipment-draft:${poId}`;

export function ShipmentPlanModal({ pos, onClose, onAction }: Props) {
  const [step, setStep] = useState<1 | 2>(1);
  const [po, setPo] = useState<any | null>(null);
  const [vehicle, setVehicle] = useState<Vehicle>(emptyVehicle);
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const eligiblePos = useMemo(() => pos.filter(candidate =>
    ['ACCEPTED', 'SHIPMENT_PLANNING'].includes(candidate.status) &&
    Boolean(candidate.appointment?.appointmentAt) &&
    (candidate.lines || []).some((line: any) => remaining(line) > 0)), [pos]);
  const availableLines = (po?.lines || []).filter((line: any) => remaining(line) > 0);
  const lines = availableLines.map((line: any) => ({ poLineId: line.id, planned: Number(quantities[line.id] || 0) })).filter((line: any) => line.planned > 0);
  const totalPlanned = lines.reduce((sum: number, line: any) => sum + line.planned, 0);

  useEffect(() => {
    if (po) localStorage.setItem(draftKey(po.id), JSON.stringify({ vehicle, quantities }));
  }, [po, vehicle, quantities]);

  const selectPo = (candidate: any) => {
    let draft: any = null;
    try { draft = JSON.parse(localStorage.getItem(draftKey(candidate.id)) || 'null'); } catch { /* Ignore invalid local draft. */ }
    const defaults = Object.fromEntries((candidate.lines || []).map((line: any) =>
      [line.id, String(Math.min(remaining(line), Math.max(0, Number(draft?.quantities?.[line.id] ?? remaining(line)))))]));
    setPo(candidate);
    setVehicle(draft?.vehicle || emptyVehicle());
    setQuantities(defaults);
  };

  const setQuantity = (lineId: string, value: string, maximum: number) => {
    if (value === '') return setQuantities(current => ({ ...current, [lineId]: '' }));
    const number = Number(value);
    if (!Number.isFinite(number)) return;
    setQuantities(current => ({ ...current, [lineId]: String(Math.min(maximum, Math.max(0, number))) }));
  };

  const createShipment = async () => {
    if (!po || !lines.length) return;
    setBusy(true);
    try {
      if (await onAction(`/api/pos/${po.id}/shipments`, { ...vehicle, plannedDispatchAt: vehicle.plannedDispatchAt ? new Date(vehicle.plannedDispatchAt).toISOString() : null, lines })) {
        localStorage.removeItem(draftKey(po.id));
        onClose();
      }
    } finally { setBusy(false); }
  };

  return <div className="fixed inset-0 z-40 flex items-center justify-center overflow-y-auto bg-black/40 p-6">
    <Card className="my-auto max-h-[calc(100vh-3rem)] w-full max-w-3xl overflow-y-auto">
      <CardHeader><div className="flex justify-between gap-4"><div>
        <div className="text-xs font-semibold uppercase tracking-widest text-emerald-600">Create shipment · Step {step} of 2</div>
        <h2 className="mt-1 text-xl font-semibold">{step === 1 ? 'Select a purchase order' : `Plan shipment for ${po.externalId}`}</h2>
        <p className="mt-1 text-sm text-slate-500">{step === 1 ? 'Choose a PO with a matched appointment.' : 'Choose the quantities for this truck. Your edits are saved on this browser.'}</p>
      </div><button onClick={onClose} aria-label="Close"><XCircle /></button></div></CardHeader>
      <CardContent>{step === 1 ? <>
        {eligiblePos.length === 0 ? <div className="rounded-xl border border-dashed border-slate-200 p-8 text-center"><CalendarDays className="mx-auto text-slate-400" size={24} /><div className="mt-3 font-semibold">No purchase orders are ready</div><p className="mt-1 text-sm text-slate-500">Accept a PO, match its appointment, and reserve inventory first.</p></div> :
          <div className="overflow-x-auto rounded-xl border"><div className="grid min-w-[600px] grid-cols-[1.1fr_1fr_1fr_1fr] gap-3 bg-slate-50 px-4 py-3 text-xs font-semibold uppercase text-slate-500"><span>PO</span><span>Appointment</span><span>Destination</span><span>Remaining</span></div>
            {eligiblePos.map((candidate: any) => <button key={candidate.id} onClick={() => selectPo(candidate)} className={`grid min-w-[600px] w-full grid-cols-[1.1fr_1fr_1fr_1fr] gap-3 border-t px-4 py-4 text-left text-sm ${po?.id === candidate.id ? 'bg-emerald-50' : 'hover:bg-slate-50'}`}><span className="mono font-semibold">{candidate.externalId}</span><span>{new Date(candidate.appointment.appointmentAt).toLocaleDateString()}</span><span>{candidate.destination || '—'}</span><span className="mono">{(candidate.lines || []).reduce((sum: number, line: any) => sum + remaining(line), 0)} units</span></button>)}
          </div>}
        <Button disabled={!po} onClick={() => setStep(2)} className="mt-6 w-full bg-ink text-white">Continue to shipment planning</Button>
      </> : <>
        <button onClick={() => setStep(1)} className="mb-4 text-sm font-semibold text-slate-500"><ChevronLeft size={15} className="mr-1 inline" />Change PO</button>
        <div className="grid gap-4 sm:grid-cols-2">
          <Label>Truck number<Input className="mt-2" value={vehicle.truckNumber} onChange={e => setVehicle({ ...vehicle, truckNumber: e.target.value })} /></Label>
          <Label>Driver name<Input className="mt-2" value={vehicle.driverName} onChange={e => setVehicle({ ...vehicle, driverName: e.target.value })} /></Label>
          <Label>Driver phone<Input className="mt-2" value={vehicle.driverPhone} onChange={e => setVehicle({ ...vehicle, driverPhone: e.target.value })} /></Label>
          <Label>Planned dispatch<Input type="datetime-local" className="mt-2" value={vehicle.plannedDispatchAt} onChange={e => setVehicle({ ...vehicle, plannedDispatchAt: e.target.value })} /></Label>
        </div>
        <div className="mt-5 overflow-x-auto rounded-xl border"><div className="grid min-w-[540px] grid-cols-[1fr_110px_130px] gap-3 bg-slate-50 px-4 py-3 text-xs font-semibold uppercase text-slate-500"><span>Product</span><span>Remaining</span><span>This shipment</span></div>
          {availableLines.map((line: any) => <div key={line.id} className="grid min-w-[540px] grid-cols-[1fr_110px_130px] items-center gap-3 border-t px-4 py-3 text-sm"><div><div className="mono font-semibold">{line.channel_item_code || line.sku?.code || 'Product'}</div><div className="text-xs text-slate-500">{line.sku?.name || line.description || ''}</div></div><div className="mono">{remaining(line)}</div><Input aria-label={`Quantity for ${line.channel_item_code || line.sku?.name || 'product'}`} type="number" min="0" max={remaining(line)} step="any" value={quantities[line.id] ?? ''} onChange={e => setQuantity(line.id, e.target.value, remaining(line))} /></div>)}
        </div>
        <div className="mt-4 rounded-xl bg-slate-50 p-4 text-sm"><Truck className="mr-2 inline text-emerald-600" size={17} />{totalPlanned} units selected for this shipment.</div>
        <Button disabled={!lines.length || busy} onClick={createShipment} className="mt-6 w-full bg-ink text-white">{busy ? 'Creating shipment…' : 'Create shipment'}</Button>
      </>}</CardContent>
    </Card>
  </div>;
}

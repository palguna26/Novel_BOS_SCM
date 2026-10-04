import { useState } from 'react';
import { XCircle } from 'lucide-react';
import { Button } from './ui/button';
import { Card, CardContent, CardHeader } from './ui/card';
import { Input } from './ui/input';
import { Label } from './ui/label';

export function ShortCloseModal({ po, onClose, onAction }: { po: any; onClose: () => void; onAction: Function }) {
  const outstanding = (po.lines || []).reduce((sum: number, line: any) => sum + Math.max(0, Number(line.ordered || 0) - Number(line.delivered || 0)), 0);
  const [reason, setReason] = useState('Customer confirmed remaining quantity will not be supplied');
  const [remainingQuantity, setRemainingQuantity] = useState(outstanding);
  return <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-6"><Card className="w-full max-w-lg"><CardHeader><div className="flex justify-between"><div><div className="text-xs font-semibold uppercase tracking-widest text-amber-600">Manager approval</div><h2 className="mt-1 text-xl font-semibold">Short-close {po.externalId}</h2></div><button onClick={onClose}><XCircle/></button></div></CardHeader><CardContent><Label>Remaining quantity<Input type="number" className="mt-2" value={remainingQuantity} onChange={e=>setRemainingQuantity(Number(e.target.value))}/></Label><Label className="mt-4 block">Reason<textarea className="mt-2 min-h-24 w-full rounded-xl border border-slate-200 p-3" value={reason} onChange={e=>setReason(e.target.value)}/></Label><Button disabled={!reason.trim()||remainingQuantity<=0} onClick={async()=>{await onAction(`/api/pos/${po.id}/short-close`,{reason,remainingQuantity});onClose()}} className="mt-6 w-full bg-amber-600 text-white">Approve short close</Button></CardContent></Card></div>;
}

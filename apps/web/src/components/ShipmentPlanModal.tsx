import { useState } from 'react';
import { Truck, XCircle } from 'lucide-react';
import { Button } from './ui/button';
import { Card, CardContent, CardHeader } from './ui/card';
import { Input } from './ui/input';
import { Label } from './ui/label';

export function ShipmentPlanModal({ po, onClose, onAction }: { po: any; onClose: () => void; onAction: Function }) {
  const [vehicle, setVehicle] = useState<any>({ truckNumber: '', driverName: '', driverPhone: '', plannedDispatchAt: '' });
  const lines = (po.lines || []).map((line: any) => ({ poLineId: line.id, planned: Math.max(0, Number(line.allocated || 0) - Number(line.dispatched || 0)) })).filter((line: any) => line.planned > 0);
  return <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-6"><Card className="w-full max-w-xl"><CardHeader><div className="flex justify-between"><div><div className="text-xs font-semibold uppercase tracking-widest text-emerald-600">{po.externalId}</div><h2 className="mt-1 text-xl font-semibold">Plan shipment</h2></div><button onClick={onClose}><XCircle/></button></div></CardHeader><CardContent><div className="grid gap-4 sm:grid-cols-2"><Label>Truck number<Input className="mt-2" value={vehicle.truckNumber} onChange={e=>setVehicle({...vehicle,truckNumber:e.target.value})}/></Label><Label>Driver name<Input className="mt-2" value={vehicle.driverName} onChange={e=>setVehicle({...vehicle,driverName:e.target.value})}/></Label><Label>Driver phone<Input className="mt-2" value={vehicle.driverPhone} onChange={e=>setVehicle({...vehicle,driverPhone:e.target.value})}/></Label><Label>Planned dispatch<Input type="datetime-local" className="mt-2" value={vehicle.plannedDispatchAt} onChange={e=>setVehicle({...vehicle,plannedDispatchAt:e.target.value})}/></Label></div><div className="mt-5 rounded-xl bg-slate-50 p-4 text-sm"><Truck className="mr-2 inline text-emerald-600" size={17}/>{lines.reduce((sum:number,line:any)=>sum+line.planned,0)} reserved units will be planned.</div><Button disabled={!lines.length} onClick={async()=>{await onAction(`/api/pos/${po.id}/shipments`,{...vehicle,lines});onClose()}} className="mt-6 w-full bg-ink text-white">Create shipment</Button></CardContent></Card></div>;
}

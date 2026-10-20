import { useEffect, useState } from "react";
import {
  BookOpen,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  X,
} from "lucide-react";

type GuideTask = {
  title: string;
  steps: string[];
  visual?: string[];
};

type Guide = {
  intro: string;
  start: string;
  map: string[];
  tasks: GuideTask[];
  terms: [string, string][];
  checks: string[];
};

type Props = {
  page: string;
  context?: { selectedPo?: string };
  onClose: () => void;
};

const guides: Record<string, Guide> = {
  Overview: {
    intro: "Use Overview to see what needs attention across purchase orders, stock, shipments, and invoices.",
    start: "Start with the dashboard cards, then open the page linked to the item that needs action.",
    map: ["Needs attention", "Recent POs", "Warehouse pulse"],
    tasks: [
      { title: "Find the next action", steps: ["Check Awaiting review, Inventory blocked, In transit, and Awaiting invoice.", "Open the matching page from the left navigation or a dashboard link."], visual: ["Dashboard cards", "Open work queue"] },
      { title: "Check warehouse stock", steps: ["Read the warehouse pulse by SKU.", "Open Inventory when a SKU is low or unavailable."], visual: ["SKU", "Allocatable stock", "Warehouse"] },
    ],
    terms: [["Awaiting review", "POs that still need a review decision."], ["Allocatable", "Stock that can be reserved for a new PO."], ["In transit", "Quantity assigned to dispatched shipments." ]],
    checks: ["Treat the dashboard as a starting point; use the source page before making a change.", "Low allocatable stock can block PO acceptance or shipment planning."],
  },
  "PO Inbox": {
    intro: "PO Inbox is where purchase orders enter the operation and move through review.",
    start: "Upload or open a PO, verify every extracted field and line, then accept or reject it.",
    map: ["Upload", "Review", "Accept or reject", "PO workspace"],
    tasks: [
      { title: "Upload and review a PO", steps: ["Select Upload purchase order and choose the platform.", "Choose a PDF, XLSX, CSV, or DOCX file, then scan it.", "Check PO ID, destination, warehouse, dates, vendor, value, SKU, quantity, and price.", "Save the reviewed PO."], visual: ["Upload file", "Extract fields", "Review lines", "Save"] },
      { title: "Accept or reject a PO", steps: ["Open the PO row and confirm destination, warehouse, lines, quantities, and shortage.", "Select Accept when the order is correct, or Reject and record the reason."], visual: ["Review", "Accept / Reject"] },
      { title: "Use the PO workspace", steps: ["Select a row to see overview, line reconciliation, documents, and next steps.", "Use the available action for appointment, shipment, invoice, or POD work."], visual: ["Overview", "Lines & inventory", "Next steps"] },
    ],
    terms: [["Allocated", "Quantity reserved against the PO."], ["Shortage", "Ordered quantity that cannot currently be allocated."], ["Appointment gate", "The appointment document requirement before stock can move forward." ]],
    checks: ["Acceptance and appointment can happen in either order, but both gates must be complete before stock is reserved.", "Do not accept a PO until the destination and internal SKU mapping are correct."],
  },
  Inventory: {
    intro: "Inventory is the control center for stock, SKU setup, warehouse structure, mappings, units, routes, and stock history.",
    start: "Start on Stock to understand available quantities. Use the other tabs to maintain the records that make stock usable.",
    map: ["Stock", "SKUs", "Warehouses", "Mappings", "UOMs & routes"],
    tasks: [
      { title: "Read stock correctly", steps: ["Search for a SKU and expand it to see warehouse-level values.", "Use Physical for stock on hand, Blocked for reserved stock, In transit for moving stock, and Allocatable for stock available to reserve.", "Compare Allocatable with Threshold to spot low-stock risk."], visual: ["Physical", "Blocked", "In transit", "Allocatable"] },
      { title: "Adjust stock safely", steps: ["Select Adjust stock from the Stock tab.", "Choose the SKU and warehouse, enter the quantity change, and provide a reason.", "Save the adjustment, then confirm the new stock value and history entry."], visual: ["Adjust stock", "Quantity + reason", "Save", "History"] },
      { title: "Maintain SKUs and thresholds", steps: ["Use SKUs to add or edit the internal SKU record.", "Set the unit, active state, and default threshold.", "On Stock, edit a warehouse threshold when a location needs a different reorder level."], visual: ["SKU record", "Threshold", "Low-stock check"] },
      { title: "Maintain the stock network", steps: ["Use Warehouses for source facilities and their addresses.", "Use Mappings to connect channel SKUs and destinations to internal SKUs or sites.", "Use UOMs & routes for units of measure and permitted movement routes."], visual: ["Warehouse", "Mapping", "UOM", "Route"] },
      { title: "Audit an inventory change", steps: ["Open Inventory History from Stock.", "Review transaction type, quantity delta, reason, timestamp, and status.", "Use the recorded reason when reconciling a stock difference."], visual: ["Transaction", "Delta", "Reason", "Status"] },
    ],
    terms: [["Physical", "Quantity recorded at the warehouse."], ["Blocked", "Quantity held for an accepted PO or another operational reservation."], ["Allocatable", "Physical stock that is currently available for allocation."], ["Threshold", "The low-stock level used to flag replenishment risk."], ["Mapping", "The link between an external channel/destination SKU and an internal record."], ["Transaction", "A recorded inventory movement with a reason and status." ]],
    checks: ["Never adjust stock without a clear reason; the adjustment becomes part of operational history.", "Check the warehouse and SKU before saving an adjustment.", "A high Physical value does not always mean stock is available: Blocked and other commitments reduce Allocatable.", "Update mappings and warehouse structure before relying on PO destination resolution."],
  },
  Shipments: {
    intro: "Shipment Tracker shows planned and moving shipments and lets the team dispatch and confirm delivery.",
    start: "Expand a shipment to check its route and line quantities before dispatching it.",
    map: ["Plan", "Review route", "Dispatch", "Confirm POD"],
    tasks: [{ title: "Move a shipment forward", steps: ["Create a shipment plan from a PO.", "Review source, destination, route, and planned quantities.", "Dispatch when the truck leaves.", "Confirm POD after delivery and enter actual received quantities."], visual: ["Planned", "Dispatched", "In transit", "Delivered"] }],
    terms: [["Planned", "Shipment quantities assigned but not dispatched."], ["POD", "Proof of delivery and actual received quantities."], ["Delivery issue", "A shipment state that needs exception handling or short close." ]],
    checks: ["Do not plan more than the PO remaining quantity.", "Confirm the route and destination before dispatch.", "Use actual received quantities during POD confirmation."],
  },
  Appointments: {
    intro: "Appointments stores the booking document and consignment evidence connected to a PO or shipment.",
    start: "Open a PO row, check its booking status, and attach the correct document.",
    map: ["PO", "Booking", "Appointment document", "Consignment"],
    tasks: [{ title: "Attach an appointment", steps: ["Expand the PO.", "Select Attach appointment or Replace appointment.", "Upload the booking document and save it.", "Attach consignment details when a shipment is available."], visual: ["Booking", "Upload", "Saved"] }],
    terms: [["Appointment gate", "The booking requirement used by the PO workflow."], ["Consignment", "Shipment-specific handover information." ]],
    checks: ["Make sure the document belongs to the selected PO.", "Replacing a document should only be done when the new booking is authoritative."],
  },
  Invoices: {
    intro: "Invoice Queue shows delivered PO activity that is ready for billing and exceptions that need closure.",
    start: "Check the PO delivery state before uploading an invoice or short-closing an exception.",
    map: ["Delivery state", "Invoice", "Short close", "Complete"],
    tasks: [{ title: "Complete invoice work", steps: ["Expand a PO to review ordered, delivered, and remaining quantities.", "Upload an invoice only when the PO is fully delivered or short-closed.", "For delivery issues, use Short close when the approved remainder will not arrive.", "Open the invoice file to confirm the saved document."], visual: ["Delivered", "Upload invoice", "Short close", "Complete"] }],
    terms: [["Short close", "Close an approved undelivered remainder so the PO can complete."], ["Fully delivered", "All expected quantities have been received." ]],
    checks: ["Do not upload an invoice while delivery is still unresolved.", "Short close only the approved remainder and keep the exception reason clear."],
  },
  Administration: {
    intro: "Administration maintains the controlled master data used by PO intake, inventory, routing, and permissions.",
    start: "Change master data only when you understand which workflows depend on it.",
    map: ["Platforms", "Warehouses", "Locations", "Mappings", "UOMs", "Routes"],
    tasks: [{ title: "Maintain operational master data", steps: ["Add or edit the record in the matching section.", "Check code, name, address, active state, and relationships.", "Save, then verify the record appears in the list.", "Deactivate records when history must remain; delete only when it is safe and permitted."], visual: ["Edit", "Validate", "Save", "Verify"] }],
    terms: [["Active", "A record available for new operational use."], ["Master data", "Controlled reference data used by workflows and validations." ]],
    checks: ["A warehouse or mapping change can affect future PO resolution.", "Prefer deactivation when historical records must remain understandable.", "Follow your role permissions for controlled changes."],
  },
  "Audit Log": {
    intro: "Audit Log is the immutable record of operational changes and important workflow events.",
    start: "Use it to confirm who changed what, when it happened, and which record was affected.",
    map: ["Event", "Actor", "Record", "Time"],
    tasks: [{ title: "Investigate an event", steps: ["Find the event for the PO, inventory record, shipment, or master-data change.", "Read the actor, event type, record, timestamp, and details.", "Compare the event with the current page state when reconciling an issue."], visual: ["Filter", "Inspect", "Reconcile"] }],
    terms: [["Event", "A recorded system or user action."], ["Actor", "The user or service that caused the event." ]],
    checks: ["Use the audit record as the source of truth for change history.", "Do not treat a current value alone as proof of how it changed."],
  },
};

const poGuide: Guide = {
  ...guides["PO Inbox"],
  intro: "This PO workspace is the operational record for review, inventory, documents, shipments, delivery, and invoice readiness.",
  start: "Start with the status and line reconciliation, then follow the next step shown at the bottom of the workspace.",
};

export function GuidePanel({ page, context, onClose }: Props) {
  const [openTask, setOpenTask] = useState(0);
  const guide = context?.selectedPo ? poGuide : guides[page] || guides.Overview;

  useEffect(() => {
    setOpenTask(0);
  }, [page, context?.selectedPo]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div role="dialog" aria-modal="true" aria-label={`${page} guide`} className="fixed inset-y-0 right-0 z-30 flex w-[min(560px,100vw)] flex-col border-l border-slate-200 bg-white shadow-2xl">
      <div className="flex items-center justify-between border-b border-slate-100 px-6 py-5">
        <div>
          <div className="flex items-center gap-2 font-semibold"><BookOpen size={18} className="text-emerald-700" /> {context?.selectedPo ? "PO workspace guide" : `${page} guide`}</div>
          <div className="mt-1 text-xs text-slate-400">Practical help for the page you are using</div>
        </div>
        <button aria-label="Close Guide" onClick={onClose} className="min-h-10 min-w-10 text-slate-400 hover:text-ink"><X size={20} /></button>
      </div>
      <div className="flex-1 overflow-auto p-6">
        <div className="rounded-2xl bg-ink p-5 text-white">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-emerald-300"><CircleHelp size={15} /> Start here</div>
          <p className="mt-3 text-sm leading-6 text-slate-200">{guide.intro}</p>
          <p className="mt-3 text-sm font-semibold leading-6 text-white">{guide.start}</p>
        </div>
        <section className="mt-6">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Page map</h3>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {guide.map.map((item, index) => <div key={item} className="flex items-center gap-2"><div className="rounded-lg border border-emerald-100 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-800">{item}</div>{index < guide.map.length - 1 && <ChevronRight size={14} className="text-slate-300" />}</div>)}
          </div>
        </section>
        <section className="mt-7">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Common tasks</h3>
          <div className="mt-3 space-y-2">
            {guide.tasks.map((task, index) => <div key={task.title} className="overflow-hidden rounded-xl border border-slate-200">
              <button aria-expanded={openTask === index} onClick={() => setOpenTask(openTask === index ? -1 : index)} className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left text-sm font-semibold hover:bg-slate-50"><span>{task.title}</span>{openTask === index ? <ChevronDown size={16} /> : <ChevronRight size={16} />}</button>
              {openTask === index && <div className="border-t border-slate-100 px-4 py-4"><div className="mb-4 flex flex-wrap items-center gap-2">{task.visual?.map((item, visualIndex) => <div key={item} className="flex items-center gap-2"><div className="rounded-lg bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-600">{item}</div>{visualIndex < (task.visual?.length || 0) - 1 && <ChevronRight size={13} className="text-emerald-500" />}</div>)}</div><ol className="space-y-3">{task.steps.map((step, stepIndex) => <li key={step} className="flex gap-3 text-sm leading-6 text-slate-600"><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-xs font-semibold text-emerald-700">{stepIndex + 1}</span><span>{step}</span></li>)}</ol></div>}
            </div>)}
          </div>
        </section>
        <section className="mt-7"><h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Key terms</h3><div className="mt-3 space-y-3">{guide.terms.map(([term, meaning]) => <div key={term} className="text-sm"><div className="font-semibold text-slate-700">{term}</div><div className="mt-1 text-slate-500">{meaning}</div></div>)}</div></section>
        <section className="mt-7 rounded-xl bg-amber-50 p-4"><h3 className="text-xs font-semibold uppercase tracking-wide text-amber-800">Checks before you continue</h3><div className="mt-3 space-y-3">{guide.checks.map(check => <div key={check} className="flex gap-2 text-sm leading-6 text-amber-900"><CheckCircle2 size={16} className="mt-1 shrink-0" /> <span>{check}</span></div>)}</div></section>
      </div>
    </div>
  );
}

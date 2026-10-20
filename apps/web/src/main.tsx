import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Activity,
  Archive,
  ArrowUpRight,
  Boxes,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  FileText,
  LayoutDashboard,
  LogOut,
  PackageCheck,
  Plus,
  Route,
  Search,
  Settings,
  Truck,
  UploadCloud,
  Users,
  Warehouse as WarehouseIcon,
  XCircle,
  AlertTriangle,
  CalendarDays,
  Clock3,
  MapPin,
  ReceiptText,
  FileSearch,
  History,
  Mail,
  UserRound,
  MessageCircle,
  Menu,
  Download,
  BookOpen,
} from "lucide-react";
import "./index.css";
import { Button as UiButton } from "./components/ui/button";
import { Card as UiCard, CardContent, CardHeader } from "./components/ui/card";
import { Input as UiInput } from "./components/ui/input";
import { Label as UiLabel } from "./components/ui/label";
import { Alert as UiAlert } from "./components/ui/alert";
import { Progress as UiProgress } from "./components/ui/progress";
import { Tabs as UiTabs } from "./components/ui/tabs";
import { PoDetailsPage } from "./components/PoDetailsPage";
import { EditPoModal } from "./components/EditPoModal";
import { PoInboxAccordion } from "./components/PoInboxAccordion";
import { SkuInventoryAccordion } from "./components/SkuInventoryAccordion";
import { InventoryWorkspace } from "./components/InventoryWorkspace";
import { DocumentWorkflowModal } from "./components/DocumentWorkflowModal";
import { DocumentLink } from "./components/DocumentLink";
import { ShipmentPlanModal } from "./components/ShipmentPlanModal";
import { ShortCloseModal } from "./components/ShortCloseModal";
import { CopilotPanel } from "./components/CopilotPanel";
import { GuidePanel } from "./components/GuidePanel";
import {
  DOCUMENT_ACCEPT,
  DOCUMENT_FORMATS,
  prepareDocumentUpload,
  validateDocumentFile,
} from "./lib/document-upload";
import { emptyPoFilters, filterPos, type PoFilters } from "./lib/po-search";
const API = import.meta.env.VITE_API_URL || "http://localhost:4000";
type User = { id: string; name: string; email: string; role: string; canApprove?: boolean };
type PO = any;
function uniqueWarehouseId(warehouses: any[], city: string, postalCode?: string) {
  const normalizedPostal = String(postalCode || '').replace(/\s+/g, '').toLowerCase();
  const normalizedCity = String(city || '').trim().toLowerCase();
  const postalMatches = normalizedPostal
    ? warehouses.filter((warehouse: any) => String(warehouse.postal_code || warehouse.postalCode || '').replace(/\s+/g, '').toLowerCase() === normalizedPostal)
    : [];
  if (postalMatches.length === 1) return postalMatches[0].id;
  if (!normalizedCity) return '';
  const matches = warehouses.filter((warehouse: any) => String(warehouse.city || '').trim().toLowerCase() === normalizedCity);
  return matches.length === 1 ? matches[0].id : '';
}
function uniqueDestinationMapping(mappings: any[], channelId: string, destination: string) {
  const key = String(destination || '').trim().toLowerCase();
  if (!key) return null;
  const matches = mappings.filter((mapping: any) => mapping.active !== false && mapping.channel_id === channelId && String(mapping.destination_key || '').trim().toLowerCase() === key);
  const sourceIds = [...new Set(matches.map((mapping: any) => mapping.source_site_id).filter(Boolean))];
  return sourceIds.length === 1 ? matches.find((mapping: any) => mapping.source_site_id === sourceIds[0]) : null;
}
function storeSession(session: any) {
  localStorage.setItem("scm_token", session.accessToken);
  if (session.refreshToken) localStorage.setItem("scm_refresh_token", session.refreshToken);
  if (session.user) localStorage.setItem("scm_user", JSON.stringify(session.user));
}
async function refreshSession() {
  const refreshToken = localStorage.getItem("scm_refresh_token");
  if (!refreshToken) return false;
  const response = await fetch(`${API}/auth/refresh`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ refreshToken }) });
  if (!response.ok) return false;
  storeSession(await response.json());
  return true;
}
async function api(path: string, opts: RequestInit = {}) {
  const endpoint =
    path.startsWith("/api/") || path.startsWith("/auth/")
      ? path
      : `/api${path}`;
  const request = () => fetch(API + endpoint, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      ...(localStorage.getItem("scm_token") ? { Authorization: `Bearer ${localStorage.getItem("scm_token")}` } : {}),
      ...opts.headers,
    },
  });
  let r: Response;
  try {
    r = await request();
  } catch {
    throw new Error("API is unavailable. Start the SCM API service on port 4000.");
  }
  if (r.status === 401 && !endpoint.startsWith("/auth/") && await refreshSession()) r = await request();
  if (!r.ok)
    throw new Error(
      (await r.json().catch(() => ({ message: r.statusText }))).message ||
        "Request failed",
    );
  return r.json();
}
function Login({ onLogin }: { onLogin: (u: User) => void }) {
  const [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <div className="min-h-screen grid lg:grid-cols-[1.1fr_.9fr] bg-ink">
      <div className="hidden lg:flex flex-col justify-between p-14 text-white">
        <div>
          <div className="text-sm font-bold tracking-[.3em] text-emerald-300">
            NOVEL SCM
          </div>
          <h1 className="text-6xl font-semibold mt-24 leading-[1.05]">
            Move every
            <br />
            <span className="text-emerald-300">order forward.</span>
          </h1>
          <p className="mt-8 text-slate-300 text-lg max-w-md">
            A single operational record for purchase orders, stock, trucks and
            delivery.
          </p>
        </div>
        <div className="text-slate-400 text-sm">
          Warehouse operations, made accountable.
        </div>
      </div>
      <div className="bg-white flex items-center justify-center p-8">
        <form
          className="w-full max-w-sm"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError("");
            try {
              const x = await api("/auth/login", {
                method: "POST",
                body: JSON.stringify({ email, password }),
              });
              storeSession(x);
              onLogin(x.user);
            } catch (err: any) {
              setError(err.message || "Unable to sign in");
            } finally {
              setBusy(false);
            }
          }}
        >
          <div className="lg:hidden text-sm font-bold tracking-[.3em] text-emerald-600 mb-20">
            NOVEL SCM
          </div>
          <h2 className="text-3xl font-semibold">Welcome back</h2>
          <p className="text-slate-500 mt-2">
            Sign in to your operations workspace.
          </p>
          <label className="block text-sm font-medium mt-10">
            Work email
            <input
              className="mt-2 w-full border border-slate-200 rounded-xl px-4 py-3"
              value={email}
              autoComplete="username"
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          <label className="block text-sm font-medium mt-5">
            Password
            <input
              type="password"
              autoComplete="current-password"
              className="mt-2 w-full border border-slate-200 rounded-xl px-4 py-3"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          {error && <div className="mt-4 text-sm text-red-600">{error}</div>}
          <button disabled={busy} className="mt-8 w-full bg-ink text-white rounded-xl py-3.5 font-semibold disabled:opacity-60">
            {busy ? "Signing in…" : "Sign in"} <ArrowUpRight className="inline ml-2" size={17} />
          </button>
          <p className="text-xs text-slate-400 mt-5 text-center">Use the email and password created for you by an administrator.</p>
        </form>
      </div>
    </div>
  );
}
const nav = [
  ["Overview", LayoutDashboard],
  ["PO Inbox", ClipboardList],
  ["Inventory", Boxes],
  ["Shipments", Truck],
  ["Appointments", Route],
  ["Invoices", FileText],
  ["Administration", Settings],
  ["Audit Log", Activity],
] as const;
function WorkspaceLoading() {
  return <div role="status" aria-live="polite" className="panel flex min-h-48 items-center justify-center p-8 text-sm text-slate-500"><div className="flex items-center gap-3"><span className="h-2.5 w-2.5 animate-pulse rounded-full bg-emerald-600" /> Loading workspace data…</div></div>;
}
function Badge({ children, tone = "slate" }: { children: any; tone?: string }) {
  const m: any = {
    green: "bg-emerald-100 text-emerald-700",
    amber: "bg-amber-100 text-amber-700",
    red: "bg-red-100 text-red-700",
    blue: "bg-blue-100 text-blue-700",
    slate: "bg-slate-100 text-slate-600",
  };
  return (
    <span
      className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold ${m[tone]}`}
    >
      {children}
    </span>
  );
}
function App() {
  const [user, setUser] = useState<User | null>(null),
    [page, setPage] = useState("Overview"),
    [data, setData] = useState<any>({}),
    [selected, setSelected] = useState<PO | null>(null),
    [appointmentPo, setAppointmentPo] = useState<PO | null>(null),
    [shipmentPo, setShipmentPo] = useState<PO | null>(null),
    [invoicePo, setInvoicePo] = useState<PO | null>(null),
    [podSelection, setPodSelection] = useState<{ po: PO; shipmentId: string } | null>(null),
    [editingPo, setEditingPo] = useState<PO | null>(null),
    [toast, setToast] = useState(""),
    [copilotOpen, setCopilotOpen] = useState(false),
    [guideOpen, setGuideOpen] = useState(false),
    [globalSearch, setGlobalSearch] = useState(""),
    [mobileNavOpen, setMobileNavOpen] = useState(false),
    [loading, setLoading] = useState(false),
    [dataError, setDataError] = useState("");
  useEffect(() => {
    const t = localStorage.getItem("scm_token");
    if (t)
      api("/dashboard")
        .then(() => setUser(JSON.parse(localStorage.getItem("scm_user") || "null")))
        .catch(() => { localStorage.removeItem("scm_token"); localStorage.removeItem("scm_refresh_token"); localStorage.removeItem("scm_user"); });
  }, []);
  useEffect(() => {
    if (user) {
      setLoading(true);
      setDataError("");
      localStorage.setItem("scm_user", JSON.stringify(user));
      Promise.all([
        api("/dashboard"),
        api("/pos"),
        api("/inventory"),
        api("/inventory/transactions"),
        api("/masters"),
      ])
        .then(([dashboard, pos, inventory, transactions, masters]) =>
          setData({ dashboard, pos, inventory, transactions, masters }),
        )
        .catch((e) => {
          setDataError(e.message || "Unable to load workspace data.");
          setToast(e.message);
        })
        .finally(() => setLoading(false));
    }
  }, [user, page]);
  if (!user)
    return (
      <Login
        onLogin={(u) => {
          setUser(u);
          localStorage.setItem("scm_user", JSON.stringify(u));
        }}
      />
    );
  const counts = data.dashboard?.counts || {};
  const pos = data.pos || [];
  const refresh = () =>
    api("/pos").then((x) => setData((d: any) => ({ ...d, pos: x })));
  const refreshInventory = () =>
    Promise.all([api("/inventory"), api("/inventory/transactions"), api("/masters")]).then(([inventory, transactions, masters]) =>
      setData((d: any) => ({ ...d, inventory, transactions, masters })),
    );
  const saveInventory = async (path: string, body: any) => {
    await api(path, {
      method: "POST",
      headers: { "Idempotency-Key": crypto.randomUUID() },
      body: JSON.stringify(body),
    });
    setToast("Saved successfully");
  };
  const action = async (path: string, body?: any, onError?: (message: string) => void) => {
    try {
      await api(path, {
        method: "POST",
        headers: { "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify(body || {}),
      });
      setToast("Saved successfully");
      refresh();
      return true;
    } catch (e: any) {
      setToast(e.message);
      onError?.(e.message);
      return false;
    }
  };
  const operationalMasters = data.masters ? {
    ...data.masters,
    platforms: (data.masters.platforms || []).filter((x: any) => x.active !== false),
    warehouses: (data.masters.warehouses || []).filter((x: any) => x.active !== false),
    locations: (data.masters.locations || []).filter((x: any) => x.active !== false),
  } : {};
  return (
    <div className="min-h-screen flex">
      {mobileNavOpen && <button aria-label="Close navigation" className="fixed inset-0 z-30 bg-ink/50 md:hidden" onClick={() => setMobileNavOpen(false)} />}
      <aside className={`app-sidebar bg-ink text-white p-5 flex flex-col ${mobileNavOpen ? "is-open" : ""}`}>
        <div className="text-xs font-bold tracking-[.24em] text-emerald-300 px-3 py-4">
          NOVEL SCM
        </div>
        <div className="mt-8 space-y-1">
          {nav.map(([name, Icon]) => (
            <button
              key={name}
              onClick={() => { setPage(name); setMobileNavOpen(false); }}
              className={`w-full flex items-center gap-3 px-3 py-3 rounded-xl text-sm ${page === name ? "bg-white/10 text-white" : "text-slate-400 hover:bg-white/5"}`}
            >
              <Icon size={17} />
              {name}
            </button>
          ))}
        </div>
        <div className="mt-auto border-t border-white/10 pt-4">
          <div className="px-3 text-sm">
            {user.name}
            <div className="text-xs text-slate-500 mt-1">
              {user.role.replace("_", " ")}
            </div>
          </div>
          <button
            onClick={() => {
              localStorage.removeItem("scm_token");
              localStorage.removeItem("scm_refresh_token");
              localStorage.removeItem("scm_user");
              setUser(null);
            }}
            className="mt-4 px-3 py-2 text-xs text-slate-400"
          >
            <LogOut size={14} className="inline mr-2" />
            Sign out
          </button>
        </div>
      </aside>
      <main className="flex-1 min-w-0">
        <header className="app-header bg-white border-b border-slate-200 px-4 md:px-10 flex items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <button aria-label="Open navigation" className="mobile-only min-h-10 min-w-10 items-center justify-center rounded-lg border border-slate-200 text-slate-600" onClick={() => setMobileNavOpen(true)}>
              <Menu size={18} />
            </button>
            <div>
            <div className="hidden text-xs uppercase tracking-widest text-slate-400 sm:block">
              Operations workspace
            </div>
            <h1 className="mt-1 truncate text-lg font-semibold md:text-xl">{page}</h1>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2 md:gap-4">
            {page === "PO Inbox" && <div className="relative hidden sm:block">
              <Search
                className="absolute left-3 top-2.5 text-slate-400"
                size={16}
              />
              <input
                className="bg-slate-50 rounded-lg pl-9 pr-4 py-2 text-sm"
                placeholder="Search purchase orders..."
                value={globalSearch}
                onChange={(e) => setGlobalSearch(e.target.value)}
              />
            </div>}
            <div aria-label={`Signed in as ${user.name}`} className="flex h-9 w-9 items-center justify-center rounded-full bg-emerald-100 font-semibold text-emerald-700">
              {user.name[0]}
            </div>
            <button aria-label="Open Guide" onClick={() => { setGuideOpen(true); setCopilotOpen(false); }} className="flex min-h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:border-emerald-400 hover:text-emerald-700">
              <BookOpen size={16} /> <span className="hidden sm:inline">Guide</span>
            </button>
            <button aria-label="Open Copilot" onClick={() => { setCopilotOpen(true); setGuideOpen(false); }} className="flex min-h-10 items-center gap-2 rounded-xl bg-emerald-700 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-800">
              <MessageCircle size={16} /> <span className="hidden sm:inline">Copilot</span>
            </button>
          </div>
        </header>
        <div className="app-content p-10">
          {dataError && <div role="alert" className="mb-6 flex items-center justify-between gap-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"><span>{dataError}</span><button aria-label="Dismiss error" onClick={() => setDataError("")}><XCircle size={16} /></button></div>}
          {loading && Object.keys(data).length === 0 && <WorkspaceLoading />}
          {toast && (
            <div className="fixed right-8 top-24 z-10 bg-ink text-white px-4 py-3 rounded-xl text-sm shadow-lg">
              {toast}
              <button aria-label="Dismiss notification" onClick={() => setToast("")} className="ml-4">
                <XCircle size={14} />
              </button>
            </div>
          )}
          {page === "Overview" && (
            <Dashboard data={data.dashboard} counts={counts} onOpen={setPage} />
          )}{" "}
          {page === "PO Inbox" && (
            <Inbox
              pos={pos}
              query={globalSearch}
              onSelect={setSelected}
              onAction={action}
              onRefresh={refresh}
              canApprove={Boolean(user.canApprove)}
            />
          )}{" "}
          {page === "Inventory" && (
            <InventoryWorkspace
              rows={data.inventory || []}
              masters={operationalMasters}
              transactions={data.transactions || []}
              onSave={saveInventory}
              onRefresh={refreshInventory}
            />
          )}{" "}
          {page === "Shipments" && <Shipments pos={pos} onAction={action} />}{" "}
          {page === "Appointments" && (
            <Appointments pos={pos} onAction={action} />
          )}{" "}
          {page === "Invoices" && <Invoices pos={pos} onAction={action} />}{" "}
          {page === "Administration" && (
            <Masters data={data.masters || {}} onAction={action} />
          )}{" "}
          {page === "Audit Log" && <Audit />}
        </div>
      </main>
      {selected && (
        <PoDetailsPage
          po={selected}
          onClose={() => setSelected(null)}
          onAction={action}
          onEdit={() => setEditingPo(selected)}
          canEdit={user.role !== 'QC'}
          canApprove={Boolean(user.canApprove)}
          onAttachAppointment={() => setAppointmentPo(selected)}
          onPlanShipment={() => setShipmentPo(selected)}
          onUploadInvoice={() => setInvoicePo(selected)}
          onConfirmPod={(shipmentId) => setPodSelection({ po: selected, shipmentId })}
        />
      )}
      {appointmentPo && <DocumentWorkflowModal apiBase={API} mode="appointment" po={appointmentPo} onClose={() => setAppointmentPo(null)} onSaved={() => { setAppointmentPo(null); refresh(); }} />}
      {shipmentPo && <ShipmentPlanModal pos={[shipmentPo]} initialPoId={shipmentPo.id} onClose={() => setShipmentPo(null)} onAction={action} />}
      {invoicePo && <DocumentWorkflowModal apiBase={API} mode="invoice" po={invoicePo} onClose={() => setInvoicePo(null)} onSaved={() => { setInvoicePo(null); refresh(); }} />}
      {podSelection && <DocumentWorkflowModal apiBase={API} mode="pod" po={podSelection.po} shipmentId={podSelection.shipmentId} onClose={() => setPodSelection(null)} onSaved={() => { setPodSelection(null); refresh(); }} />}
      {editingPo && <EditPoModal po={editingPo} masters={data.masters || {}} onClose={() => setEditingPo(null)} onAction={action} onSaved={() => { setEditingPo(null); setSelected(null); }} />}
      {guideOpen && <GuidePanel page={page} context={selected ? { selectedPo: selected.externalId } : undefined} onClose={() => setGuideOpen(false)} />}
      {copilotOpen && <CopilotPanel api={api} page={page} context={selected ? { selectedPo: selected.externalId } : undefined} onClose={() => setCopilotOpen(false)} />}
    </div>
  );
}
function Stat({
  label,
  value,
  sub,
  icon: Icon,
  color,
}: {
  label: string;
  value: any;
  sub: string;
  icon: any;
  color: string;
}) {
  return (
    <div className="bg-white rounded-2xl p-5 border border-slate-100">
      <div
        className={`w-10 h-10 rounded-xl flex items-center justify-center ${color}`}
      >
        <Icon size={19} />
      </div>
      <div className="text-3xl font-semibold mt-5">{value || 0}</div>
      <div className="font-medium mt-1">{label}</div>
      <div className="text-xs text-slate-400 mt-2">{sub}</div>
    </div>
  );
}
function Dashboard({
  data,
  counts,
  onOpen,
}: {
  data: any;
  counts: any;
  onOpen: (s: string) => void;
}) {
  return (
    <>
      <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm text-slate-500">{new Intl.DateTimeFormat("en-IN", { weekday: "long", day: "2-digit", month: "long", year: "numeric" }).format(new Date())}</p>
          <h2 className="text-3xl font-semibold mt-2">Good morning, team.</h2>
        </div>
        <button
          onClick={() => onOpen("PO Inbox")}
          className="bg-ink text-white px-4 py-3 rounded-xl text-sm font-semibold"
        >
          <Plus size={16} className="inline mr-2" />
          Upload purchase order
        </button>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat
          label="Awaiting review"
          value={(counts.UNDER_REVIEW || 0) + (counts.UPLOADED || 0)}
          sub="Needs your attention"
          icon={ClipboardList}
          color="bg-emerald-100 text-emerald-700"
        />
        <Stat
          label="Ready to ship"
          value={(counts.ACCEPTED || 0) + (counts.SHIPMENT_PLANNING || 0)}
          sub="Ready for fulfilment"
          icon={Archive}
          color="bg-blue-100 text-blue-700"
        />
        <Stat
          label="In transit"
          value={(counts.PARTIALLY_DISPATCHED || 0) + (counts.FULLY_DISPATCHED || 0)}
          sub="Shipments moving"
          icon={Truck}
          color="bg-amber-100 text-amber-700"
        />
        <Stat
          label="Awaiting invoice"
          value={counts.FULLY_DELIVERED || 0}
          sub="Ready to close"
          icon={FileText}
          color="bg-emerald-100 text-emerald-700"
        />
      </div>
      <div className="mt-8 grid gap-6 xl:grid-cols-[1.4fr_1fr]">
    <div className="panel overflow-x-auto">
          <div className="p-5 border-b border-slate-100 flex justify-between">
            <div>
              <h3 className="font-semibold">Recent purchase orders</h3>
              <p className="text-xs text-slate-400 mt-1">
                Latest operational activity
              </p>
            </div>
            <button
              onClick={() => onOpen("PO Inbox")}
              className="text-sm text-emerald-700 font-semibold"
            >
              View all <ChevronRight size={15} className="inline" />
            </button>
          </div>
          <div>
            {(data?.recent || []).slice(0, 6).map((p: any) => (
              <div
                key={p.id}
                className="px-5 py-4 flex items-center justify-between border-b last:border-0 border-slate-50"
              >
                <div>
                  <div className="font-medium mono text-sm">{p.externalId}</div>
                  <div className="text-xs text-slate-400 mt-1">
                    {p.platform?.name} Â· {p.destination}
                  </div>
                </div>
                <Badge
                  tone={
                    p.status.includes("DELIVER")
                      ? "green"
                      : p.status.includes("SHORT")
                        ? "amber"
                        : "blue"
                  }
                >
                  {p.status.replaceAll("_", " ")}
                </Badge>
              </div>
            ))}
          </div>
        </div>
        <div className="bg-ink text-white rounded-2xl p-6">
          <div className="flex justify-between">
            <div>
              <h3 className="font-semibold">Warehouse pulse</h3>
              <p className="text-xs text-slate-400 mt-1">
                Allocatable stock by location
              </p>
            </div>
            <WarehouseIcon className="text-emerald-300" />
          </div>
          {(data?.inventory || []).slice(0, 4).map((r: any) => (
            <div key={r.id} className="mt-7">
              <div className="flex justify-between text-sm">
                <span>{r.warehouse.name}</span>
                <span
                  className={
                    r.allocatable < 10 ? "text-red-300" : "text-emerald-300"
                  }
                >
                  {r.allocatable} available
                </span>
              </div>
              <div className="h-1.5 bg-white/10 rounded-full mt-2">
                <div
                  className="h-full bg-emerald-300 rounded-full"
                  style={{ width: `${Math.min(100, r.allocatable)}%` }}
                />
              </div>
              <div className="text-xs text-slate-500 mt-1">
                {r.sku.code} Â· threshold {r.threshold}
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
function Section({
  title,
  children,
  action,
}: {
  title: string;
  children: any;
  action?: any;
}) {
  return (
    <div className="panel overflow-x-auto">
      <div className="p-5 border-b border-slate-100 flex justify-between items-center">
        <h3 className="font-semibold">{title}</h3>
        {action}
      </div>
      {children}
    </div>
  );
}
async function exportPurchaseOrders(pos: PO[]) {
  const ExcelJS = (await import("exceljs")).default;
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Novel SCM";
  workbook.created = new Date();

  const poSheet = workbook.addWorksheet("Purchase orders");
  poSheet.columns = [
    { header: "PO number", key: "poNumber", width: 20 },
    { header: "Vendor / customer", key: "vendor", width: 28 },
    { header: "Platform", key: "platform", width: 18 },
    { header: "PO date", key: "poDate", width: 14 },
    { header: "Deadline", key: "deadline", width: 22 },
    { header: "Source warehouse", key: "sourceWarehouse", width: 24 },
    { header: "Source location code", key: "sourceLocation", width: 20 },
    { header: "Destination facility", key: "destinationFacility", width: 28 },
    { header: "FC code", key: "fcCode", width: 16 },
    { header: "FC city", key: "fcCity", width: 18 },
    { header: "Destination address", key: "destinationAddress", width: 40 },
    { header: "Lead time (hours)", key: "leadTime", width: 18 },
    { header: "Status", key: "status", width: 24 },
    { header: "Appointment status", key: "appointmentStatus", width: 22 },
    { header: "Appointment date", key: "appointmentDate", width: 22 },
    { header: "Reserved quantity", key: "reserved", width: 18 },
    { header: "Dispatched quantity", key: "dispatched", width: 20 },
    { header: "Delivered quantity", key: "delivered", width: 18 },
    { header: "Shortage quantity", key: "shortage", width: 18 },
    { header: "Shipment count", key: "shipments", width: 16 },
    { header: "Invoice number", key: "invoice", width: 20 },
  ];
  for (const po of pos) {
    const lines = po.lines || [];
    const shipments = po.shipments || [];
    poSheet.addRow({
      poNumber: po.externalId || po.external_id,
      vendor: po.customer || po.customer_name || "",
      platform: po.platform?.name || po.platform?.code,
      poDate: po.poDate || po.po_date || "",
      deadline: po.deadline || "",
      sourceWarehouse: po.warehouse?.name || po.warehouse?.code || "",
      sourceLocation: po.warehouse?.code || "",
      destinationFacility: po.destinationFacility?.name || po.destinationFacility?.code || "",
      fcCode: po.destinationFacility?.fc_code || po.destinationFacility?.fcCode || "",
      fcCity: po.destinationCity || po.destinationFacility?.city || "",
      destinationAddress: po.destinationAddress || po.destination || "",
      leadTime: po.route?.transit_hours || "",
      status: po.status || "",
      appointmentStatus: po.appointment?.status || "Pending",
      appointmentDate: po.appointment?.appointmentAt || "",
      reserved: lines.reduce((sum: number, line: any) => sum + Number(line.allocated || line.reserved || 0), 0),
      dispatched: lines.reduce((sum: number, line: any) => sum + Number(line.dispatched || 0), 0),
      delivered: lines.reduce((sum: number, line: any) => sum + Number(line.delivered || 0), 0),
      shortage: po.shortage || 0,
      shipments: shipments.length,
      invoice: po.invoice?.invoice_number || po.invoice?.invoiceNumber || "",
    });
  }

  const lineSheet = workbook.addWorksheet("PO lines");
  lineSheet.columns = [
    { header: "PO number", key: "poNumber", width: 20 },
    { header: "SKU", key: "sku", width: 24 },
    { header: "SKU name", key: "skuName", width: 32 },
    { header: "Ordered", key: "ordered", width: 14 },
    { header: "Reserved", key: "reserved", width: 14 },
    { header: "Dispatched", key: "dispatched", width: 14 },
    { header: "Delivered", key: "delivered", width: 14 },
    { header: "Short", key: "short", width: 12 },
    { header: "Damaged", key: "damaged", width: 12 },
    { header: "Rejected", key: "rejected", width: 12 },
  ];
  for (const po of pos) for (const line of po.lines || []) {
    lineSheet.addRow({
      poNumber: po.externalId || po.external_id,
      sku: line.sku?.code || line.sku_id || "",
      skuName: line.sku?.name || "",
      ordered: line.ordered || 0,
      reserved: line.allocated || line.reserved || 0,
      dispatched: line.dispatched || 0,
      delivered: line.delivered || 0,
      short: line.short || line.shortage || 0,
      damaged: line.damaged || 0,
      rejected: line.rejected || 0,
    });
  }

  const shipmentSheet = workbook.addWorksheet("Shipments");
  shipmentSheet.columns = [
    { header: "PO number", key: "poNumber", width: 20 },
    { header: "Shipment number", key: "shipmentNumber", width: 22 },
    { header: "Status", key: "status", width: 22 },
    { header: "Source warehouse", key: "sourceWarehouse", width: 24 },
    { header: "Destination", key: "destination", width: 34 },
    { header: "Planned dispatch", key: "plannedDispatch", width: 22 },
    { header: "Actual dispatch", key: "actualDispatch", width: 22 },
    { header: "Expected arrival", key: "expectedArrival", width: 22 },
    { header: "Actual arrival", key: "actualArrival", width: 22 },
  ];
  for (const po of pos) for (const shipment of po.shipments || []) {
    shipmentSheet.addRow({
      poNumber: po.externalId || po.external_id,
      shipmentNumber: shipment.shipment_number || shipment.shipmentNumber || "",
      status: shipment.status || "",
      sourceWarehouse: po.warehouse?.name || po.warehouse?.code || "",
      destination: shipment.destination_name || shipment.destinationName || po.destination || "",
      plannedDispatch: shipment.planned_dispatch_at || shipment.plannedDispatchAt || "",
      actualDispatch: shipment.actual_dispatch_at || shipment.actualDispatchAt || "",
      expectedArrival: shipment.expected_arrival_at || shipment.expectedArrivalAt || "",
      actualArrival: shipment.actual_arrival_at || shipment.actualArrivalAt || "",
    });
  }
  for (const sheet of [poSheet, lineSheet, shipmentSheet]) {
    sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
    sheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF17324D" } };
    sheet.views = [{ state: "frozen", ySplit: 1 }];
    sheet.autoFilter = { from: "A1", to: `${String.fromCharCode(64 + Math.min(sheet.columnCount, 26))}1` };
  }
  const bytes = await workbook.xlsx.writeBuffer();
  const blob = new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `scm-po-export-${new Date().toISOString().slice(0, 10)}.xlsx`;
  link.click();
  URL.revokeObjectURL(url);
}
function Inbox({
  pos,
  query,
  onSelect,
  onAction,
  onRefresh,
  canApprove,
}: {
  pos: PO[];
  query: string;
  onSelect: (p: PO) => void;
  onAction: Function;
  onRefresh: Function;
  canApprove: boolean;
}) {
  const [show, setShow] = useState(false),
    [filters, setFilters] = useState<PoFilters>(emptyPoFilters);
  const filteredPos = useMemo(() => filterPos(pos, query, filters), [pos, query, filters]);
  const activeFilterCount = Object.values(filters).filter(Boolean).length;
  const updateFilter = (key: keyof PoFilters, value: string) => setFilters(current => ({ ...current, [key]: value }));
  const clearFilters = () => setFilters(emptyPoFilters());
  const statuses = [...new Set(pos.map(p => p.status).filter(Boolean))];
  const platforms = pos.map(p => p.platform).filter((p: any, index: number, list: any[]) => p?.id && list.findIndex(x => x?.id === p.id) === index);
  const warehouses = pos.map(p => p.warehouse).filter((w: any, index: number, list: any[]) => w?.id && list.findIndex(x => x?.id === w.id) === index);
  return (
    <>
      <div className="flex justify-between items-end mb-7">
        <div>
          <p className="text-sm text-slate-500">Document-led intake</p>
          <h2 className="text-3xl font-semibold mt-2">Purchase order inbox</h2>
        </div>
        <UiButton onClick={() => setShow(true)} className="bg-ink text-white">
          <UploadCloud size={16} />
          Upload purchase order
        </UiButton>
      </div>
      <Section title={`${filteredPos.length} of ${pos.length} purchase orders`} action={
        <div className="flex items-center gap-4">
          <button onClick={() => exportPurchaseOrders(filteredPos)} disabled={!filteredPos.length} className="inline-flex items-center gap-1 text-sm font-semibold text-emerald-700 disabled:text-slate-300">
            <Download size={14} /> Export Excel
          </button>
          <button onClick={clearFilters} disabled={!activeFilterCount} className="text-sm font-semibold text-emerald-700 disabled:text-slate-300">
            Clear filters{activeFilterCount ? ` (${activeFilterCount})` : ''}
          </button>
        </div>
      }>
        <div className="grid gap-3 border-b border-slate-100 bg-white p-5 md:grid-cols-3 lg:grid-cols-4">
          <select aria-label="Filter by status" className="rounded-lg border border-slate-200 px-3 py-2 text-sm" value={filters.status} onChange={e => updateFilter('status', e.target.value)}>
            <option value="">All statuses</option>{statuses.map(status => <option key={status} value={status}>{status.replaceAll('_', ' ')}</option>)}
          </select>
          <select aria-label="Filter by platform" className="rounded-lg border border-slate-200 px-3 py-2 text-sm" value={filters.platform} onChange={e => updateFilter('platform', e.target.value)}>
            <option value="">All platforms</option>{platforms.map((platform: any) => <option key={platform.id} value={platform.id}>{platform.name}</option>)}
          </select>
          <select aria-label="Filter by warehouse" className="rounded-lg border border-slate-200 px-3 py-2 text-sm" value={filters.warehouse} onChange={e => updateFilter('warehouse', e.target.value)}>
            <option value="">All warehouses</option>{warehouses.map((warehouse: any) => <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>)}
          </select>
          <select aria-label="Filter by appointment" className="rounded-lg border border-slate-200 px-3 py-2 text-sm" value={filters.appointment} onChange={e => updateFilter('appointment', e.target.value)}>
            <option value="">All appointments</option><option value="PENDING">Pending</option><option value="BOOKED">Booked</option><option value="MISSING_DOCUMENT">Missing document</option>
          </select>
          <select aria-label="Filter by stock exception" className="rounded-lg border border-slate-200 px-3 py-2 text-sm" value={filters.exception} onChange={e => updateFilter('exception', e.target.value)}>
            <option value="">All stock states</option><option value="NO_SHORTAGE">No shortage</option><option value="SHORTAGE">Shortage</option>
          </select>
          <label className="text-xs text-slate-500">PO date from<input aria-label="PO date from" type="date" className="mt-1 block w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700" value={filters.from} onChange={e => updateFilter('from', e.target.value)} /></label>
          <label className="text-xs text-slate-500">PO date to<input aria-label="PO date to" type="date" className="mt-1 block w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700" value={filters.to} onChange={e => updateFilter('to', e.target.value)} /></label>
        </div>
        <div className="overflow-x-auto">
        <div className="grid min-w-[760px] grid-cols-[1fr_1.2fr_1.2fr_1fr_140px] text-xs uppercase tracking-wide text-slate-400 px-5 py-3 bg-slate-50">
          <span>PO ID</span>
          <span>Platform / destination</span>
          <span>Warehouse</span>
          <span>Status</span>
          <span></span>
        </div>
        {filteredPos.map((p) => (
          <div
            key={p.id}
            onClick={() => onSelect(p)}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect(p); } }}
            role="button"
            tabIndex={0}
            className="grid min-w-[760px] grid-cols-[1fr_1.2fr_1.2fr_1fr_140px] items-center px-5 py-4 border-t border-slate-50 hover:bg-slate-50 cursor-pointer"
          >
            <div className="mono text-sm font-semibold">{p.externalId}</div>
            <div>
              <div className="text-sm">{p.platform?.name}</div>
              <div className="text-xs text-slate-400">{p.destination}</div>
            </div>
            <div className="text-sm">
              {p.warehouse?.name || <Badge tone="red">Mapping required</Badge>}
            </div>
            <div>
              <Badge
                tone={
                  p.status === "ACCEPTED"
                    ? "green"
                    : p.status.includes("SHORT")
                      ? "amber"
                      : p.status === "REJECTED"
                        ? "red"
                        : "blue"
                }
              >
                {p.status.replaceAll("_", " ")}
              </Badge>
            </div>
            <div>
              {canApprove && (p.status === "UNDER_REVIEW" || p.status === "APPOINTMENT_MATCHED_AWAITING_ACCEPTANCE") && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onAction(`/api/pos/${p.id}/accept`);
                    onRefresh();
                  }}
                  className="text-xs text-emerald-700 font-semibold"
                >
                  Accept <CheckCircle2 size={14} className="inline" />
                </button>
              )}
            </div>
          </div>
        ))}
        {filteredPos.length === 0 && <div className="px-5 py-12 text-center text-sm text-slate-500">No purchase orders match the current search and filters.</div>}
        </div>
      </Section>
      {show && (
        <ReviewUploadForm onClose={() => setShow(false)} onAction={onAction} />
      )}
    </>
  );
}
function UploadForm({
  onClose,
  onAction,
}: {
  onClose: () => void;
  onAction: Function;
}) {
  const [body, setBody] = useState<any>({
      platformId: "",
      externalId: "PO-DEMO-001",
      destination: "Bengaluru FC",
      poDate: "2026-10-01",
      totalValue: 0,
      lines: [],
    }),
    [masters, setMasters] = useState<any>({});
  useEffect(() => {
    api("/masters").then(setMasters);
  }, []);
  return (
    <div className="fixed inset-0 bg-black/40 z-20 flex justify-end">
      <div className="bg-white w-[480px] h-full p-7 overflow-auto">
        <div className="flex justify-between">
          <h2 className="text-xl font-semibold">Upload purchase order</h2>
          <button onClick={onClose}>
            <XCircle />
          </button>
        </div>
        <p className="text-sm text-slate-500 mt-2">
          Document extraction is reviewed before acceptance.
        </p>
        <div className="mt-7 border-2 border-dashed border-slate-200 rounded-2xl p-8 text-center text-slate-400">
          <UploadCloud className="mx-auto" />
          <p className="text-sm mt-2">Drop a PO document here</p>
          <p className="text-xs mt-1">or enter extracted values manually</p>
        </div>
        <label className="block text-sm mt-6">
          Platform
          <select
            className="mt-2 w-full border rounded-lg p-3"
            value={body.platformId}
            onChange={(e) => setBody({ ...body, platformId: e.target.value })}
          >
            <option value="">Select platform</option>
            {(masters.platforms || []).filter((x: any) => x.active !== false).map((x: any) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm mt-4">
          PO ID
          <input
            className="mt-2 w-full border rounded-lg p-3 mono"
            value={body.externalId}
            onChange={(e) => setBody({ ...body, externalId: e.target.value })}
          />
        </label>
        <label className="block text-sm mt-4">
          Destination
          <input
            className="mt-2 w-full border rounded-lg p-3"
            value={body.destination}
            onChange={(e) => setBody({ ...body, destination: e.target.value })}
          />
        </label>
        <label className="block text-sm mt-4">
          SKU
          <select
            className="mt-2 w-full border rounded-lg p-3"
            onChange={(e) =>
              setBody({
                ...body,
                lines: [{ skuId: e.target.value, ordered: 10, unitPrice: 0 }],
              })
            }
          >
            <option value="">Select SKU</option>
            {(masters.skus || []).map((x: any) => (
              <option key={x.id} value={x.id}>
                {x.code} Â· {x.name}
              </option>
            ))}
          </select>
        </label>
        <button
          onClick={async () => {
            await onAction("/api/pos", body);
            onClose();
          }}
          className="mt-8 w-full bg-ink text-white py-3 rounded-xl font-semibold"
        >
          Create review record
        </button>
      </div>
    </div>
  );
}
function ReviewUploadForm({
  onClose,
  onAction,
}: {
  onClose: () => void;
  onAction: Function;
}) {
  const [masters, setMasters] = useState<any>({}),
    [platformId, setPlatformId] = useState(""),
    [file, setFile] = useState<File | null>(null),
    [scan, setScan] = useState<any>(null),
    [body, setBody] = useState<any>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [reviewConfirmed, setReviewConfirmed] = useState(false);
  useEffect(() => {
    api("/masters").then(setMasters);
  }, []);
  const scanFile = async () => {
    if (!file || !platformId) {
      setError(`Select a platform and ${DOCUMENT_FORMATS} file first.`);
      return;
    }
    setBusy(true);
    setError("");
    try {
      const { form, warning } = await prepareDocumentUpload(file);
      const r = await fetch(`${API}/api/documents/extract`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${localStorage.getItem("scm_token")}`,
        },
        body: form,
      });
      const x = await r.json();
      if (!r.ok) throw new Error(x.message || "Could not scan file");
      setReviewConfirmed(false);
      const extractionWarning = x.extraction?.method === "rules"
        ? `AI extraction was unavailable (${x.extraction.fallbackReason || "unknown error"}). Review the fallback result.`
        : "";
      const extractionWarnings = [...(x.warnings || []), warning, extractionWarning].filter(Boolean);
      setScan({ ...x, warnings: extractionWarnings });
      if (extractionWarnings.length) setError(extractionWarnings.join(" "));
      const extracted = x.extracted || {};
      const destinationKey = extracted.fcCode || extracted.destination || extracted.destinationCity || "";
      const mappedSource = uniqueDestinationMapping(masters.mappings || [], platformId, destinationKey);
      const skuValue = (sku: any, key: string) => String(sku?.[key] || "").trim().toLowerCase();
      const extractedLines = (extracted.lines || []).map((line: any) => {
        const identifiers = [line.channelItemCode, line.asin, line.ean].filter(Boolean).map((value: any) => String(value).trim().toLowerCase());
        const matched = (masters.skus || []).find((sku: any) =>
          ["code", "sku", "sku_code", "channel_item_code", "asin", "ean"].some(key => identifiers.includes(skuValue(sku, key)))
        ) || (line.itemId ? (masters.skus || []).find((sku: any) => sku.id === line.itemId) : null) || (line.description ? (masters.skus || []).find((sku: any) => skuValue(sku, "name") === skuValue(line, "description")) : null);
        return { skuId: line.itemId || matched?.id || "", ordered: Number(line.ordered ?? line.approved ?? line.pending ?? 0), unitPrice: Number(line.unitPrice ?? 0), channelItemCode: line.asin || line.channelItemCode || line.ean || "", sourceCode: line.asin || line.channelItemCode || line.ean || line.description || "" };
      });
      setBody({
        platformId,
        externalId: extracted.externalId || "",
        destination: destinationKey,
        destinationName: extracted.destinationAddress || extracted.destination || extracted.destinationCity || extracted.fcCode || "",
        destinationAddress: extracted.destinationAddress || extracted.destination || "",
        destinationCity: extracted.destinationCity || "",
        sourceAddress: extracted.sourceAddress || "",
        sourceCity: extracted.sourceCity || "",
        sourceWarehouseId: mappedSource?.source_site_id || uniqueWarehouseId(masters.warehouses || [], extracted.sourceCity || "", extracted.sourcePostalCode || ""),
        sourceLocationId: mappedSource?.source_location_id || "",
        sourceState: extracted.sourceState || "",
        sourcePostalCode: extracted.sourcePostalCode || "",
        destinationState: extracted.destinationState || "",
        destinationPostalCode: extracted.destinationPostalCode || "",
        poDate: extracted.poDate || "",
        deadline: extracted.expiryDate ? `${extracted.expiryDate}T00:00` : "",
        customer: extracted.customer || extracted.supplier || "",
        totalValue: Number(extracted.totalValue || 0),
        lines: extractedLines,
        document: {
          filename: file.name,
          path: x.file,
          sha256: x.sha256,
          extracted: x.extracted,
          confidence: x.confidence,
        },
      });
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  const startManualEntry = () => {
    setError("");
    setFile(null);
    setScan({ confidence: 0, manual: true });
    setReviewConfirmed(true);
    setBody({ platformId, externalId: "", destination: "", destinationName: "", destinationAddress: "", destinationCity: "", sourceAddress: "", sourceCity: "", sourceWarehouseId: "", sourceLocationId: "", sourceState: "", sourcePostalCode: "", destinationState: "", destinationPostalCode: "", poDate: "", deadline: "", customer: "", totalValue: 0, lines: [] });
  };
  const addLine = () =>
    setBody((b: any) => ({
      ...b,
      lines: [...(b.lines || []), { skuId: "", ordered: "", unitPrice: "" }],
    }));
  const reviewWarnings = scan?.manual ? [] : [...(scan?.warnings || []), Number(scan?.confidence || 0) < 0.8 ? "Extraction confidence is below 80%; verify the document fields manually." : ""].filter(Boolean);
  const save = async () => {
    if (reviewWarnings.length && !reviewConfirmed) {
      setError("Review the extraction warnings and confirm the corrected values before saving.");
      return;
    }
    const lines = (body.lines || []).map((line: any) => ({
      ...line,
      ordered: Number(line.ordered),
      unitPrice: line.unitPrice === "" || line.unitPrice == null ? 0 : Number(line.unitPrice),
    }));
    if (
      !body.externalId ||
      !body.poDate ||
      !body.destination ||
      !lines.length ||
      lines.some((l: any) => !l.skuId || !Number.isFinite(l.ordered) || l.ordered <= 0 || !Number.isFinite(l.unitPrice) || l.unitPrice < 0)
    ) {
      setError(
        "Complete PO ID, date, destination, and at least one valid SKU line.",
      );
      return;
    }
    setBusy(true);
    const saved = await onAction("/api/pos", { ...body, lines });
    setBusy(false);
    if (saved) onClose();
  };
  return (
    <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/40 p-3 sm:p-5">
      <UiCard className="max-h-[96vh] w-full max-w-[min(1600px,96vw)] overflow-auto">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <div className="text-xs font-semibold uppercase tracking-widest text-emerald-600">
                Document intake
              </div>
              <h2 className="mt-1 text-2xl font-semibold">
                {scan
                  ? "Review scanned purchase order"
                  : "Upload purchase order"}
              </h2>
              <p className="mt-1 text-sm text-slate-500">
                {scan
                  ? "Correct the extracted values before saving the PO."
                  : `Upload ${DOCUMENT_FORMATS} files up to 10 MB. Details are added in the review step.`}
              </p>
            </div>
            <button onClick={onClose}>
              <XCircle />
            </button>
          </div>
        </CardHeader>
        <CardContent>
          {!scan ? (
            <div className="mx-auto max-w-xl py-8">
              <UiLabel>
                Source platform
                <select
                  className="mt-2 w-full rounded-xl border border-slate-200 p-3"
                  value={platformId}
                  onChange={(e) => setPlatformId(e.target.value)}
                >
                  <option value="">Select platform</option>
                  {(masters.platforms || []).filter((x: any) => x.active !== false).map((x: any) => (
                    <option key={x.id} value={x.id}>
                      {x.name}
                    </option>
                  ))}
                </select>
              </UiLabel>
              <label className="mt-6 flex min-h-52 cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed border-slate-200 bg-slate-50 text-center hover:border-emerald-400">
                <UploadCloud className="text-emerald-600" size={28} />
                <span className="mt-3 text-sm font-semibold">
                  {file ? file.name : `Choose PO ${DOCUMENT_FORMATS}`}
                </span>
                <span className="mt-1 text-xs text-slate-400">
                  10 MB maximum
                </span>
                <input
                  type="file"
                  accept={DOCUMENT_ACCEPT}
                  className="hidden"
                  onChange={(e) => {
                    const selected = e.target.files?.[0] || null;
                    if (!selected) return setFile(null);
                    try {
                      validateDocumentFile(selected);
                      setFile(selected);
                      setError("");
                    } catch (cause: any) {
                      setFile(null);
                      setError(cause.message);
                      e.target.value = "";
                    }
                  }}
                />
              </label>
              {error && (
                <UiAlert className="mt-5">
                  <AlertTriangle className="mr-2 inline" size={16} />
                  {error}
                </UiAlert>
              )}
              <UiButton
                disabled={busy || !file || !platformId}
                onClick={scanFile}
                className="mt-6 w-full bg-ink text-white"
              >
                {busy ? "Scanning file..." : "Scan and open review"}
              </UiButton>
              <button type="button" onClick={startManualEntry} disabled={!platformId || busy} className="mt-3 w-full rounded-xl border border-slate-200 px-4 py-3 text-sm font-semibold text-slate-700 hover:border-emerald-400 disabled:opacity-50">
                Enter PO manually
              </button>
            </div>
          ) : (
            <div>
              <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
                <div>
                  <UiCard>
                    <CardHeader>
                      <div className="flex items-center justify-between">
                        <div>
                          <h3 className="font-semibold">Extracted PO fields</h3>
                          <p className="mt-1 text-xs text-slate-400">
                            Every value below is editable before save.
                          </p>
                        </div>
                        <div className="w-28">
                          <div className="mb-1 text-right text-xs text-slate-400">
                            Confidence{" "}
                            {Math.round((scan.confidence || 0) * 100)}%
                          </div>
                          <UiProgress value={(scan.confidence || 0) * 100} />
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent>
                      <div className="grid gap-4 sm:grid-cols-2">
                        <UiLabel>
                          PO ID
                          <UiInput
                            className="mt-2 mono"
                            value={body.externalId}
                            onChange={(e) =>
                              setBody({ ...body, externalId: e.target.value })
                            }
                          />
                        </UiLabel>
                        <UiLabel>
                          PO date
                          <UiInput
                            type="date"
                            className="mt-2"
                            value={body.poDate}
                            onChange={(e) =>
                              setBody({ ...body, poDate: e.target.value })
                            }
                          />
                        </UiLabel>
                        <UiLabel>
                          Destination
                          <UiInput
                            className="mt-2"
                            value={body.destination}
                            onChange={(e) =>
                              setBody({ ...body, destination: e.target.value })
                            }
                          />
                        </UiLabel>
                        <UiLabel>
                          Source address
                          <UiInput
                            className="mt-2"
                            value={body.sourceAddress || ""}
                            placeholder="Not extracted"
                            onChange={(e) => setBody({ ...body, sourceAddress: e.target.value })}
                          />
                        </UiLabel>
                        <UiLabel>
                          Source warehouse
                          <select
                            className="mt-2 w-full rounded-xl border border-slate-200 p-3"
                            value={body.sourceWarehouseId || ""}
                            onChange={(e) => setBody({ ...body, sourceWarehouseId: e.target.value, sourceLocationId: "", sourceCity: (masters.warehouses || []).find((warehouse: any) => warehouse.id === e.target.value)?.city || body.sourceCity || "" })}
                          >
                            <option value="">Select source warehouse</option>
                            {(masters.warehouses || []).filter((warehouse: any) => warehouse.active !== false).map((warehouse: any) => <option key={warehouse.id} value={warehouse.id}>{warehouse.code} · {warehouse.name} · {warehouse.city}</option>)}
                          </select>
                        </UiLabel>
                        <UiLabel>
                          Stock location
                          <select
                            className="mt-2 w-full rounded-xl border border-slate-200 p-3"
                            value={body.sourceLocationId || ""}
                            onChange={(e) => setBody({ ...body, sourceLocationId: e.target.value })}
                            disabled={!body.sourceWarehouseId}
                          >
                            <option value="">Auto-select warehouse stock location</option>
                            {(masters.locations || []).filter((location: any) => location.site_id === body.sourceWarehouseId && location.active !== false && location.virtual !== true).map((location: any) => <option key={location.id} value={location.id}>{location.code} · {location.name}</option>)}
                          </select>
                        </UiLabel>
                        <UiLabel>
                          Source city
                          <UiInput
                            className="mt-2"
                            value={body.sourceCity || ""}
                            placeholder="Filled from warehouse"
                            onChange={(e) => setBody({ ...body, sourceCity: e.target.value })}
                          />
                        </UiLabel>
                        <UiLabel>
                          Destination address
                          <UiInput
                            className="mt-2"
                            value={body.destinationAddress || ""}
                            placeholder="Not extracted"
                            onChange={(e) => setBody({ ...body, destinationAddress: e.target.value })}
                          />
                        </UiLabel>
                        <UiLabel>
                          Destination city
                          <UiInput
                            className="mt-2"
                            value={body.destinationCity || ""}
                            placeholder="Not extracted"
                            onChange={(e) => setBody({ ...body, destinationCity: e.target.value, destination: e.target.value || body.destination })}
                          />
                        </UiLabel>
                        <UiLabel>
                          Booking deadline
                          <UiInput
                            type="datetime-local"
                            className="mt-2"
                            value={body.deadline}
                            onChange={(e) =>
                              setBody({ ...body, deadline: e.target.value })
                            }
                          />
                        </UiLabel>
                        <UiLabel>
                          Customer / vendor
                          <UiInput
                            className="mt-2"
                            value={body.customer}
                            onChange={(e) =>
                              setBody({ ...body, customer: e.target.value })
                            }
                          />
                        </UiLabel>
                        <UiLabel>
                          Total PO value
                          <UiInput
                            type="number"
                            className="mt-2"
                            value={body.totalValue}
                            onChange={(e) =>
                              setBody({
                                ...body,
                                totalValue: Number(e.target.value),
                              })
                            }
                          />
                        </UiLabel>
                      </div>
                    </CardContent>
                  </UiCard>
                  <UiCard className="mt-5">
                    <CardHeader>
                      <div className="flex items-center justify-between">
                        <div>
                          <h3 className="font-semibold">PO lines</h3>
                          <p className="mt-1 text-xs text-slate-400">
                            Add or correct the scanned quantities.
                          </p>
                        </div>
                        <UiButton
                          onClick={addLine}
                          className="bg-emerald-100 text-emerald-700"
                        >
                          <Plus size={15} />
                          Add SKU
                        </UiButton>
                      </div>
                    </CardHeader>
                    <CardContent>
                      <div className="mb-2 hidden grid-cols-[minmax(0,1fr)_150px_150px_32px] gap-3 px-3 text-xs font-semibold uppercase tracking-wide text-slate-400 sm:grid">
                        <span>SKU</span>
                        <span>Quantity</span>
                        <span>Unit price</span>
                        <span />
                      </div>
                      <div className="space-y-3">
                          {(body.lines || []).map((l: any, i: number) => {
                            const selectedSku = (masters.skus || []).find((sku: any) => sku.id === l.skuId);
                            return (
                          <div
                            key={i}
                            className="grid gap-3 rounded-xl bg-slate-50 p-3 sm:grid-cols-[minmax(0,1fr)_150px_150px_32px]"
                          >
                            <div className="min-w-0">
                              <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
                                <div className="mono truncate text-sm font-semibold text-slate-800">{l.sourceCode || "Platform code not provided"}</div>
                                <div className="mt-1 truncate text-xs text-slate-500">{selectedSku?.name || "Product mapping required"}</div>
                              </div>
                              <select
                              aria-label="Change internal product mapping"
                              className="mt-2 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-500"
                              value={l.skuId}
                              onChange={(e) => {
                                const lines = [...body.lines];
                                lines[i] = { ...l, skuId: e.target.value };
                                setBody({ ...body, lines });
                              }}
                              >
                              <option value="">Change product mapping</option>
                              {(masters.skus || []).map((s: any) => (
                                <option key={s.id} value={s.id}>
                                  {s.name}
                                </option>
                              ))}
                              </select>
                            </div>
                            <UiInput
                              type="number"
                              placeholder="Qty"
                              value={l.ordered ?? ""}
                              onChange={(e) => {
                                const lines = [...body.lines];
                                lines[i] = {
                                  ...l,
                                  ordered: e.target.value,
                                };
                                setBody({ ...body, lines });
                              }}
                            />
                            <UiInput
                              type="number"
                              placeholder="Unit price"
                              value={l.unitPrice ?? ""}
                              onChange={(e) => {
                                const lines = [...body.lines];
                                lines[i] = {
                                  ...l,
                                  unitPrice: e.target.value,
                                };
                                setBody({ ...body, lines });
                              }}
                            />
                            <button
                              onClick={() =>
                                setBody({
                                  ...body,
                                  lines: body.lines.filter(
                                    (_: any, j: number) => j !== i,
                                  ),
                                })
                              }
                            >
                              <XCircle size={18} className="text-slate-400" />
                            </button>
                          </div>
                            );
                          })}
                        {!body.lines.length && (
                          <div className="rounded-xl border border-dashed p-6 text-center text-sm text-slate-400">
                            No lines extracted. Add the PO SKUs here before
                            saving.
                          </div>
                        )}
                      </div>
                    </CardContent>
                  </UiCard>
                </div>
                <div>
                  <UiCard>
                    <CardHeader>
                      <h3 className="font-semibold">Source document</h3>
                      <p className="mt-1 text-xs text-slate-400">
                        {file?.name}
                      </p>
                    </CardHeader>
                    <CardContent>
                      <div className="flex min-h-72 items-center justify-center rounded-xl bg-slate-100 text-center text-sm text-slate-500">
                        <FileSearch className="mx-auto mb-2" />
                        <div>Document stored and ready for review</div>
                      </div>
                      <div className="mt-5 rounded-xl bg-emerald-50 p-4 text-sm text-emerald-800">
                        <MapPin size={16} className="mr-2 inline" />
                        Warehouse mapping will be resolved from the corrected
                        destination.
                      </div>
                      {error && (
                        <UiAlert className="mt-4">
                          <AlertTriangle className="mr-2 inline" size={16} />
                          {error}
                        </UiAlert>
                      )}
                      {reviewWarnings.length > 0 && <label className="mt-4 flex gap-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"><input type="checkbox" checked={reviewConfirmed} onChange={e => setReviewConfirmed(e.target.checked)} className="mt-1" /><span><strong>Extraction warnings reviewed.</strong><span className="mt-1 block">I confirm the source, destination, PO number, and quantities are correct.</span></span></label>}
                      <UiButton
                        disabled={busy}
                        onClick={save}
                        className="mt-5 w-full bg-ink text-white"
                      >
                        {busy ? "Saving..." : "Save reviewed PO"}
                      </UiButton>
                      <UiButton
                        onClick={() => {
                          setScan(null);
                          setBody(null);
                          setError("");
                        }}
                        className="mt-2 w-full bg-slate-100 text-slate-700"
                      >
                        Back to upload
                      </UiButton>
                    </CardContent>
                  </UiCard>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </UiCard>
    </div>
  );
}
function Inventory({ rows, onAction }: { rows: any[]; onAction: Function }) {
  return (
    <>
      <div className="flex justify-between items-end mb-7">
        <div>
          <p className="text-sm text-slate-500">
            Protected stock and reservations
          </p>
          <h2 className="text-3xl font-semibold mt-2">Inventory</h2>
        </div>
        <button className="bg-ink text-white px-4 py-3 rounded-xl text-sm font-semibold">
          <Plus size={16} className="inline mr-2" />
          Add stock
        </button>
      </div>
      <Section title="Warehouse balances">
        <div className="grid min-w-[760px] grid-cols-6 text-xs uppercase tracking-wide text-slate-400 px-5 py-3 bg-slate-50">
          <span>SKU</span>
          <span>Warehouse</span>
          <span>Physical</span>
          <span>Blocked</span>
          <span>In transit</span>
          <span>Allocatable</span>
        </div>
        {rows.map((r) => (
          <div
            className="grid min-w-[760px] grid-cols-6 px-5 py-5 border-t border-slate-50 items-center"
            key={r.id}
          >
            <div className="mono text-sm font-semibold">
              {r.sku.code}
              <div className="text-xs text-slate-400 font-normal mt-1">
                {r.sku.name}
              </div>
            </div>
            <div className="text-sm">{r.warehouse.name}</div>
            <div>{r.physical}</div>
            <div>{r.blocked}</div>
            <div>{r.inTransit}</div>
            <div className="font-semibold text-emerald-700">
              {r.allocatable}
              <div className="text-xs text-slate-400 font-normal">
                threshold {r.threshold}
              </div>
            </div>
          </div>
        ))}
      </Section>
    </>
  );
}
function DetailItem({ label, value }: { label: string; value: React.ReactNode }) {
  return <div className="rounded-xl border border-slate-100 bg-white p-3"><div className="text-xs text-slate-500">{label}</div><div className="mt-1 break-words text-sm font-medium text-slate-800">{value ?? "—"}</div></div>;
}
function displayDate(value: string | null | undefined) {
  return value ? new Date(value).toLocaleString() : "—";
}
function Shipments({ pos, onAction }: { pos: PO[]; onAction: Function }) {
  const [podSelection, setPodSelection] = useState<{ po: PO; shipmentId: string } | null>(null),
    [createShipment, setCreateShipment] = useState(false),
    [expanded, setExpanded] = useState<string | null>(null);
  const items = pos.flatMap((p) =>
      (p.shipments || []).map((s: any) => ({
        ...s,
        externalId: p.externalId,
        po: p,
      })),
    );
  return (
    <>
      <div className="mb-7 flex items-end justify-between">
        <div>
          <p className="text-sm text-slate-500">Truck-level movement</p>
          <h2 className="text-3xl font-semibold mt-2">Shipment tracker</h2>
        </div>
        <button
          onClick={() => setCreateShipment(true)}
          className="rounded-xl bg-ink px-4 py-3 text-sm font-semibold text-white"
        >
          <Plus size={16} className="mr-2 inline" />
          Create shipment
        </button>
      </div>
      <Section title={`${items.length} shipments`}>
        <div className="grid min-w-[680px] grid-cols-5 text-xs uppercase tracking-wide text-slate-400 px-5 py-3 bg-slate-50">
          <span>Shipment</span>
          <span>PO</span>
          <span>Vehicle</span>
          <span>Status</span>
          <span>Details</span>
        </div>
        {items.map((s) => {
          const isExpanded = expanded === s.id;
          const shipmentLines = s.lines || [];
          const totals = shipmentLines.reduce((sum: { planned: number; dispatched: number; delivered: number }, line: any) => ({
            planned: sum.planned + Number(line.planned_quantity || 0),
            dispatched: sum.dispatched + Number(line.dispatched_quantity || 0),
            delivered: sum.delivered + Number(line.delivered_quantity || 0),
          }), { planned: 0, dispatched: 0, delivered: 0 });
          const consignments = (s.po.consignments || []).filter((c: any) => c.shipment_id === s.id);
          const pods = (s.po.pods || []).filter((p: any) => p.shipmentIds?.includes(s.id));
          return <div key={s.id} className="border-t border-slate-100">
            <button type="button" aria-expanded={isExpanded} aria-controls={`shipment-details-${s.id}`} onClick={() => setExpanded(isExpanded ? null : s.id)} className="grid w-full min-w-[680px] grid-cols-5 items-center px-5 py-5 text-left hover:bg-slate-50">
              <span className="flex items-center gap-2 mono text-sm font-semibold">{isExpanded ? <ChevronDown size={16} className="text-slate-400" /> : <ChevronRight size={16} className="text-slate-400" />}{s.number}</span>
              <span className="mono text-sm">{s.externalId}</span>
              <span className="text-sm">{s.truckNumber || "Unassigned"}</span>
              <span><Badge tone={s.status === "DELIVERED" ? "green" : s.status === "IN_TRANSIT" ? "amber" : "blue"}>{s.status.replaceAll("_", " ")}</Badge></span>
              <span className="text-xs font-semibold text-emerald-700">{isExpanded ? "Hide details" : "View details"}</span>
            </button>
            {isExpanded && <div id={`shipment-details-${s.id}`} className="min-w-[680px] border-t border-emerald-100 bg-emerald-50/30 px-5 py-5">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <DetailItem label="Platform" value={s.po.platform?.name || "—"} />
                <DetailItem label="Source warehouse" value={s.po.warehouse?.name || "—"} />
                <DetailItem label="Source" value={[s.sourceAddress, s.sourceCity].filter(Boolean).join(", ") || "—"} />
                <DetailItem label="Destination" value={[s.destinationAddress || s.destination_name, s.destinationCity, s.destinationState, s.destinationPostalCode].filter(Boolean).join(", ") || "—"} />
                <DetailItem label="Truck type" value={s.truck_type || "—"} />
                <DetailItem label="Driver" value={s.driverName || "—"} />
                <DetailItem label="Driver phone" value={s.driverPhone || "—"} />
                <DetailItem label="Planned dispatch" value={displayDate(s.planned_dispatch_at)} />
                <DetailItem label="Actual dispatch" value={displayDate(s.actual_dispatch_at)} />
                <DetailItem label="Expected arrival" value={displayDate(s.expected_arrival_at)} />
                <DetailItem label="Actual arrival" value={displayDate(s.actual_arrival_at)} />
                <DetailItem label="Estimated cost" value={`${s.currency || "INR"} ${Number(s.estimated_cost || 0).toLocaleString()}`} />
              </div>
              <div className="mt-5 text-sm font-semibold">Shipment lines <span className="font-normal text-slate-500">· Planned {totals.planned} · Dispatched {totals.dispatched} · Delivered {totals.delivered}</span></div>
              <div className="mt-2 overflow-x-auto rounded-xl border border-slate-200 bg-white"><table className="w-full min-w-[580px] text-left text-sm"><thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr><th className="px-3 py-2">SKU</th><th>Planned</th><th>Dispatched</th><th>Delivered</th><th>Remaining</th></tr></thead><tbody>{shipmentLines.map((line: any) => { const poLine = (s.po.lines || []).find((item: any) => item.id === line.purchase_order_line_id); return <tr key={line.id} className="border-t border-slate-100"><td className="px-3 py-2">{poLine?.sku?.code || poLine?.sku?.name || "—"}</td><td>{line.planned_quantity}</td><td>{line.dispatched_quantity}</td><td>{line.delivered_quantity}</td><td>{Math.max(0, Number(line.dispatched_quantity || 0) - Number(line.delivered_quantity || 0) - Number(line.damaged_quantity || 0) - Number(line.rejected_quantity || 0))}</td></tr>; })}</tbody></table></div>
              {(s.events || []).length > 0 && <div className="mt-5"><div className="text-sm font-semibold">Movement history</div><div className="mt-2 space-y-2">{[...s.events].sort((a: any, b: any) => Date.parse(a.event_at) - Date.parse(b.event_at)).map((event: any) => <div key={event.id} className="rounded-lg bg-white px-3 py-2 text-sm"><span className="font-medium">{event.status.replaceAll("_", " ")}</span><span className="ml-2 text-slate-500">{displayDate(event.event_at)}{event.location_name ? ` · ${event.location_name}` : ""}</span>{event.notes && <div className="text-slate-600">{event.notes}</div>}</div>)}</div></div>}
              <div className="mt-5 flex flex-wrap items-center gap-4 text-sm"><span className="font-semibold">Files</span>{s.lr_document_version_id && <DocumentLink documentVersionId={s.lr_document_version_id} filename={s.lrFilename} label="View LR" />}{consignments.map((c: any) => <DocumentLink key={c.id} documentVersionId={c.document_version_id} filename={c.filename} label={`View consignment ${c.consignment_number || ""}`} />)}{pods.map((p: any) => <DocumentLink key={p.id} documentVersionId={p.document_version_id} filename={p.filename} label="View POD" />)}{!s.lr_document_version_id && !consignments.length && !pods.length && <span className="text-slate-500">No files attached</span>}</div>
              <div className="mt-5 flex gap-4">{s.status === "PLANNED" && <button onClick={() => onAction(`/api/shipments/${s.id}/dispatch`)} className="text-sm font-semibold text-emerald-700">Dispatch <ArrowUpRight size={14} className="inline" /></button>}{["DISPATCHED", "IN_TRANSIT", "ARRIVED", "UNLOADING", "PARTIALLY_DELIVERED", "DELIVERY_ISSUE"].includes(s.status) && <button onClick={() => setPodSelection({ po: s.po, shipmentId: s.id })} className="text-sm font-semibold text-emerald-700">Confirm POD</button>}</div>
            </div>}
          </div>;
        })}
      </Section>
      {createShipment && (
        <ShipmentPlanModal
          pos={pos}
          onClose={() => setCreateShipment(false)}
          onAction={onAction}
        />
      )}{" "}
      {podSelection && (
        <DocumentWorkflowModal
          apiBase={API}
          mode="pod"
          po={podSelection.po}
          shipmentId={podSelection.shipmentId}
          onClose={() => setPodSelection(null)}
          onSaved={() => location.reload()}
        />
      )}
    </>
  );
}
function Appointments({ pos }: { pos: PO[]; onAction: Function }) {
  const [selected, setSelected] = useState<PO | null>(null),
    [consignmentSelected, setConsignmentSelected] = useState<PO | null>(null),
    [expanded, setExpanded] = useState<Record<string, boolean>>({});
  return (
    <>
      <div className="mb-7">
        <p className="text-sm text-slate-500">
          Booking deadlines and documents
        </p>
        <h2 className="text-3xl font-semibold mt-2">Appointments</h2>
      </div>
      <Section title="Appointment queue">
        <div className="grid min-w-[620px] grid-cols-4 text-xs uppercase tracking-wide text-slate-400 px-5 py-3 bg-slate-50">
          <span>PO</span>
          <span>Destination</span>
          <span>Status</span>
          <span>Appointment</span>
        </div>
        {pos.map((p) => {
          const isExpanded = Boolean(expanded[p.id]);
          return (
            <div key={p.id}>
              <button
                type="button"
                onClick={() => setExpanded((current) => ({ ...current, [p.id]: !current[p.id] }))}
                className="grid min-w-[620px] w-full grid-cols-4 items-center border-t border-slate-50 px-5 py-5 text-left hover:bg-slate-50"
              >
                <span className="flex items-center gap-2 mono text-sm font-semibold">
                  {isExpanded ? <ChevronDown size={15} className="text-slate-400" /> : <ChevronRight size={15} className="text-slate-400" />}
                  {p.externalId}
                </span>
                <span className="text-sm">{p.destination}</span>
                <span>{p.appointment ? <Badge tone="green">{p.appointment.status}</Badge> : <Badge tone="amber">Pending booking</Badge>}</span>
                <span className="text-sm">{p.appointment?.appointmentAt ? new Date(p.appointment.appointmentAt).toLocaleString() : "No appointment attached"}</span>
              </button>
              {isExpanded && (
                <div className="border-t border-emerald-100 bg-emerald-50/30 px-8 py-5">
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    {[['PO status', p.status?.replaceAll('_', ' ') || '—'], ['PO source address', p.sourceAddress || 'Not provided'], ['Appointment source address', p.appointment?.sourceAddress || 'Not attached / not extracted'], ['PO destination address', p.destinationAddress || p.destination || 'Not provided'], ['Appointment destination address', p.appointment?.destinationAddress || 'Not attached / not extracted'], ['Source warehouse', p.warehouse?.name || 'Mapping required'], ['Master warehouse address', p.warehouse?.address_line1 || 'Not mapped'], ['Customer', p.customer || '—'], ['Platform', p.platform?.name || '—'], ['Appointment status', p.appointment?.status || 'Pending booking'], ['Appointment date', p.appointment?.appointmentAt ? new Date(p.appointment.appointmentAt).toLocaleString() : 'Not attached']].map(([label, value]) => (
                      <div key={label} className="rounded-xl bg-white p-3">
                        <div className="text-xs text-slate-400">{label}</div>
                        <div className="mt-1 text-sm font-medium">{value}</div>
                      </div>
                    ))}
                  </div>
                  <div className="mt-4 flex gap-4">
                    <button onClick={() => setSelected(p)} className="text-sm font-semibold text-emerald-700">{p.appointment ? 'Replace appointment' : 'Attach appointment'}</button>
                    {(p.shipments || []).length > 0 && <button onClick={() => setConsignmentSelected(p)} className="text-sm font-semibold text-emerald-700">Attach consignment</button>}
                  </div>
                  {(p.appointment?.files?.length || p.appointmentHistory?.some((appointment: any) => appointment.files?.length) || p.consignments?.length) && <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-sm">
                    {(p.appointment?.files || []).map((file: any) => <DocumentLink key={file.documentVersionId} documentVersionId={file.documentVersionId} filename={file.filename} label={`Appointment: ${file.filename || 'View file'}`} />)}
                    {(p.appointmentHistory || []).flatMap((appointment: any) => (appointment.files || []).map((file: any) => <DocumentLink key={`${appointment.id}-${file.documentVersionId}`} documentVersionId={file.documentVersionId} filename={file.filename} label={`Previous appointment: ${file.filename || 'View file'}`} />))}
                    {(p.consignments || []).map((consignment: any) => <DocumentLink key={consignment.id} documentVersionId={consignment.document_version_id} filename={consignment.filename} label={`Consignment ${consignment.consignment_number}: ${consignment.filename || 'View file'}`} />)}
                  </div>}
                </div>
              )}
            </div>
          );
        })}
      </Section>
      {selected && (
        <DocumentWorkflowModal
          apiBase={API}
          mode="appointment"
          po={selected}
          onClose={() => setSelected(null)}
          onSaved={() => location.reload()}
        />
      )}
      {consignmentSelected && (
        <DocumentWorkflowModal
          apiBase={API}
          mode="consignment"
          po={consignmentSelected}
          onClose={() => setConsignmentSelected(null)}
          onSaved={() => location.reload()}
        />
      )}
    </>
  );
}
function Invoices({ pos, onAction }: { pos: PO[]; onAction: Function }) {
  const [selected, setSelected] = useState<PO | null>(null),
    [shortClose, setShortClose] = useState<PO | null>(null),
    [expanded, setExpanded] = useState<string | null>(null);
  const queue = pos.filter(
    (p) =>
      [
        "FULLY_DELIVERED",
        "SHORT_CLOSED",
        "DELIVERY_ISSUE",
        "PARTIALLY_DELIVERED",
      ].includes(p.status) || p.invoice,
  );
  return (
    <>
      <div className="mb-7">
        <p className="text-sm text-slate-500">One external invoice per PO</p>
        <h2 className="text-3xl font-semibold mt-2">Invoice queue</h2>
      </div>
      <Section title="Delivery and closure queue">
        <div className="grid min-w-[620px] grid-cols-4 text-xs uppercase tracking-wide text-slate-400 px-5 py-3 bg-slate-50">
          <span>PO</span>
          <span>Status</span>
          <span>Invoice</span>
          <span>Details</span>
        </div>
        {queue.map((p) => {
          const isExpanded = expanded === p.id;
          const lines = p.lines || [];
          const ordered = lines.reduce((sum: number, line: any) => sum + Number(line.ordered || 0), 0);
          const delivered = lines.reduce((sum: number, line: any) => sum + Number(line.delivered || 0), 0);
          return <div key={p.id} className="border-t border-slate-100">
            <button type="button" aria-expanded={isExpanded} aria-controls={`invoice-details-${p.id}`} onClick={() => setExpanded(isExpanded ? null : p.id)} className="grid w-full min-w-[620px] grid-cols-4 items-center px-5 py-5 text-left hover:bg-slate-50">
              <span className="flex items-center gap-2 mono text-sm font-semibold">{isExpanded ? <ChevronDown size={16} className="text-slate-400" /> : <ChevronRight size={16} className="text-slate-400" />}{p.externalId}</span>
              <span><Badge tone={["DELIVERY_ISSUE", "PARTIALLY_DELIVERED"].includes(p.status) ? "amber" : "green"}>{p.status.replaceAll("_", " ")}</Badge></span>
              <span className="text-sm">{p.invoice?.invoice_number || "Not uploaded"}</span>
              <span className="text-xs font-semibold text-emerald-700">{isExpanded ? "Hide details" : "View details"}</span>
            </button>
            {isExpanded && <div id={`invoice-details-${p.id}`} className="min-w-[620px] border-t border-emerald-100 bg-emerald-50/30 px-5 py-5">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <DetailItem label="Customer" value={p.customer || "—"} />
                <DetailItem label="Platform" value={p.platform?.name || "—"} />
                <DetailItem label="Destination" value={p.destination || "—"} />
                <DetailItem label="Warehouse" value={p.warehouse?.name || "—"} />
                <DetailItem label="PO value" value={`INR ${Number(p.totalValue || 0).toLocaleString()}`} />
                <DetailItem label="Delivery" value={`${delivered} of ${ordered} units`} />
                <DetailItem label="Shipments" value={(p.shipments || []).length} />
                <DetailItem label="PO status" value={p.status.replaceAll("_", " ")} />
              </div>
              <div className="mt-5 text-sm font-semibold">Invoice details</div>
              {p.invoice ? <div className="mt-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <DetailItem label="Invoice number" value={p.invoice.invoice_number} />
                <DetailItem label="Invoice date" value={p.invoice.invoice_date || "—"} />
                <DetailItem label="Amount" value={`${p.invoice.currency || "INR"} ${Number(p.invoice.amount || 0).toLocaleString()}`} />
                <DetailItem label="Uploaded" value={displayDate(p.invoice.uploaded_at)} />
                <DetailItem label="Send status" value={p.invoice.send_status?.replaceAll("_", " ") || "—"} />
                <DetailItem label="Sent" value={displayDate(p.invoice.sent_at)} />
              </div> : <p className="mt-2 text-sm text-slate-500">No invoice has been uploaded for this PO.</p>}
              <div className="mt-5 text-sm font-semibold">PO lines</div>
              <div className="mt-2 overflow-x-auto rounded-xl border border-slate-200 bg-white"><table className="w-full min-w-[480px] text-left text-sm"><thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr><th className="px-3 py-2">SKU</th><th>Ordered</th><th>Delivered</th><th>Remaining</th></tr></thead><tbody>{lines.map((line: any) => <tr key={line.id} className="border-t border-slate-100"><td className="px-3 py-2">{line.sku?.code || line.sku?.name || "—"}</td><td>{line.ordered}</td><td>{line.delivered || 0}</td><td>{Math.max(0, Number(line.ordered || 0) - Number(line.delivered || 0))}</td></tr>)}</tbody></table></div>
              <div className="mt-5 flex flex-wrap items-center gap-4">{p.invoice && <DocumentLink documentVersionId={p.invoice.document_version_id} filename={p.invoice.filename} label="View invoice file" />}{!p.invoice && ["FULLY_DELIVERED", "SHORT_CLOSED"].includes(p.status) && <button onClick={() => setSelected(p)} className="text-sm font-semibold text-emerald-700">Upload invoice <UploadCloud size={14} className="inline" /></button>}{!p.invoice && ["DELIVERY_ISSUE", "PARTIALLY_DELIVERED"].includes(p.status) && <button onClick={() => setShortClose(p)} className="text-sm font-semibold text-amber-700">Short close</button>}</div>
            </div>}
          </div>;
        })}
      </Section>
      {selected && (
        <DocumentWorkflowModal
          apiBase={API}
          mode="invoice"
          po={selected}
          onClose={() => setSelected(null)}
          onSaved={() => location.reload()}
        />
      )}{" "}
      {shortClose && (
        <ShortCloseModal
          po={shortClose}
          onClose={() => setShortClose(null)}
          onAction={onAction}
        />
      )}
    </>
  );
}
function AdminModal({ title, children, close }: { title: string; children: any; close: () => void }) {
  return <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/30 p-6"><div className="w-full max-w-xl rounded-2xl bg-white p-6 shadow-xl"><div className="mb-5 flex items-center justify-between"><h3 className="text-lg font-semibold">{title}</h3><button onClick={close}><XCircle size={18}/></button></div>{children}</div></div>;
}
function Masters({ data, onAction }: { data: any; onAction: Function }) {
  const [modal, setModal] = useState<'platform' | 'warehouse' | null>(null), [edit, setEdit] = useState<any>(null), [error, setError] = useState('');
  const destinations = data.destinationFacilities?.length
    ? data.destinationFacilities
    : (Array.from(new Map((data.mappings || []).map((mapping: any) => [mapping.destination_key, mapping])).values()) as any[]);
  const open = (type: 'platform' | 'warehouse', value?: any) => { setError(''); setEdit(value || null); setModal(type); };
  const save = async (path: string, body: any) => { setError(''); const ok = await onAction(path, body, (message: string) => setError(message)); if (ok) { setModal(null); setEdit(null); location.reload(); } };
  const remove = async (path: string) => { if (window.confirm('Delete this record permanently? This will fail if it is already used in historical data.')) await save(path, {}); };
  return <>
    <div className="mb-7"><p className="text-sm text-slate-500">Controlled operational data</p><h2 className="text-3xl font-semibold mt-2">Administration</h2></div>
    <div className="grid gap-5 lg:grid-cols-3">
      <Section title="Platforms" action={<button onClick={() => open('platform')} className="rounded-lg bg-ink px-3 py-2 text-xs font-semibold text-white"><Plus size={14} className="mr-1 inline"/>Add platform</button>}>
        <div className="p-5 space-y-4">{(data.platforms || []).map((x: any) => <div className="flex items-center justify-between gap-3 text-sm" key={x.id}><div><div className="font-medium">{x.name}</div><div className="mono text-xs text-slate-400">{x.code} · {x.channel_type || 'MARKETPLACE'}</div></div><div className="flex items-center gap-2"><Badge tone={x.active === false ? 'slate' : 'green'}>{x.active === false ? 'Inactive' : 'Active'}</Badge><button onClick={() => open('platform', x)} className="text-xs font-semibold text-emerald-700">Edit</button></div></div>)}</div>
      </Section>
       <Section title="Source warehouses" action={<button onClick={() => open('warehouse')} className="rounded-lg bg-ink px-3 py-2 text-xs font-semibold text-white"><Plus size={14} className="mr-1 inline"/>Add warehouse</button>}>
        <div className="p-5 space-y-4">{(data.warehouses || []).map((x: any) => <div className="flex items-center justify-between gap-3 text-sm" key={x.id}><div><div className="font-medium">{x.name}</div><div className="text-xs text-slate-500">{x.city || 'City not set'}{x.state ? ` · ${x.state}` : ''}</div><div className="mono text-xs text-slate-400">{x.code}</div></div><div className="flex items-center gap-2"><Badge tone={x.active === false ? 'slate' : 'green'}>{x.active === false ? 'Inactive' : 'Active'}</Badge><button onClick={() => open('warehouse', x)} className="text-xs font-semibold text-emerald-700">Edit</button></div></div>)}</div>
      </Section>
       <Section title="Destination facilities">
         <div className="p-5 space-y-4">{destinations.length ? destinations.map((x: any) => <div className="text-sm" key={x.id || x.destination_key}><div className="font-medium">{x.name || x.destination_name || x.code || x.destination_key}</div><div className="mono text-xs text-slate-400">{x.fc_code || x.code || x.destination_key}</div><div className="text-xs text-slate-500">{x.city || 'Address not enriched'} · linked destination facility</div></div>) : <p className="text-sm text-slate-500">No destination facilities have been mapped yet.</p>}</div>
       </Section>
       <Section title="Transit routes">
         <div className="p-5 space-y-4">{(data.routes || []).length ? (data.routes || []).map((x: any) => <div className="text-sm" key={x.id}><div className="font-medium">{x.destination_city || x.destination_key}</div><div className="text-xs text-slate-500">{x.transit_hours} hours · {x.currency || 'INR'} {Number(x.estimated_cost || 0).toLocaleString()}</div></div>) : <p className="text-sm text-slate-500">No transit routes configured yet.</p>}</div>
       </Section>
      <Section title="SKUs"><div className="p-5 space-y-4">{(data.skus || []).map((x: any) => <div className="flex justify-between text-sm" key={x.id}><span>{x.name}</span><span className="mono text-xs text-slate-400">{x.code}</span></div>)}</div></Section>
    </div>
    {modal === 'platform' && <AdminModal title={edit ? 'Edit platform' : 'Add platform'} close={() => setModal(null)}><PlatformAdminForm value={edit} error={error} save={(body: any) => save(edit ? `/api/platforms/${edit.id}` : '/api/platforms', body)} remove={() => remove(`/api/platforms/${edit.id}/delete`)} /></AdminModal>}
    {modal === 'warehouse' && <AdminModal title={edit ? 'Edit warehouse' : 'Add warehouse'} close={() => setModal(null)}><WarehouseAdminForm value={edit} error={error} save={(body: any) => save(edit ? `/api/warehouses/${edit.id}` : '/api/warehouses', body)} remove={() => remove(`/api/warehouses/${edit.id}/delete`)} /></AdminModal>}
  </>;
}
function PlatformAdminForm({ value, error, save, remove }: any) { const [v,setV]=useState<any>(value||{channelType:'MARKETPLACE',ingestionMethod:'FILE',active:true}); return <form className="space-y-4" onSubmit={e=>{e.preventDefault();save(v);}}><UiLabel>Platform code<UiInput className="mt-1" required value={v.code||''} onChange={e=>setV({...v,code:e.target.value})}/></UiLabel><UiLabel>Platform name<UiInput className="mt-1" required value={v.name||''} onChange={e=>setV({...v,name:e.target.value})}/></UiLabel><UiLabel>Type<select className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" value={v.channelType||v.channel_type||'MARKETPLACE'} onChange={e=>setV({...v,channelType:e.target.value})}>{['MARKETPLACE','QUICK_COMMERCE','D2C','DISTRIBUTOR','B2B','RETAIL'].map(x=><option key={x}>{x}</option>)}</select></UiLabel><UiLabel>Ingestion method<select className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" value={v.ingestionMethod||v.ingestion_method||'FILE'} onChange={e=>setV({...v,ingestionMethod:e.target.value})}>{['API','FILE','PORTAL_EXPORT','MANUAL'].map(x=><option key={x}>{x}</option>)}</select></UiLabel>{error&&<div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</div>}<div className="flex gap-2"><button className="rounded-lg bg-ink px-4 py-2 text-sm font-semibold text-white">Save platform</button>{value&&<><button type="button" onClick={()=>{if(window.confirm('Deactivate this platform? Existing history will be kept.'))save({active:false});}} className="rounded-lg border border-amber-200 px-4 py-2 text-sm font-semibold text-amber-700">Deactivate</button><button type="button" onClick={remove} className="rounded-lg border border-red-200 px-4 py-2 text-sm font-semibold text-red-700">Delete permanently</button></>}</div></form>; }
function WarehouseAdminForm({ value, error, save, remove }: any) { const [v,setV]=useState<any>(value||{active:true}); return <form className="space-y-4" onSubmit={e=>{e.preventDefault();save(v);}}><div className="grid gap-4 sm:grid-cols-2"><UiLabel>Warehouse code<UiInput className="mt-1" required value={v.code||''} onChange={e=>setV({...v,code:e.target.value})}/></UiLabel><UiLabel>Warehouse name<UiInput className="mt-1" required value={v.name||''} onChange={e=>setV({...v,name:e.target.value})}/></UiLabel><UiLabel>City<UiInput className="mt-1" required value={v.city||''} onChange={e=>setV({...v,city:e.target.value})}/></UiLabel><UiLabel>State<UiInput className="mt-1" value={v.state||''} onChange={e=>setV({...v,state:e.target.value})}/></UiLabel><UiLabel>Address line 1<UiInput className="mt-1" value={v.addressLine1||v.address_line1||''} onChange={e=>setV({...v,addressLine1:e.target.value})}/></UiLabel><UiLabel>Postal code<UiInput className="mt-1" value={v.postalCode||v.postal_code||''} onChange={e=>setV({...v,postalCode:e.target.value})}/></UiLabel></div><UiLabel>Address line 2<UiInput className="mt-1" value={v.addressLine2||v.address_line2||''} onChange={e=>setV({...v,addressLine2:e.target.value})}/></UiLabel>{error&&<div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</div>}<div className="flex gap-2"><button className="rounded-lg bg-ink px-4 py-2 text-sm font-semibold text-white">Save warehouse</button>{value&&<><button type="button" onClick={()=>{if(window.confirm('Deactivate this warehouse? Existing history will be kept.'))save({active:false});}} className="rounded-lg border border-amber-200 px-4 py-2 text-sm font-semibold text-amber-700">Deactivate</button><button type="button" onClick={remove} className="rounded-lg border border-red-200 px-4 py-2 text-sm font-semibold text-red-700">Delete permanently</button></>}</div></form>; }
function Audit() {
  const [rows, setRows] = useState<any[]>([]);
  useEffect(() => {
    api("/audit").then(setRows);
  }, []);
  return (
    <>
      <div className="mb-7">
        <p className="text-sm text-slate-500">Immutable operational history</p>
        <h2 className="text-3xl font-semibold mt-2">Audit log</h2>
      </div>
      <Section title={`${rows.length} recent events`}>
        <div className="grid min-w-[620px] grid-cols-4 text-xs uppercase tracking-wide text-slate-400 px-5 py-3 bg-slate-50">
          <span>Action</span>
          <span>Record</span>
          <span>User</span>
          <span>Time</span>
        </div>
        {rows.map((x) => (
          <div
            className="grid min-w-[620px] grid-cols-4 px-5 py-4 border-t border-slate-50 text-sm"
            key={x.id}
          >
            <span className="font-semibold">{x.action}</span>
            <span className="mono text-xs">
              {x.recordType || x.record_type || "Record"} Â·{" "}
              {String(x.recordId || x.record_id || "").slice(0, 8)}
            </span>
            <span>{x.user?.name || "System"}</span>
            <span className="text-slate-400">
              {new Date(x.createdAt || x.created_at).toLocaleString()}
            </span>
          </div>
        ))}
      </Section>
    </>
  );
}
function Details({
  po,
  onClose,
  onAction,
}: {
  po: PO;
  onClose: () => void;
  onAction: Function;
}) {
  return (
    <div className="fixed inset-0 bg-black/30 z-20 flex justify-end">
      <div className="bg-white w-[560px] h-full p-8 overflow-auto">
        <div className="flex justify-between">
          <div>
            <div className="mono text-sm text-slate-400">
              {po.platform?.name}
            </div>
            <h2 className="text-2xl font-semibold mt-2">{po.externalId}</h2>
          </div>
          <button onClick={onClose}>
            <XCircle />
          </button>
        </div>
        <div className="mt-6">
          <Badge tone="blue">{po.status.replaceAll("_", " ")}</Badge>
          <div className="grid grid-cols-2 gap-4 mt-6">
            {[
              ["Source address", po.appointment?.sourceAddress || po.sourceAddress || po.warehouse?.address || "Not extracted"],
              ["Source city", po.appointment?.sourceCity || po.sourceCity || po.warehouse?.city || "Not resolved"],
              ["Destination address", po.appointment?.destinationAddress || po.destinationAddress || po.destination],
              ["Destination city / FC", po.appointment?.destinationCity || po.destinationCity || po.destination || "Not resolved"],
              ["Warehouse", po.warehouse?.name || "Mapping required"],
              ["Customer", po.customer || "â€”"],
              ["PO value", `â‚¹ ${po.totalValue || 0}`],
            ].map(([k, v]) => (
              <div className="bg-slate-50 rounded-xl p-4" key={k as string}>
                <div className="text-xs text-slate-400">{k}</div>
                <div className="font-medium mt-2">{v}</div>
              </div>
            ))}
          </div>
        </div>
        <h3 className="font-semibold mt-8 mb-3">Line reconciliation</h3>
        <div className="border rounded-xl overflow-hidden">
          <div className="grid grid-cols-6 text-xs text-slate-400 bg-slate-50 p-3">
            <span>SKU</span>
            <span>Ordered</span>
            <span>Reserved</span>
            <span>Planned</span>
            <span>Dispatched</span>
            <span>Delivered</span>
          </div>
          {(po.lines || []).map((l: any) => (
            <div className="grid grid-cols-6 p-3 border-t text-sm" key={l.id}>
              <span className="mono">{l.sku?.code}</span>
              <span>{l.ordered}</span>
              <span>{l.allocated}</span>
              <span>{l.planned || 0}</span>
              <span>{l.dispatched || 0}</span>
              <span>{l.delivered}</span>
            </div>
          ))}
        </div>
        {(po.status === "UNDER_REVIEW" || po.status === "APPOINTMENT_MATCHED_AWAITING_ACCEPTANCE") && (
          <div className="flex gap-3 mt-8">
            <button
              onClick={() => {
                onAction(`/api/pos/${po.id}/accept`);
                onClose();
              }}
              className="flex-1 bg-ink text-white py-3 rounded-xl font-semibold"
            >
              Accept PO
            </button>
            <button
              onClick={() => {
                onAction(`/api/pos/${po.id}/reject`, {
                  reason: "Commercial review",
                });
                onClose();
              }}
              className="px-5 py-3 rounded-xl border text-red-600"
            >
              Reject
            </button>
          </div>
        )}
        {(po.shipments || []).length > 0 && <>
          <h3 className="font-semibold mt-8 mb-3">Shipment routes</h3>
          <div className="space-y-3">
            {(po.shipments || []).map((shipment: any) => <div className="rounded-xl border border-slate-100 p-4 text-sm" key={shipment.id}>
              <div className="flex items-center justify-between"><span className="mono font-semibold">{shipment.number}</span><Badge tone="blue">{shipment.status?.replaceAll("_", " ")}</Badge></div>
              <div className="mt-3 grid grid-cols-2 gap-3 text-xs">
                <div><div className="text-slate-400">Source</div><div className="mt-1 font-medium">{shipment.sourceCity || po.sourceCity || "—"}</div><div className="mt-1 text-slate-500">{shipment.sourceAddress || po.sourceAddress || "Address not supplied"}</div></div>
                <div><div className="text-slate-400">Destination</div><div className="mt-1 font-medium">{shipment.destinationCode || shipment.destinationCity || po.destination || "—"}</div><div className="mt-1 text-slate-500">{shipment.destinationAddress || po.destinationAddress || "Address not supplied"}</div></div>
              </div>
              <div className="mt-3 text-xs text-slate-500">Expected arrival: {shipment.expectedArrival || shipment.expected_arrival_at || "Route time not set"}</div>
            </div>)}
          </div>
        </>}
        <h3 className="font-semibold mt-8 mb-3">Operational next steps</h3>
        <div className="space-y-3">
          <div className="flex gap-3 items-center p-3 rounded-xl bg-slate-50">
            <Route size={18} />
            <span className="text-sm">
              {po.appointment
                ? "Appointment attached"
                : "Upload appointment letter after booking"}
            </span>
          </div>
          <div className="flex gap-3 items-center p-3 rounded-xl bg-slate-50">
            <Truck size={18} />
            <span className="text-sm">
              {(po.shipments || []).length} shipment(s) planned
            </span>
          </div>
          <div className="flex gap-3 items-center p-3 rounded-xl bg-slate-50">
            <FileText size={18} />
            <span className="text-sm">
              {po.invoice ? "Invoice uploaded" : "Invoice gated until delivery"}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
const rootContainer = document.getElementById("root")!;
const root = ((window as any).__scmRoot ??= createRoot(rootContainer));
root.render(<App />);

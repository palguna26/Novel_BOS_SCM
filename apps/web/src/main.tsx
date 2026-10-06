import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Activity,
  Archive,
  ArrowUpRight,
  Boxes,
  CheckCircle2,
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
import { PoInboxAccordion } from "./components/PoInboxAccordion";
import { SkuInventoryAccordion } from "./components/SkuInventoryAccordion";
import { InventoryWorkspace } from "./components/InventoryWorkspace";
import { DocumentWorkflowModal } from "./components/DocumentWorkflowModal";
import { ShipmentPlanModal } from "./components/ShipmentPlanModal";
import { ShortCloseModal } from "./components/ShortCloseModal";
import {
  DOCUMENT_ACCEPT,
  DOCUMENT_FORMATS,
  prepareDocumentUpload,
  validateDocumentFile,
} from "./lib/document-upload";
const API = import.meta.env.VITE_API_URL || "http://localhost:4000";
type User = { id: string; name: string; email: string; role: string };
type PO = any;
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
  let r = await request();
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
    [toast, setToast] = useState("");
  useEffect(() => {
    const t = localStorage.getItem("scm_token");
    if (t)
      api("/dashboard")
        .then(() => setUser(JSON.parse(localStorage.getItem("scm_user") || "null")))
        .catch(() => { localStorage.removeItem("scm_token"); localStorage.removeItem("scm_refresh_token"); localStorage.removeItem("scm_user"); });
  }, []);
  useEffect(() => {
    if (user) {
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
        .catch((e) => setToast(e.message));
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
  const action = async (path: string, body?: any) => {
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
      return false;
    }
  };
  return (
    <div className="min-h-screen flex">
      <aside className="w-64 bg-ink text-white p-5 flex flex-col">
        <div className="text-xs font-bold tracking-[.24em] text-emerald-300 px-3 py-4">
          NOVEL SCM
        </div>
        <div className="mt-8 space-y-1">
          {nav.map(([name, Icon]) => (
            <button
              key={name}
              onClick={() => setPage(name)}
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
        <header className="h-20 bg-white border-b border-slate-200 px-10 flex items-center justify-between">
          <div>
            <div className="text-xs uppercase tracking-widest text-slate-400">
              Operations workspace
            </div>
            <h1 className="text-xl font-semibold mt-1">{page}</h1>
          </div>
          <div className="flex items-center gap-4">
            <div className="relative">
              <Search
                className="absolute left-3 top-2.5 text-slate-400"
                size={16}
              />
              <input
                className="bg-slate-50 rounded-lg pl-9 pr-4 py-2 text-sm"
                placeholder="Search records..."
              />
            </div>
            <div className="w-9 h-9 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center font-semibold">
              {user.name[0]}
            </div>
          </div>
        </header>
        <div className="p-10 max-w-[1500px]">
          {toast && (
            <div className="fixed right-8 top-24 z-10 bg-ink text-white px-4 py-3 rounded-xl text-sm shadow-lg">
              {toast}
              <button onClick={() => setToast("")} className="ml-4">
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
              onSelect={setSelected}
              onAction={action}
              onRefresh={refresh}
            />
          )}{" "}
          {page === "Inventory" && (
            <InventoryWorkspace
              rows={data.inventory || []}
              masters={data.masters || {}}
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
        />
      )}
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
      <div className="flex items-end justify-between mb-8">
        <div>
          <p className="text-sm text-slate-500">Thursday, 01 October 2026</p>
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
      <div className="grid grid-cols-4 gap-4">
        <Stat
          label="Awaiting review"
          value={counts.UNDER_REVIEW || counts.UPLOADED}
          sub="Needs your attention"
          icon={ClipboardList}
          color="bg-violet-100 text-violet-700"
        />
        <Stat
          label="Inventory blocked"
          value={counts.ACCEPTED || 0}
          sub="Accepted POs"
          icon={Archive}
          color="bg-blue-100 text-blue-700"
        />
        <Stat
          label="In transit"
          value={counts.PARTIALLY_DISPATCHED || 0}
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
      <div className="grid grid-cols-[1.4fr_1fr] gap-6 mt-8">
        <div className="bg-white rounded-2xl border border-slate-100">
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
    <div className="bg-white rounded-2xl border border-slate-100">
      <div className="p-5 border-b border-slate-100 flex justify-between items-center">
        <h3 className="font-semibold">{title}</h3>
        {action}
      </div>
      {children}
    </div>
  );
}
function Inbox({
  pos,
  onSelect,
  onAction,
  onRefresh,
}: {
  pos: PO[];
  onSelect: (p: PO) => void;
  onAction: Function;
  onRefresh: Function;
}) {
  const [show, setShow] = useState(false);
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
      <Section title={`${pos.length} purchase orders`}>
        <div className="grid grid-cols-[1fr_1.2fr_1.2fr_1fr_140px] text-xs uppercase tracking-wide text-slate-400 px-5 py-3 bg-slate-50">
          <span>PO ID</span>
          <span>Platform / destination</span>
          <span>Warehouse</span>
          <span>Status</span>
          <span></span>
        </div>
        {pos.map((p) => (
          <div
            key={p.id}
            onClick={() => onSelect(p)}
            className="grid grid-cols-[1fr_1.2fr_1.2fr_1fr_140px] items-center px-5 py-4 border-t border-slate-50 hover:bg-slate-50 cursor-pointer"
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
              {p.status === "UNDER_REVIEW" && (
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
            {(masters.platforms || []).map((x: any) => (
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
    [error, setError] = useState("");
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
      setScan(x);
      const extractionWarning = x.extraction?.method === "rules"
        ? `AI extraction was unavailable (${x.extraction.fallbackReason || "unknown error"}). Review the fallback result.`
        : "";
      if (warning || extractionWarning) setError([warning, extractionWarning].filter(Boolean).join(" "));
      const extracted = x.extracted || {};
      const skuValue = (sku: any, key: string) => String(sku?.[key] || "").trim().toLowerCase();
      const extractedLines = (extracted.lines || []).map((line: any) => {
        const identifiers = [line.channelItemCode, line.asin, line.ean].filter(Boolean).map((value: any) => String(value).trim().toLowerCase());
        const matched = (masters.skus || []).find((sku: any) =>
          ["code", "sku", "sku_code", "channel_item_code", "asin", "ean"].some(key => identifiers.includes(skuValue(sku, key)))
        ) || (line.itemId ? (masters.skus || []).find((sku: any) => sku.id === line.itemId) : null) || (line.description ? (masters.skus || []).find((sku: any) => skuValue(sku, "name") === skuValue(line, "description")) : null);
        return { skuId: line.itemId || matched?.id || "", ordered: Number(line.ordered || line.approved || 0), unitPrice: Number(line.unitPrice || 0), sourceCode: line.channelItemCode || line.asin || line.ean || line.description || "" };
      });
      setBody({
        platformId,
        externalId: extracted.externalId || "",
        destination: extracted.destination || extracted.fcCode || "",
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
  const addLine = () =>
    setBody((b: any) => ({
      ...b,
      lines: [...(b.lines || []), { skuId: "", ordered: 0, unitPrice: 0 }],
    }));
  const save = async () => {
    if (
      !body.externalId ||
      !body.poDate ||
      !body.destination ||
      !body.lines.length ||
      body.lines.some((l: any) => !l.skuId || Number(l.ordered) <= 0)
    ) {
      setError(
        "Complete PO ID, date, destination, and at least one valid SKU line.",
      );
      return;
    }
    setBusy(true);
    const saved = await onAction("/api/pos", body);
    setBusy(false);
    if (saved) onClose();
  };
  return (
    <div className="fixed inset-0 bg-black/40 z-20 flex items-center justify-center p-8">
      <UiCard className="max-h-[90vh] w-full max-w-6xl overflow-auto">
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
                  {(masters.platforms || []).map((x: any) => (
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
            </div>
          ) : (
            <div>
              <div className="grid gap-5 lg:grid-cols-[1.25fr_.75fr]">
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
                      <div className="space-y-3">
                        {(body.lines || []).map((l: any, i: number) => (
                          <div
                            key={i}
                            className="grid gap-3 rounded-xl bg-slate-50 p-3 sm:grid-cols-[1.5fr_.6fr_.7fr_32px]"
                          >
                            <select
                              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                              value={l.skuId}
                              onChange={(e) => {
                                const lines = [...body.lines];
                                lines[i] = { ...l, skuId: e.target.value };
                                setBody({ ...body, lines });
                              }}
                            >
                              <option value="">Select SKU</option>
                              {!l.skuId && l.sourceCode && <option value="" disabled>Extracted: {l.sourceCode}</option>}
                              {(masters.skus || []).map((s: any) => (
                                <option key={s.id} value={s.id}>
                                  {s.code} Â· {s.name}
                                </option>
                              ))}
                            </select>
                            <UiInput
                              type="number"
                              placeholder="Qty"
                              value={l.ordered || ""}
                              onChange={(e) => {
                                const lines = [...body.lines];
                                lines[i] = {
                                  ...l,
                                  ordered: Number(e.target.value),
                                };
                                setBody({ ...body, lines });
                              }}
                            />
                            <UiInput
                              type="number"
                              placeholder="Unit price"
                              value={l.unitPrice || ""}
                              onChange={(e) => {
                                const lines = [...body.lines];
                                lines[i] = {
                                  ...l,
                                  unitPrice: Number(e.target.value),
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
                        ))}
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
        <div className="grid grid-cols-6 text-xs uppercase tracking-wide text-slate-400 px-5 py-3 bg-slate-50">
          <span>SKU</span>
          <span>Warehouse</span>
          <span>Physical</span>
          <span>Blocked</span>
          <span>In transit</span>
          <span>Allocatable</span>
        </div>
        {rows.map((r) => (
          <div
            className="grid grid-cols-6 px-5 py-5 border-t border-slate-50 items-center"
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
function Shipments({ pos, onAction }: { pos: PO[]; onAction: Function }) {
  const [podPo, setPodPo] = useState<PO | null>(null),
    [planPo, setPlanPo] = useState<PO | null>(null);
  const items = pos.flatMap((p) =>
      (p.shipments || []).map((s: any) => ({
        ...s,
        externalId: p.externalId,
        po: p,
      })),
    ),
    ready = pos.filter(
      (p) =>
        p.reservation &&
        p.appointment &&
        (p.lines || []).some(
          (l: any) => Number(l.allocated || 0) > Number(l.dispatched || 0),
        ),
    );
  return (
    <>
      <div className="mb-7 flex items-end justify-between">
        <div>
          <p className="text-sm text-slate-500">Truck-level movement</p>
          <h2 className="text-3xl font-semibold mt-2">Shipment tracker</h2>
        </div>
        {ready[0] && (
          <button
            onClick={() => setPlanPo(ready[0])}
            className="rounded-xl bg-ink px-4 py-3 text-sm font-semibold text-white"
          >
            <Plus size={16} className="mr-2 inline" />
            Plan {ready[0].externalId}
          </button>
        )}
      </div>
      <Section title={`${items.length} shipments`}>
        <div className="grid grid-cols-5 text-xs uppercase tracking-wide text-slate-400 px-5 py-3 bg-slate-50">
          <span>Shipment</span>
          <span>PO</span>
          <span>Vehicle</span>
          <span>Status</span>
          <span></span>
        </div>
        {items.map((s) => (
          <div
            className="grid grid-cols-5 px-5 py-5 border-t border-slate-50 items-center"
            key={s.id}
          >
            <div className="mono font-semibold text-sm">{s.number}</div>
            <div className="mono text-sm">{s.externalId}</div>
            <div className="text-sm">{s.truckNumber || "Unassigned"}</div>
            <Badge tone={s.status === "IN_TRANSIT" ? "amber" : "blue"}>
              {s.status.replaceAll("_", " ")}
            </Badge>
            <span>
              {s.status === "PLANNED" && (
                <button
                  onClick={() => onAction(`/api/shipments/${s.id}/dispatch`)}
                  className="text-xs font-semibold text-emerald-700"
                >
                  Dispatch <ArrowUpRight size={14} className="inline" />
                </button>
              )}
              {["DISPATCHED", "IN_TRANSIT", "ARRIVED", "UNLOADING"].includes(
                s.status,
              ) && (
                <button
                  onClick={() => setPodPo(s.po)}
                  className="text-xs font-semibold text-emerald-700"
                >
                  Confirm POD
                </button>
              )}
            </span>
          </div>
        ))}
      </Section>
      {planPo && (
        <ShipmentPlanModal
          po={planPo}
          onClose={() => setPlanPo(null)}
          onAction={onAction}
        />
      )}{" "}
      {podPo && (
        <DocumentWorkflowModal
          apiBase={API}
          mode="pod"
          po={podPo}
          onClose={() => setPodPo(null)}
          onSaved={() => location.reload()}
        />
      )}
    </>
  );
}
function Appointments({ pos }: { pos: PO[]; onAction: Function }) {
  const [selected, setSelected] = useState<PO | null>(null);
  return (
    <>
      <div className="mb-7">
        <p className="text-sm text-slate-500">
          Booking deadlines and documents
        </p>
        <h2 className="text-3xl font-semibold mt-2">Appointments</h2>
      </div>
      <Section title="Appointment queue">
        <div className="grid grid-cols-4 text-xs uppercase tracking-wide text-slate-400 px-5 py-3 bg-slate-50">
          <span>PO</span>
          <span>Destination</span>
          <span>Status</span>
          <span>Appointment</span>
        </div>
        {pos.map((p) => (
          <div
            className="grid grid-cols-4 px-5 py-5 border-t border-slate-50 items-center"
            key={p.id}
          >
            <span className="mono text-sm font-semibold">{p.externalId}</span>
            <span className="text-sm">{p.destination}</span>
            <span>
              {p.appointment ? (
                <Badge tone="green">{p.appointment.status}</Badge>
              ) : (
                <Badge tone="amber">Pending booking</Badge>
              )}
            </span>
            <span className="text-sm">
              {p.appointment?.appointmentAt ? (
                new Date(p.appointment.appointmentAt).toLocaleString()
              ) : (
                <button
                  onClick={() => setSelected(p)}
                  className="text-xs font-semibold text-emerald-700"
                >
                  Attach appointment
                </button>
              )}
            </span>
          </div>
        ))}
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
    </>
  );
}
function Invoices({ pos, onAction }: { pos: PO[]; onAction: Function }) {
  const [selected, setSelected] = useState<PO | null>(null),
    [shortClose, setShortClose] = useState<PO | null>(null);
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
        <div className="grid grid-cols-4 text-xs uppercase tracking-wide text-slate-400 px-5 py-3 bg-slate-50">
          <span>PO</span>
          <span>Status</span>
          <span>Invoice</span>
          <span>Action</span>
        </div>
        {queue.map((p) => (
          <div
            className="grid grid-cols-4 px-5 py-5 border-t border-slate-50 items-center"
            key={p.id}
          >
            <span className="mono text-sm font-semibold">{p.externalId}</span>
            <Badge tone={p.status === "DELIVERY_ISSUE" ? "amber" : "green"}>
              {p.status.replaceAll("_", " ")}
            </Badge>
            <span className="text-sm">
              {p.invoice?.invoice_number || "Not uploaded"}
            </span>
            <span>
              {!p.invoice &&
                ["FULLY_DELIVERED", "SHORT_CLOSED"].includes(p.status) && (
                  <button
                    onClick={() => setSelected(p)}
                    className="text-xs font-semibold text-emerald-700"
                  >
                    Upload invoice <UploadCloud size={14} className="inline" />
                  </button>
                )}
              {["DELIVERY_ISSUE", "PARTIALLY_DELIVERED"].includes(p.status) && (
                <button
                  onClick={() => setShortClose(p)}
                  className="text-xs font-semibold text-amber-700"
                >
                  Short close
                </button>
              )}
            </span>
          </div>
        ))}
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
function Masters({ data, onAction }: { data: any; onAction: Function }) {
  return (
    <>
      <div className="mb-7">
        <p className="text-sm text-slate-500">Controlled operational data</p>
        <h2 className="text-3xl font-semibold mt-2">Administration</h2>
      </div>
      <div className="grid grid-cols-3 gap-5">
        <Section title="Platforms">
          <div className="p-5 space-y-4">
            {(data.platforms || []).map((x: any) => (
              <div className="flex justify-between text-sm" key={x.id}>
                <span>{x.name}</span>
                <Badge tone="green">Active</Badge>
              </div>
            ))}
          </div>
        </Section>
        <Section title="Warehouses">
          <div className="p-5 space-y-4">
            {(data.warehouses || []).map((x: any) => (
              <div className="flex justify-between text-sm" key={x.id}>
                <span>{x.name}</span>
                <span className="mono text-xs text-slate-400">{x.code}</span>
              </div>
            ))}
          </div>
        </Section>
        <Section title="SKUs">
          <div className="p-5 space-y-4">
            {(data.skus || []).map((x: any) => (
              <div className="flex justify-between text-sm" key={x.id}>
                <span>{x.name}</span>
                <span className="mono text-xs text-slate-400">{x.code}</span>
              </div>
            ))}
          </div>
        </Section>
      </div>
    </>
  );
}
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
        <div className="grid grid-cols-4 text-xs uppercase tracking-wide text-slate-400 px-5 py-3 bg-slate-50">
          <span>Action</span>
          <span>Record</span>
          <span>User</span>
          <span>Time</span>
        </div>
        {rows.map((x) => (
          <div
            className="grid grid-cols-4 px-5 py-4 border-t border-slate-50 text-sm"
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
              ["Destination", po.destination],
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
          <div className="grid grid-cols-4 text-xs text-slate-400 bg-slate-50 p-3">
            <span>SKU</span>
            <span>Ordered</span>
            <span>Blocked</span>
            <span>Delivered</span>
          </div>
          {(po.lines || []).map((l: any) => (
            <div className="grid grid-cols-4 p-3 border-t text-sm" key={l.id}>
              <span className="mono">{l.sku?.code}</span>
              <span>{l.ordered}</span>
              <span>{l.allocated}</span>
              <span>{l.delivered}</span>
            </div>
          ))}
        </div>
        {po.status === "UNDER_REVIEW" && (
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

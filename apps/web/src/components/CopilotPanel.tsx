import { useMemo, useState } from "react";
import { BarChart3, Download, FileDown, Loader2, MessageCircle, Send, X } from "lucide-react";

type Props = { api: (path: string, opts?: RequestInit) => Promise<any>; page: string; context?: any; onClose: () => void };

function downloadCsv(table: any) {
  const rows = [table.columns || [], ...(table.rows || [])];
  const csv = rows.map((row: any[]) => row.map(value => `"${String(value ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `scm-copilot-report-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

function inlineMarkdown(value: string) {
  return value.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((part, index) => {
    if (part.startsWith("**") && part.endsWith("**")) return <strong key={index}>{part.slice(2, -2)}</strong>;
    if (part.startsWith("`") && part.endsWith("`")) return <code key={index} className="rounded bg-slate-100 px-1 py-0.5 text-[11px]">{part.slice(1, -1)}</code>;
    return <span key={index}>{part}</span>;
  });
}

function MarkdownAnswer({ text }: { text: string }) {
  const lines = text.replace(/\r/g, "").split("\n");
  const tableRow = (line: string) => line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map(cell => cell.trim());
  const tableSeparator = (line: string) => tableRow(line).every(cell => /^:?-{3,}:?$/.test(cell));
  const blocks: any[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.trim().startsWith("|") && tableSeparator(lines[index + 1] || "")) {
      const header = tableRow(line);
      const rows: string[][] = [];
      index += 2;
      while (index < lines.length && lines[index].trim().startsWith("|")) {
        rows.push(tableRow(lines[index]));
        index += 1;
      }
      index -= 1;
      blocks.push(<div key={`table-${index}`} className="overflow-x-auto rounded-lg border border-slate-200"><table className="w-full text-xs"><thead className="bg-slate-50"><tr>{header.map((cell, cellIndex) => <th key={cellIndex} className="px-3 py-2 text-left font-semibold text-slate-600 border-b border-slate-200 whitespace-nowrap">{inlineMarkdown(cell)}</th>)}</tr></thead><tbody>{rows.map((row, rowIndex) => <tr key={rowIndex}>{header.map((_, cellIndex) => <td key={cellIndex} className="px-3 py-2 border-b border-slate-100 whitespace-nowrap">{inlineMarkdown(row[cellIndex] || "")}</td>)}</tr>)}</tbody></table></div>);
      continue;
    }
    if (!line.trim()) blocks.push(<div key={index} className="h-1" />);
    else if (line.startsWith("### ")) blocks.push(<h4 key={index} className="font-semibold text-base mt-3">{inlineMarkdown(line.slice(4))}</h4>);
    else if (line.startsWith("## ")) blocks.push(<h3 key={index} className="font-semibold text-lg mt-3">{inlineMarkdown(line.slice(3))}</h3>);
    else if (line.startsWith("# ")) blocks.push(<h2 key={index} className="font-semibold text-xl mt-3">{inlineMarkdown(line.slice(2))}</h2>);
    else if (/^[-*] /.test(line)) blocks.push(<div key={index} className="flex gap-2 pl-2"><span className="text-emerald-700">•</span><span>{inlineMarkdown(line.slice(2))}</span></div>);
    else if (/^\d+\. /.test(line)) blocks.push(<div key={index} className="pl-2">{inlineMarkdown(line)}</div>);
    else if (line.startsWith("> ")) blocks.push(<blockquote key={index} className="border-l-2 border-emerald-500 pl-3 text-slate-600">{inlineMarkdown(line.slice(2))}</blockquote>);
    else blocks.push(<p key={index}>{inlineMarkdown(line)}</p>);
  }
  return <div className="text-sm leading-6 space-y-2">{blocks}</div>;
}

function printPdf(answer: string, generatedAt?: string) {
  const escape = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const html = escape(answer)
    .replace(/^### (.*)$/gm, "<h3>$1</h3>")
    .replace(/^## (.*)$/gm, "<h2>$1</h2>")
    .replace(/^# (.*)$/gm, "<h1>$1</h1>")
    .replace(/^[-*] (.*)$/gm, "<li>$1</li>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\n/g, "<br />");
  const report = window.open("", "_blank", "width=900,height=700");
  if (!report) return;
  report.document.write(`<!doctype html><html><head><title>SCM Copilot Report</title><style>body{font-family:Arial,sans-serif;color:#14211f;max-width:900px;margin:40px auto;line-height:1.6}h1,h2,h3{margin-top:24px}code{background:#eef2f0;padding:2px 4px;border-radius:3px}li{margin:5px 0}</style></head><body><h1>SCM Copilot Report</h1><p style="color:#66736f">Generated ${generatedAt ? new Date(generatedAt).toLocaleString() : new Date().toLocaleString()}</p><div>${html}</div></body></html>`);
  report.document.close();
  report.focus();
  report.print();
}

export function CopilotPanel({ api, page, context, onClose }: Props) {
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<any>(null);
  const suggestions = useMemo(() => page === "Inventory"
    ? ["Which SKUs are below threshold?", "Compare allocatable stock by warehouse."]
    : page === "PO Inbox"
      ? ["Show POs needing review.", "Which POs have delivery exceptions?"]
      : ["Give me an operations summary.", "Show current inventory risks.", "Create a report of open POs."], [page]);

  async function ask(value = question) {
    const text = value.trim();
    if (!text || busy) return;
    setBusy(true); setError(""); setQuestion(text);
    try { setResult(await api("/copilot/ask", { method: "POST", body: JSON.stringify({ question: text, context: { page, ...context } }) })); }
    catch (e: any) { setResult(null); setError(e.message || "The copilot could not answer"); }
    finally { setBusy(false); }
  }

  return <div role="dialog" aria-modal="true" aria-label="SCM Copilot" className="fixed inset-y-0 right-0 z-30 w-[min(560px,100vw)] bg-white shadow-2xl border-l border-slate-200 flex flex-col">
    <div className="px-6 py-5 border-b border-slate-100 flex items-center justify-between">
      <div><div className="flex items-center gap-2 font-semibold"><MessageCircle size={18} className="text-emerald-700" /> SCM Copilot</div><div className="text-xs text-slate-400 mt-1">Read-only · grounded in your permitted data</div></div>
      <button aria-label="Close Copilot" onClick={onClose} className="min-h-10 min-w-10 text-slate-400 hover:text-ink"><X size={20} /></button>
    </div>
    <div className="flex-1 overflow-auto p-6">
      {!result && !busy && <><div className="text-sm text-slate-500 mb-4">Ask about operations, exceptions, inventory, shipments, or reports.</div><div className="space-y-2">{suggestions.map(item => <button key={item} onClick={() => ask(item)} className="block w-full text-left rounded-xl border border-slate-200 px-4 py-3 text-sm hover:border-emerald-400 hover:bg-emerald-50">{item}</button>)}</div></>}
      {busy && <div className="flex items-center gap-2 text-sm text-slate-500"><Loader2 size={16} className="animate-spin" /> Checking SCM data…</div>}
      {error && <div className="rounded-xl bg-red-50 text-red-700 p-4 text-sm">{error}</div>}
      {result && <div className="space-y-5"><div><div className="flex items-center justify-between mb-2"><div className="text-xs uppercase tracking-wide text-slate-400">Answer</div><button onClick={() => printPdf(result.answer, result.generatedAt)} className="text-xs font-semibold text-emerald-700"><FileDown size={14} className="inline mr-1" />PDF</button></div><MarkdownAnswer text={result.answer} /></div>{result.chart?.labels?.length > 0 && <div className="rounded-xl bg-ink text-white p-4"><div className="flex items-center gap-2 text-sm font-semibold"><BarChart3 size={16} className="text-emerald-300" />{result.chart.title}</div><div className="mt-4 space-y-3">{result.chart.labels.map((label: string, index: number) => <div key={`${label}-${index}`}><div className="flex justify-between text-xs text-slate-300"><span>{label}</span><span>{result.chart.values[index]}</span></div><div className="h-2 bg-white/10 rounded-full mt-1"><div className="h-full bg-emerald-300 rounded-full" style={{ width: `${Math.min(100, Math.max(4, (Number(result.chart.values[index]) / Math.max(...result.chart.values, 1)) * 100))}%` }} /></div></div>)}</div></div>}{result.table?.columns?.length > 0 && <div className="border border-slate-200 rounded-xl overflow-auto"><div className="px-4 py-3 flex justify-between items-center bg-slate-50"><span className="text-xs uppercase tracking-wide text-slate-400">Report data</span><button onClick={() => downloadCsv(result.table)} className="text-xs font-semibold text-emerald-700"><Download size={14} className="inline mr-1" />CSV</button></div><table className="w-full text-xs"><thead><tr>{result.table.columns.map((column: string) => <th key={column} className="text-left px-3 py-2 font-semibold text-slate-500 border-t">{column}</th>)}</tr></thead><tbody>{result.table.rows.map((row: any[], index: number) => <tr key={index}>{row.map((value, cellIndex) => <td key={cellIndex} className="px-3 py-2 border-t border-slate-100 whitespace-nowrap">{String(value ?? "—")}</td>)}</tr>)}</tbody></table></div>}{result.warnings?.map((warning: string) => <div key={warning} className="rounded-lg bg-amber-50 text-amber-800 px-3 py-2 text-xs">{warning}</div>)}<div className="text-xs text-slate-400">Sources: {result.sources?.join(", ") || "SCM data snapshot"}<br />Generated {new Date(result.generatedAt).toLocaleString()}</div></div>}
    </div>
    <form onSubmit={e => { e.preventDefault(); ask(); }} className="p-4 border-t border-slate-100 flex gap-2"><input value={question} onChange={e => setQuestion(e.target.value)} placeholder="Ask the operations copilot…" className="flex-1 rounded-xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-emerald-500" /><button disabled={busy || !question.trim()} className="rounded-xl bg-ink text-white px-4 disabled:opacity-40"><Send size={16} /></button></form>
  </div>;
}

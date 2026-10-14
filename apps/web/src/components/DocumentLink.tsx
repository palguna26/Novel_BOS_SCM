import { useState } from 'react';
import { ExternalLink } from 'lucide-react';

type Props = { documentVersionId?: string | null; filename?: string | null; label?: string };

const apiBase = import.meta.env.VITE_API_URL || 'http://localhost:4000';

export function DocumentLink({ documentVersionId, filename, label }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (!documentVersionId) return null;

  const open = async () => {
    const tab = window.open('about:blank', '_blank');
    if (tab) tab.opener = null;
    setBusy(true);
    setError('');
    try {
      const response = await fetch(`${apiBase}/api/documents/${encodeURIComponent(documentVersionId)}/url`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('scm_token')}` },
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.url) throw new Error(result.message || 'Could not open the file.');
      if (tab && !tab.closed) tab.location.replace(result.url);
      else window.location.assign(result.url);
    } catch (cause: any) {
      tab?.close();
      setError(cause?.message || 'Could not open the file.');
    } finally {
      setBusy(false);
    }
  };

  return <span className="inline-flex flex-col items-start gap-1">
    <button type="button" onClick={open} disabled={busy} className="inline-flex items-center gap-1 text-left font-medium text-emerald-700 hover:underline disabled:opacity-50" title={filename || label || 'View file'}>
      <span className="break-all">{busy ? 'Opening…' : label || filename || 'View file'}</span><ExternalLink size={14} aria-hidden="true" />
    </button>
    {error && <span role="alert" className="text-xs text-red-700">{error}</span>}
  </span>;
}

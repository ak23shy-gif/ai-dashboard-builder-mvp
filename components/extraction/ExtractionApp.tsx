'use client';
import { useEffect, useRef, useState } from 'react';
import { ArrowDownToLine, ArrowRight, Braces, Check, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, CircleHelp, Copy, Database, ExternalLink, FileJson, FileSpreadsheet, FolderOpen, History, Layers3, Link2, Loader2, LockKeyhole, Play, Plus, RefreshCw, Search, Settings2, ShieldCheck, Sparkles, Unplug, X } from 'lucide-react';
import './extraction.css';
import './multiple.css';

type Product = { id: string; name: string; description: string; dimensions: string[]; metrics: string[]; defaults: string[]; defaultMetrics: string[]; incremental: boolean; note?: string };
type Resource = { id: string; name: string; group?: string; connection_id: string; email: string };
type Account = { id: string; email: string; products: string[] };
type SourceSelection = { connection_id: string; resource: string; options?: Record<string, string> };
type Spec = { product: string; resource: string; start: string; end: string; dimensions: string[]; metrics: string[]; incremental: boolean; options: Record<string, string>; targets?: SourceSelection[] };
type SourceProgress = { position: number; name: string; email: string; resource: string; status: string; count: number; error?: string; start_date: string; end_date: string };
type Job = { id: string; status: string; count: number; created: string; columns: string[]; rows: Record<string, unknown>[]; error?: string; spec: Spec; sources?: SourceProgress[] };
type Status = { connected: boolean; configured: boolean; email?: string; products: Product[]; accounts?: Account[]; workspace_owner?: string };
type Fields = { dimensions?: string[]; metrics?: string[]; tabs?: { title: string }[] };
const resourceKey = (r: Resource) => JSON.stringify([r.connection_id, r.id]);
const fallback: Product[] = [
  { id: 'ga4', name: 'Google Analytics 4', description: 'Website & app performance', dimensions: ['date', 'country', 'city', 'deviceCategory', 'sessionSource', 'sessionMedium', 'pagePath', 'eventName'], metrics: ['sessions', 'activeUsers', 'newUsers', 'screenPageViews', 'engagedSessions', 'eventCount', 'totalRevenue'], defaults: ['date', 'country'], defaultMetrics: ['sessions', 'activeUsers'], incremental: true },
  ...[['ads', 'Google Ads', 'Campaigns, clicks & ad spend'], ['search', 'Google Search Console', 'Search queries & organic visibility'], ['youtube', 'YouTube Analytics', 'Views, watch time & engagement'], ['business', 'Google Business Profile', 'Business locations & contact details'], ['sheets', 'Google Sheets', 'Spreadsheet rows, ready to export'], ['drive', 'Google Drive', 'File inventory & metadata']].map(([id, name, description]) => ({ id, name, description, dimensions: [], metrics: [], defaults: [], defaultMetrics: [], incremental: false })),
  { id: 'api', name: 'API Endpoint', description: 'Paste any JSON API endpoint', dimensions: [], metrics: [], defaults: [], defaultMetrics: [], incremental: false },
];
const iso = (d: Date) => d.toISOString().slice(0, 10);
const yesterday = () => iso(new Date(Date.now() - 86400000));
const monthAgo = () => iso(new Date(Date.now() - 30 * 86400000));
const label = (s: string) => s.replace(/^(metrics|segments|campaign)\./, '').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/_/g, ' ').replace(/^./, c => c.toUpperCase());
const publicApiBase = process.env.NEXT_PUBLIC_EXTRACT_API_BASE_URL?.replace(/\/$/, '');
const cleanEditableUrl = (value: string) => value.trim().replace(/\\_/g, '_').replace(/\\&/g, '&').replace(/^\[[^\]]+\]\(([\s\S]*)\)$/, '$1').trim();
const urlWithFormat = (value: string, format: 'csv' | 'json') => {
  const cleaned = cleanEditableUrl(value);
  try {
    const url = new URL(cleaned, typeof window !== 'undefined' ? window.location.origin : 'https://google-api-data-extractor.vercel.app');
    url.searchParams.set('format', format);
    return url.toString();
  } catch {
    return cleaned;
  }
};
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let r: Response;
  try {
    r = await fetch('/extract-api' + path, init);
  } catch {
    throw new Error('Could not reach the deployed extraction backend. Check Render status and try again.');
  }
  const text = await r.text();
  let d: any = null;
  try { d = text ? JSON.parse(text) : null; } catch { /* Keep the raw response text for the error below. */ }
  if (!r.ok) {
    const detail = typeof d?.detail === 'string' ? d.detail : text?.slice(0, 180);
    throw new Error(detail || `Extraction backend returned HTTP ${r.status}.`);
  }
  if (!d) throw new Error('Extraction backend returned an empty or non-JSON response.');
  return d;
}

function ProductIcon({ id, small = false }: { id: string; small?: boolean }) {
  return <span className={`gx-product-icon gx-${id} ${small ? 'gx-small' : ''}`} aria-hidden="true">{id === 'ga4' ? <span className="gx-bars"><i /><i /><i /></span> : id === 'ads' ? <span className="gx-ads-symbol">A</span> : id === 'youtube' ? <span className="gx-youtube-symbol">▶</span> : id === 'search' ? <Search size={small ? 19 : 25} /> : id === 'business' ? <span>▥</span> : id === 'drive' ? <FolderOpen size={small ? 19 : 25} /> : id === 'api' ? <Braces size={small ? 19 : 25} /> : <FileSpreadsheet size={small ? 19 : 25} />}</span>;
}

export function ExtractionApp() {
  const [status, setStatus] = useState<Status>({ connected: false, configured: false, products: fallback });
  const [product, setProduct] = useState('ga4');
  const [resources, setResources] = useState<Resource[]>([]);
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [resourceSearch, setResourceSearch] = useState('');
  const [accountErrors, setAccountErrors] = useState<{ account: Account; message: string }[]>([]);
  const [fieldLoading, setFieldLoading] = useState(false);
  const [dimensions, setDimensions] = useState(['date', 'country']);
  const [metrics, setMetrics] = useState(['sessions', 'activeUsers']);
  const [fields, setFields] = useState<Fields>({});
  const [sourceFields, setSourceFields] = useState<Record<string, Fields>>({});
  const [sourceOptions, setSourceOptions] = useState<Record<string, Record<string, string>>>({});
  const [options, setOptions] = useState<Record<string, string>>({});
  const [filters, setFilters] = useState('');
  const [apiOptions, setApiOptions] = useState<Record<string, string>>({ method: 'GET', url: '', data_path: '', headers: '', body: '', limit: '100000' });
  const [start, setStart] = useState(monthAgo);
  const [end, setEnd] = useState(yesterday);
  const [incremental, setIncremental] = useState(false);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [resourceError, setResourceError] = useState('');
  const [job, setJob] = useState<Job | null>(null);
  const [offset, setOffset] = useState(0);
  const [view, setView] = useState('extract');
  const [history, setHistory] = useState<Job[]>([]);
  const [setup, setSetup] = useState(false);
  const [fieldSearch, setFieldSearch] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [queryKey, setQueryKey] = useState('');
  const [editableQueryUrl, setEditableQueryUrl] = useState('');
  const resultRef = useRef<HTMLDivElement>(null);
  const p = status.products.find(x => x.id === product) || fallback[0];
  const busy = submitting || job?.status === 'queued' || job?.status === 'running';
  const availableDimensions = fields.dimensions || p.dimensions;
  const availableMetrics = fields.metrics || p.metrics;
  const selected = resources.filter(r => selectedKeys.includes(resourceKey(r)));
  const visibleResources = resources.filter(r => `${r.name} ${r.id} ${r.group || ''} ${r.email}`.toLowerCase().includes(resourceSearch.toLowerCase()));
  const canonicalResource = (r: Resource) => product === 'ads' ? r.id.split(':')[0] : r.id;
  const canQuery = product === 'api' ? !!apiOptions.url.trim() : status.connected && selected.length > 0;
  const queryUrl = (() => {
    if (!canQuery || !queryKey) return '';
    const params = new URLSearchParams();
    params.set('api_key', queryKey);
    params.set('format', 'json');
    if (product === 'api') {
      Object.entries(apiOptions).forEach(([key, value]) => { if (value) params.set(key, value); });
    } else {
      params.set('workspace', status.workspace_owner || '');
      params.set('connection_id', selected[0]?.connection_id || '');
      params.set('resources', selected.map(r => r.id).join(','));
      params.set('targets', JSON.stringify(selected.map(r => ({ connection_id: r.connection_id, resource: r.id, options: product === 'sheets' ? sourceOptions[resourceKey(r)] || {} : {} }))));
      params.set('date_from', start);
      params.set('date_to', end);
      params.set('dimensions', dimensions.join(','));
      params.set('metrics', metrics.join(','));
      if (product === 'ga4') {
        params.set('exclude_recent_days', '2');
        params.set('chunk', 'monthly');
        const ga4Fields = [...dimensions, ...metrics];
        if (ga4Fields.includes('sessionPrimaryChannelGroup') || ga4Fields.includes('sessionDefaultChannelGroup')) {
          params.set('ui_report', 'traffic_acquisition');
        }
      }
      Object.entries(options).forEach(([key, value]) => { if (value) params.set('option_' + key, value); });
      if (filters.trim()) params.set('filters', filters.trim());
    }
    const base = publicApiBase || (typeof window !== 'undefined' ? `${window.location.origin}/extract-api` : '/extract-api');
    return `${base}/query/${product}?${params.toString()}`;
  })();

  useEffect(() => {
    setEditableQueryUrl(queryUrl);
  }, [queryUrl]);
  useEffect(() => {
    request<Status>('/status').then(setStatus).catch(e => setError(e.message));
    const authError = new URLSearchParams(window.location.search).get('auth_error');
    if (authError) { setError(authError); window.history.replaceState({}, '', '/'); }
    const saved = sessionStorage.getItem('extract-product');
    if (saved && fallback.some(x => x.id === saved)) setProduct(saved);
  }, []);
  useEffect(() => {
    if (!status.connected || queryKey) return;
    request<{ api_key: string }>('/query/key').then(r => setQueryKey(r.api_key)).catch(() => {});
  }, [status.connected, queryKey]);
  useEffect(() => {
    setDimensions(p.defaults); setMetrics(p.defaultMetrics); setFields({}); setOptions({}); setSelectedKeys([]); setResources([]); setIncremental(false); setResourceError(''); setFieldSearch(''); setResourceSearch(''); setAccountErrors([]); setSourceFields({}); setSourceOptions({}); setFilters('');
    if (product === 'api') {
      const local = { id: 'endpoint', name: apiOptions.url || 'Pasted API endpoint', connection_id: 'api', email: 'Local API' };
      setResources([local]); setSelectedKeys([resourceKey(local)]); setLoading(false);
      return;
    }
    if (!status.connected) return;
    let active = true;
    setLoading(true);
    const accounts = status.accounts || [];
    Promise.all(accounts.map(async account => {
      if (!account.products.includes(product)) return { account, rows: [] as Resource[], message: `Authorize ${p.name} for this Google login.` };
      try {
        const rows = await request<Resource[]>(`/products/${product}/resources?connection_id=${encodeURIComponent(account.id)}`);
        return { account, rows: rows.map(r => ({ ...r, connection_id: account.id, email: account.email })), message: '' };
      } catch (e) { return { account, rows: [] as Resource[], message: (e as Error).message }; }
    })).then(results => {
      if (!active) return;
      const all = results.flatMap(result => result.rows);
      setResources(all);
      setAccountErrors(results.filter(result => result.message).map(({ account, message }) => ({ account, message })));
      let restored: string[] = [];
      try { restored = JSON.parse(sessionStorage.getItem(`extract-resources-${product}`) || '[]'); } catch { /* Start with no restored selection. */ }
      setSelectedKeys(restored.filter(key => all.some(r => resourceKey(r) === key)).slice(0, 100));
    }).catch(e => { if (active) setResourceError(e.message); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [product, status.connected, status.products, status.accounts, refresh]);
  useEffect(() => {
    if (!selectedKeys.length || (!status.connected && product !== 'api') || (product === 'api' && !apiOptions.url.trim())) { setFields({}); setFieldLoading(false); return; }
    let active = true;
    setFieldLoading(true); setResourceError('');
    const apiQuery = product === 'api' ? '&' + new URLSearchParams(apiOptions).toString() : '';
    Promise.all(selected.map(async r => ({ key: resourceKey(r), fields: await request<Fields>(`/products/${product}/fields?resource=${encodeURIComponent(r.id)}&connection_id=${encodeURIComponent(r.connection_id)}${apiQuery}`) }))).then(results => {
      if (!active) return;
      setSourceFields(Object.fromEntries(results.map(r => [r.key, r.fields])));
      const common = (key: 'dimensions' | 'metrics', defaults: string[]) => results.reduce((values, r) => values.filter(v => (r.fields[key] || defaults).includes(v)), results[0]?.fields[key] || defaults);
      const commonDimensions = common('dimensions', p.dimensions), commonMetrics = common('metrics', p.metrics);
      setFields({ dimensions: commonDimensions, metrics: commonMetrics });
      setDimensions(values => values.filter(v => commonDimensions.includes(v)));
      setMetrics(values => values.filter(v => commonMetrics.includes(v)));
      setSourceOptions(previous => Object.fromEntries(results.map(r => [r.key, { tab: r.fields.tabs?.some(t => t.title === previous[r.key]?.tab) ? previous[r.key].tab : r.fields.tabs?.[0]?.title || '' }])));
    }).catch(e => { if (active) setResourceError((e as Error).message); }).finally(() => { if (active) setFieldLoading(false); });
    return () => { active = false; };
  }, [selectedKeys, resources, product, status.connected, apiOptions]);
  useEffect(() => {
    if (!job?.id || job.id === 'direct-query') return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const next = await request<Job>(`/jobs/${job.id}?offset=${offset}`);
        if (!active) return;
        setJob(next);
        if (next.status === 'queued' || next.status === 'running') timer = setTimeout(poll, 1200);
      } catch (e) { if (active) { setError((e as Error).message); timer = setTimeout(poll, 5000); } }
    };
    void poll();
    return () => { active = false; clearTimeout(timer); };
  }, [job?.id, offset]);
  useEffect(() => {
    if (view === 'history' && status.connected) request<Job[]>('/jobs').then(setHistory).catch(e => setError(e.message));
  }, [view, status.connected]);
  useEffect(() => {
    if (!setup) return;
    const previous = document.activeElement as HTMLElement | null;
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSetup(false);
      if (event.key !== 'Tab') return;
      const focusable = document.querySelectorAll<HTMLElement>('.gx-modal button, .gx-modal a[href]');
      const first = focusable[0], last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener('keydown', keyboard);
    return () => { document.removeEventListener('keydown', keyboard); previous?.focus(); };
  }, [setup]);
  function connect(connectionId = '') {
    if (!status.configured) { setSetup(true); return; }
    sessionStorage.setItem('extract-product', product);
    sessionStorage.setItem(`extract-resources-${product}`, JSON.stringify(selectedKeys));
    window.location.href = '/extract-api/auth/connect?product=' + product + (connectionId ? '&connection_id=' + encodeURIComponent(connectionId) : '');
  }
  async function extract() {
    setSubmitting(true); setError('');
    try {
      const specOptions = product === 'api' ? apiOptions : (filters.trim() ? { ...options, filters: filters.trim() } : options);
      const spec = { product, resource: '', start, end, dimensions, metrics, incremental, options: specOptions, targets: selected.map(r => ({ connection_id: r.connection_id, resource: r.id, options: product === 'sheets' ? sourceOptions[resourceKey(r)] || {} : {} })) };
      const r = await request<{ id: string }>('/batches', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(spec) });
      setOffset(0); setJob({ id: r.id, status: 'queued', count: 0, columns: [], rows: [], created: '', spec });
      setTimeout(() => resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
    } catch (e) { setError((e as Error).message); }
    finally { setSubmitting(false); }
  }
  async function applyQuery() {
    const url = cleanEditableUrl(editableQueryUrl);
    if (!url) return;
    setSubmitting(true); setError('');
    try {
      const preview = await request<{ columns: string[]; rows: Record<string, unknown>[]; count: number }>('/query/apply', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url }) });
      const rows = preview.rows;
      const columns = preview.columns;
      setOffset(0);
      setJob({ id: 'direct-query', status: 'complete', count: preview.count, created: new Date().toISOString(), columns, rows: rows.slice(0, 50), spec: { product, resource: 'direct-query', start, end, dimensions, metrics, incremental: false, options: { url } } });
      setTimeout(() => resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
    } catch (e) { setError((e as Error).message); }
    finally { setSubmitting(false); }
  }
  async function disconnect(connectionId: string) {
    try { await request('/auth/disconnect?connection_id=' + encodeURIComponent(connectionId), { method: 'POST' }); setStatus(await request<Status>('/status')); } catch (e) { setError((e as Error).message); }
  }
  function selectResources(rows: Resource[]) {
    const seen = new Set<string>();
    const unique = rows.filter(r => { const key = canonicalResource(r); if (seen.has(key)) return false; seen.add(key); return true; }).slice(0, 100);
    const keys = unique.map(resourceKey);
    setSelectedKeys(keys);
    sessionStorage.setItem(`extract-resources-${product}`, JSON.stringify(keys));
  }
  const toggle = (value: string, selected: string[], set: (v: string[]) => void) => set(selected.includes(value) ? selected.filter(x => x !== value) : [...selected, value]);

  return <div className="gx-app">
    <aside className="gx-sidebar">
      <a className="gx-brand" href="/"><span className="gx-brand-icon"><Layers3 size={23} /></span>extract<span className="gx-brand-dot">.</span></a>
      <div className="gx-workspace"><span className="gx-avatar"><Database size={16} /></span><div>Personal workspace<small>Local environment</small></div><LockKeyhole size={13} /></div>
      <div className="gx-nav-label">WORKSPACE</div>
      <nav><button className={view === 'extract' ? 'active' : ''} onClick={() => setView('extract')}><Layers3 size={18} />Data extraction<span className="gx-nav-dot" /></button><button className={view === 'history' ? 'active' : ''} onClick={() => setView('history')}><History size={18} />Extraction history</button><button onClick={() => setSetup(true)}><Settings2 size={18} />Connection settings</button></nav>
      <div className="gx-sidebar-bottom"><div className="gx-private"><ShieldCheck size={19} /><strong>Your data stays yours.</strong><p>Extract directly from Google.<br />Keep your files on your computer.</p><span><i /> Built for personal use</span></div><button className="gx-help" onClick={() => setSetup(true)}><CircleHelp size={17} />Setup & documentation<ExternalLink size={13} /></button><div className="gx-user"><span className="gx-user-avatar">{status.email?.[0]?.toUpperCase() || 'P'}</span><div>{status.email || 'Personal account'}<small>Local workspace</small></div></div></div>
    </aside>
    <div className="gx-main"><header className="gx-topbar"><div>Workspace <ChevronRight size={13} /><strong>{view === 'history' ? 'Extraction history' : 'Data extraction'}</strong></div><span className="gx-local"><span /> Running locally</span></header>
      <main className="gx-content"><div className="gx-page-heading"><div><div className="gx-eyebrow">YOUR GOOGLE DATA, SIMPLIFIED</div><h1>{view === 'history' ? 'Extraction history' : 'Your data. Ready to go.'}</h1><p>{view === 'history' ? 'Revisit your local extractions and download your files.' : 'Connect, select, and extract. Clean data from Google, in just a few clicks.'}</p></div><button className="gx-button gx-secondary" onClick={() => setSetup(true)}><CircleHelp size={16} />Setup guide<ExternalLink size={13} /></button></div>
      {error && <div role="alert" className="gx-alert">{error}<button aria-label="Dismiss error" onClick={() => setError('')}><X size={16} /></button></div>}
      {view === 'history' ? <section className="gx-panel gx-history"><div className="gx-panel-title"><h2>Recent extractions</h2><span className="gx-muted">Saved on this computer</span></div>{!status.connected ? <div className="gx-empty"><History size={30} /><h3>Connect to see your extractions</h3><p>Your extraction history belongs to your Google account.</p><button className="gx-button gx-primary" onClick={() => connect()}>Connect Google</button></div> : history.length === 0 ? <div className="gx-empty"><History size={30} /><h3>No extractions yet</h3><p>Your completed and failed runs will appear here.</p><button className="gx-button gx-primary" onClick={() => setView('extract')}>Create an extraction</button></div> : history.map(h => <div className="gx-history-row" key={h.id}><ProductIcon id={h.spec.product} small /><div><strong>{status.products.find(x => x.id === h.spec.product)?.name}</strong><small>{h.spec.targets?.length ? `${h.spec.targets.length} sources · ` : ''}{h.created} UTC · {h.spec.start} – {h.spec.end}</small></div><span className={`gx-job-status ${h.status}`}>{h.status}</span><span>{h.count.toLocaleString()} rows</span><button className="gx-button gx-secondary" onClick={() => { setOffset(0); setJob({ ...h, columns: [], rows: [] }); setView('extract'); setTimeout(() => resultRef.current?.scrollIntoView({ behavior: 'smooth' }), 100); }}>View</button><button className="gx-icon-button" title="Delete this extraction" aria-label="Delete this extraction" disabled={['running', 'queued'].includes(h.status)} onClick={async () => { try { await request(`/jobs/${h.id}`, { method: 'DELETE' }); setHistory(items => items.filter(x => x.id !== h.id)); if (job?.id === h.id) setJob(null); } catch (e) { setError((e as Error).message); } }}><X size={16} /></button></div>)}</section> : <>
      <div className="gx-steps">{['Connect Google', 'Select your data', 'Extract & export'].map((name, i) => <div key={name} className={(i === 0 || status.connected ? 'gx-step-active ' : '') + 'gx-step'}><span>{i === 0 && status.connected ? <Check size={14} /> : `0${i + 1}`}</span>{name}{i < 2 && <div className="gx-step-line" />}</div>)}</div>
      {product !== 'api' && <section className="gx-connections">
        <div className="gx-connect-panel"><div className="gx-google-letter">G</div><div className="gx-connect-copy"><h2>{status.connected ? `${status.accounts?.length || 0} Google account${status.accounts?.length === 1 ? '' : 's'} connected` : 'Start with your Google accounts'}{status.connected && <span className="gx-connected-badge">Connected</span>}</h2><p>{status.connected ? 'Add more logins, then select properties across your connected accounts.' : 'Connect your Google logins to discover the accounts and properties you already have access to.'}</p></div><button className="gx-button gx-primary" disabled={busy} onClick={() => connect()}><Plus size={17} />{status.connected ? 'Add Google account' : 'Connect Google'}</button></div>
        {!!status.accounts?.length && <div className="gx-account-list">{status.accounts.map(account => <div className="gx-account-row" key={account.id}><span className="gx-user-avatar">{account.email[0]?.toUpperCase()}</span><div><strong>{account.email}</strong><small>{account.id === status.workspace_owner ? 'Primary workspace login' : 'Additional Google login'} · {account.products.includes(product) ? `${p.name} authorized` : `${p.name} needs permission`}</small></div><button className="gx-button gx-secondary" disabled={busy} onClick={() => connect(account.id)}>{account.products.includes(product) ? 'Reconnect' : 'Authorize product'}</button><button className="gx-icon-button" disabled={busy} title={`Disconnect ${account.email}`} aria-label={`Disconnect ${account.email}`} onClick={() => disconnect(account.id)}><Unplug size={16} /></button></div>)}</div>}
      </section>}
      <div className="gx-selection-heading"><div><h2><span className="gx-section-number">1</span>Choose a data product</h2><p>Google products use OAuth. API Endpoint connects to a pasted JSON URL.</p></div><span className="gx-count">{status.products.length} connectors</span></div>
      <div className="gx-products">{status.products.map(item => <button disabled={busy} key={item.id} onClick={() => setProduct(item.id)} className={'gx-product-card ' + (product === item.id ? 'selected' : '')}><div className="gx-product-card-top"><ProductIcon id={item.id} /><span className="gx-radio">{product === item.id && <span />}</span></div><strong>{item.name}</strong><span className="gx-product-description">{item.description}</span></button>)}</div>
      <section className="gx-panel gx-config"><div className="gx-panel-title"><h2><span className="gx-section-number">2</span>Configure your extraction</h2><div className="gx-selected-product"><ProductIcon id={product} small />{p.name}</div></div><div className="gx-config-body">
      {product === 'api' && <div className="gx-api-form">
        <div className="gx-resource-row"><div className="gx-field gx-resource-field"><label>API endpoint <span className="gx-required">*</span></label><small><Link2 size={12} />Paste a JSON API endpoint. The app samples the response and turns detected rows into a clean table.</small></div></div>
        <div className="gx-api-grid">
          <div className="gx-field"><label htmlFor="api-method">Method</label><select id="api-method" value={apiOptions.method} disabled={busy} onChange={e => setApiOptions(v => ({ ...v, method: e.target.value }))}><option>GET</option><option>POST</option></select></div>
          <div className="gx-field"><label htmlFor="api-url">Endpoint URL</label><input id="api-url" placeholder="https://api.example.com/reports" value={apiOptions.url} disabled={busy} onChange={e => setApiOptions(v => ({ ...v, url: e.target.value }))} /></div>
        </div>
        <div className="gx-api-grid">
          <div className="gx-field"><label htmlFor="api-path">Data path</label><input id="api-path" placeholder="Optional, for example data.items" value={apiOptions.data_path} disabled={busy} onChange={e => setApiOptions(v => ({ ...v, data_path: e.target.value }))} /></div>
          <div className="gx-field"><label htmlFor="api-limit">Row limit</label><input id="api-limit" type="number" min="1" max="1000000" value={apiOptions.limit} disabled={busy} onChange={e => setApiOptions(v => ({ ...v, limit: e.target.value }))} /></div>
        </div>
        <div className="gx-field"><label htmlFor="api-headers">Headers JSON</label><textarea id="api-headers" placeholder={'{"Authorization":"Bearer YOUR_TOKEN"}'} value={apiOptions.headers} disabled={busy} onChange={e => setApiOptions(v => ({ ...v, headers: e.target.value }))} /></div>
        {apiOptions.method === 'POST' && <div className="gx-field"><label htmlFor="api-body">Body JSON</label><textarea id="api-body" placeholder={'{"from":"2026-01-01","to":"2026-12-31"}'} value={apiOptions.body} disabled={busy} onChange={e => setApiOptions(v => ({ ...v, body: e.target.value }))} /></div>}
      </div>}
      {product !== 'api' && <>
      <div className="gx-resource-row"><div className="gx-field gx-resource-field"><label>Accounts / properties <span className="gx-required">*</span> <span className="gx-count">{selected.length} selected</span></label><small><ShieldCheck size={12} />Select up to 100 resources across your Google logins. No individual property grants.</small></div><button className="gx-button gx-secondary" disabled={!status.connected || loading || busy} onClick={() => setRefresh(v => v + 1)}>{loading ? <Loader2 className="gx-spin" size={16} /> : <RefreshCw size={16} />}Refresh</button></div>
      {!status.connected ? <div className="gx-resource-placeholder">Connect Google to discover your properties.</div> : loading ? <div className="gx-resource-placeholder"><Loader2 className="gx-spin" size={16} />Discovering resources across your connected logins…</div> : <>
      <div className="gx-resource-toolbar"><div className="gx-field-search"><Search size={15} /><input aria-label="Search accounts and properties" placeholder="Search account, property, or Google email…" value={resourceSearch} onChange={e => setResourceSearch(e.target.value)} /></div><button disabled={busy || !visibleResources.length} onClick={() => selectResources([...selected, ...visibleResources])}>Select all visible</button><button disabled={busy || !selected.length} onClick={() => selectResources([])}>Clear</button></div>
      <div className="gx-resource-options">{(status.accounts || []).map(account => {
        const accountResources = visibleResources.filter(r => r.connection_id === account.id);
        if (!accountResources.length) return null;
        return <fieldset key={account.id}><legend>{account.email}</legend>{accountResources.map(r => {
          const checked = selectedKeys.includes(resourceKey(r));
          const duplicate = !checked && selected.some(other => canonicalResource(other) === canonicalResource(r));
          return <label key={resourceKey(r)} className={'gx-resource-option ' + (checked ? 'checked' : '')}><input type="checkbox" checked={checked} disabled={busy || duplicate || (!checked && selected.length >= 100)} onChange={() => selectResources(checked ? selected.filter(other => resourceKey(other) !== resourceKey(r)) : [...selected, r])} /><span><strong>{r.name}</strong><small>{r.group ? `${r.group} / ` : ''}{r.id}{duplicate ? ' · Already selected under another login' : ''}</small></span></label>;
        })}</fieldset>;
      })}{!visibleResources.length && <p className="gx-muted">{resources.length ? 'No resources match your search.' : 'No accessible resources found for this product.'}</p>}</div>
      </>}
      {accountErrors.map(({ account, message }) => <div className="gx-resource-notice" role="alert" key={account.id}><span><strong>{account.email}</strong><br />{message}</span><button className="gx-button gx-secondary" disabled={busy} onClick={() => connect(account.id)}>Authorize / reconnect<ExternalLink size={13} /></button></div>)}
      {resourceError && <div className="gx-resource-notice" role="alert">{resourceError}</div>}
      </>}
      {fieldLoading && <p className="gx-note"><Loader2 size={14} className="gx-spin" />Checking fields for every selected property…</p>}
      {selected.length > 1 && <p className="gx-note"><Layers3 size={14} />One combined export, with source Google account and property columns. Only fields available on all selected properties are listed.</p>}
      {p.note && <p className="gx-note"><CircleHelp size={14} />{p.note}</p>}
      {(p.metrics.length > 0 || product === 'ga4' || product === 'api') && <>{product !== 'api' && <><div className="gx-date-heading"><label>Date range</label><button onClick={() => { setStart(monthAgo()); setEnd(yesterday()); }} disabled={busy}>Last 30 days <ChevronDown size={12} /></button></div><div className="gx-date-row"><div className="gx-field"><label htmlFor="start" className="gx-sub-label">Start date</label><input type="date" id="start" value={start} max={end} onChange={e => setStart(e.target.value)} disabled={busy} /></div><span>—</span><div className="gx-field"><label htmlFor="end" className="gx-sub-label">End date</label><input type="date" id="end" value={end} min={start} max={iso(new Date())} onChange={e => setEnd(e.target.value)} disabled={busy} /></div><div className="gx-date-note">Inclusive dates<br /><span>Dates use the source reporting timezone.</span></div></div></>}<div className="gx-field-search"><Search size={15} /><input aria-label="Search dimensions and metrics" placeholder={product === 'api' ? 'Find a detected API field…' : 'Find a dimension or metric…'} value={fieldSearch} onChange={e => setFieldSearch(e.target.value)} /></div><div className="gx-field-columns">{([{ title: product === 'api' ? 'Columns' : 'Dimensions', help: product === 'api' ? 'Included in the output table' : 'Group your data by', values: availableDimensions, selected: dimensions, set: setDimensions }, { title: product === 'api' ? 'Numeric columns' : 'Metrics', help: product === 'api' ? 'Detected numeric fields' : 'Choose what to measure', values: availableMetrics, selected: metrics, set: setMetrics }]).map(group => <div className="gx-field-picker" key={group.title}><div className="gx-field-picker-heading"><label>{group.title} <span>{group.selected.length} selected</span></label><small>{group.help}</small></div><div className="gx-field-options">{group.values.filter(x => x.toLowerCase().includes(fieldSearch.toLowerCase())).map(value => <label key={value} className={'gx-check-option ' + (group.selected.includes(value) ? 'checked' : '')}><input type="checkbox" disabled={busy} checked={group.selected.includes(value)} onChange={() => toggle(value, group.selected, group.set)} /><span>{label(value)}</span><code>{value}</code></label>)}{!group.values.filter(x => x.toLowerCase().includes(fieldSearch.toLowerCase())).length && <p className="gx-muted">{product === 'api' && !apiOptions.url.trim() ? 'Paste an endpoint URL to inspect fields.' : 'No matching fields'}</p>}</div></div>)}</div></>}
      {product === 'sheets' && selected.map(r => <div className="gx-field gx-source-tab" key={resourceKey(r)}><label htmlFor={'tab-' + resourceKey(r)}>Worksheet in {r.name}</label><select id={'tab-' + resourceKey(r)} value={sourceOptions[resourceKey(r)]?.tab || ''} disabled={!sourceFields[resourceKey(r)]?.tabs?.length || busy || fieldLoading} onChange={e => setSourceOptions(previous => ({ ...previous, [resourceKey(r)]: { tab: e.target.value } }))}><option value="">Select a worksheet</option>{sourceFields[resourceKey(r)]?.tabs?.map(t => <option key={t.title}>{t.title}</option>)}</select><small>{r.email} · Row 1 supplies headers. Different sheet columns are combined with nulls for missing values.</small></div>)}
      {product === 'search' && <div className="gx-field"><label htmlFor="search-type">Search type</label><select id="search-type" disabled={busy} value={options.search_type || 'web'} onChange={e => setOptions({ search_type: e.target.value })}>{['web', 'image', 'video', 'news', 'discover', 'googleNews'].map(t => <option key={t}>{t}</option>)}</select></div>}
      {!['api', 'business', 'drive', 'sheets'].includes(product) && <div className="gx-field"><label htmlFor="filters-json">Filters JSON</label><textarea id="filters-json" placeholder={'Optional GA4 example: {"dimensionFilter":{"filter":{"fieldName":"country","stringFilter":{"matchType":"EXACT","value":"United Kingdom"}}}}'} value={filters} disabled={busy} onChange={e => setFilters(e.target.value)} /></div>}
      {['business', 'drive'].includes(product) && <div className="gx-inventory-note"><Database size={20} /><div><strong>{product === 'business' ? 'Business location inventory' : 'Accessible file inventory'}</strong><p>{product === 'business' ? 'Extract location names, addresses, contact details, and website URLs.' : 'Extract file IDs, names, types, sizes, and modification times.'} This is a current snapshot; no date range is required.</p></div></div>}
      </div><div className="gx-config-footer"><div>{p.incremental ? <label className="gx-incremental"><input type="checkbox" checked={incremental} disabled={busy} onChange={e => setIncremental(e.target.checked)} /><div>Incremental extraction<small>Each property keeps its own successful-run checkpoint.</small></div></label> : <span className="gx-muted"><ShieldCheck size={14} /> Read-only extraction</span>}</div><button className="gx-button gx-primary gx-extract-button" disabled={(product !== 'api' && !status.connected) || (product === 'api' && !apiOptions.url.trim()) || !selected.length || busy || loading || fieldLoading || !!resourceError || (p.metrics.length > 0 && !metrics.length) || (product === 'sheets' && selected.some(r => !sourceOptions[resourceKey(r)]?.tab))} onClick={extract}>{busy ? <Loader2 size={16} className="gx-spin" /> : <Play size={14} fill="currentColor" />}{busy ? 'Extracting…' : selected.length > 1 && product !== 'api' ? `Extract ${selected.length} sources` : 'Extract data'}{!busy && <ArrowRight size={16} />}</button></div></section>
      <section className="gx-panel gx-query-panel"><div className="gx-panel-title"><h2><span className="gx-section-number">3</span>Self-contained API endpoint</h2><div className="gx-export-actions"><button className="gx-button gx-secondary" disabled={!queryUrl || editableQueryUrl === queryUrl || busy} onClick={() => setEditableQueryUrl(queryUrl)}><RefreshCw size={15} />Reset generated</button><button className="gx-button gx-secondary" disabled={!editableQueryUrl.trim() || busy} onClick={applyQuery}>{busy ? <Loader2 size={15} className="gx-spin" /> : <Play size={14} fill="currentColor" />}Apply query</button><button className="gx-button gx-secondary" disabled={!editableQueryUrl.trim()} onClick={() => navigator.clipboard?.writeText(cleanEditableUrl(editableQueryUrl)).catch(() => {})}><Copy size={15} />Copy query</button></div></div><div className="gx-query-body"><p className="gx-muted"><Link2 size={14} />Use this complete URL in Power BI/Dataflow or any API client. You can edit it here: change dates, fields, filters, resources, format, or paste/write your own endpoint before copying.</p><textarea value={editableQueryUrl} placeholder={product === 'api' && !apiOptions.url.trim() ? 'Paste an API endpoint URL to generate a query, or write your own backend query URL here.' : !queryKey ? 'Connect Google once to generate your API key, or paste an existing query URL here.' : 'Select at least one source to generate a query, or write/paste an existing query URL here.'} onChange={e => setEditableQueryUrl(e.target.value)} /></div></section>
      <section className="gx-panel gx-results" ref={resultRef}><div className="gx-panel-title"><h2><span className="gx-section-number">4</span>Preview & export {job && <span className={`gx-job-status ${job.status}`}>{job.status}</span>}</h2><div className="gx-export-actions">{(['csv', 'json'] as const).map(fmt => job && ['complete', 'partial'].includes(job.status) ? (job.id === 'direct-query' ? <a className="gx-button gx-secondary" key={fmt} href={urlWithFormat(job.spec.options.url || editableQueryUrl, fmt)}>{fmt === 'csv' ? <ArrowDownToLine size={15} /> : <FileJson size={15} />}{fmt.toUpperCase()}</a> : <a className="gx-button gx-secondary" key={fmt} href={`/extract-api/jobs/${job.id}/export?format=${fmt}${job.status === 'partial' ? '&successful_only=true' : ''}`}>{fmt === 'csv' ? <ArrowDownToLine size={15} /> : <FileJson size={15} />}{fmt.toUpperCase()}{job.status === 'partial' ? ' (successful sources)' : ''}</a>) : <button key={fmt} className="gx-button gx-secondary" disabled>{fmt === 'csv' ? <ArrowDownToLine size={15} /> : <FileJson size={15} />}{fmt.toUpperCase()}</button>)}</div></div>{!job ? <div className="gx-empty"><div className="gx-empty-icon"><FileSpreadsheet size={27} /><span><Sparkles size={11} /></span></div><h3>A clean table is just a few clicks away</h3><p>Select your source and fields, then click <strong>Extract data.</strong><br />Your results will appear here, ready for CSV or JSON export.</p><div className="gx-empty-pills"><span><Check size={12} />Consistent columns</span><span><Check size={12} />Duplicates removed</span><span><Check size={12} />CSV & JSON</span></div></div> : <>{job.error && <div className="gx-alert" role="alert">{job.error} {job.status === 'partial' ? 'Exports marked successful sources exclude failed sources.' : 'This run is not available for export.'}</div>}{!!job.sources?.length && <div className="gx-source-progress">{job.sources.map(source => <div key={source.position}><span className={`gx-job-status ${source.status}`}>{source.status === 'skipped' ? 'Up to date' : source.status}</span><div><strong>{source.name}</strong><small>{source.email} · {source.resource}{source.status !== 'skipped' ? ` · ${source.start_date} – ${source.end_date}` : ''}</small>{source.error && <p role="alert">{source.error}</p>}</div><span>{source.count.toLocaleString()} rows</span></div>)}</div>}<div className="gx-result-summary"><strong>{job.count.toLocaleString()} rows</strong><span>{job.columns.length} columns</span>{!!job.sources?.length && <span>{job.sources.length} sources</span>}<span>{status.products.find(x => x.id === job.spec.product)?.name} · {job.spec.start} – {job.spec.end}</span>{['queued', 'running'].includes(job.status) && <span><Loader2 size={13} className="gx-spin" />Fetching data from Google…</span>}</div>{job.rows.length ? <div className="gx-table-scroll"><table><thead><tr><th>#</th>{job.columns.map(c => <th key={c}>{c}</th>)}</tr></thead><tbody>{job.rows.map((row, index) => <tr key={index}><td>{offset + index + 1}</td>{job.columns.map(c => <td key={c}>{row[c] === null || row[c] === undefined ? <span className="gx-null">null</span> : String(row[c])}</td>)}</tr>)}</tbody></table></div> : <div className="gx-empty gx-empty-short">{job.status === 'complete' ? <><CheckCircle2 size={25} /><h3>Extraction complete — no rows returned</h3><p>Try another date range or field selection.</p></> : <><Database size={25} /><p>{job.status === 'failed' ? 'No rows to display.' : 'Waiting for the first batch of rows…'}</p></>}</div>}<div className="gx-table-footer"><span>{job.count ? `${offset + 1}–${Math.min(offset + 50, job.count)} of ${job.count.toLocaleString()} rows` : '0 rows'} · Exports include all completed rows</span><div><button aria-label="Previous page" disabled={offset === 0} onClick={() => setOffset(v => Math.max(0, v - 50))}><ChevronLeft size={17} /></button><button aria-label="Next page" disabled={offset + 50 >= job.count} onClick={() => setOffset(v => v + 50)}><ChevronRight size={17} /></button></div></div></>}</section>
      <footer className="gx-page-footer"><LockKeyhole size={13} />Secure Google OAuth <span>·</span> Direct API extraction <span>·</span> Stored locally<span className="gx-footer-right">Made for your workflow.</span></footer>
      </>}
      </main>
    </div>
    {setup && <div className="gx-modal-backdrop" onClick={() => setSetup(false)}><section className="gx-modal" role="dialog" aria-modal="true" aria-labelledby="setup-title" onClick={e => e.stopPropagation()}><button autoFocus className="gx-modal-close" aria-label="Close setup guide" onClick={() => setSetup(false)}><X size={20} /></button><div className="gx-eyebrow">ONE-TIME LOCAL SETUP</div><h2 id="setup-title">Connect your Google Cloud project</h2><p>Google requires your own OAuth client for this personal app. Once configured, the Connect Google button discovers resources you already have permission to access.</p><ol><li>Create a Google Cloud project and enable the APIs for the products you want to extract.</li><li>Configure the OAuth consent screen. Add your Google email as a test user if the app is in Testing.</li><li>Create an OAuth client of type <strong>Web application</strong>. Set this exact authorized redirect URI:<code>http://127.0.0.1:3001/extract-api/auth/callback</code></li><li>Copy <code>backend/.env.example</code> to <code>backend/.env</code>. Set your client ID, client secret, and a generated encryption key. Keep these on the server.</li><li>Install and start the Python backend:<code>python -m pip install -r backend/requirements.txt<br />python -m uvicorn backend.main:app --host 127.0.0.1 --port 8000</code></li><li>Start the frontend with <code>npm run dev</code> and open <strong>http://127.0.0.1:3001</strong>.</li></ol><p className="gx-note">Google Ads needs a developer token. Business Profile needs API approval. See README.md for API names, incremental behavior, and source limitations.</p><div className="gx-modal-footer"><a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noreferrer" className="gx-button gx-secondary">Google Cloud Console<ExternalLink size={14} /></a><button className="gx-button gx-primary" onClick={() => { setSetup(false); request<Status>('/status').then(setStatus).catch(e => setError(e.message)); }}>Check connection setup<RefreshCw size={14} /></button></div></section></div>}
  </div>;
}


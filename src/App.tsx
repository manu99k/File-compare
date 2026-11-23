import { useEffect, useMemo, useState } from 'react';
import {
  BookOpen,
  FileDiff,
  FolderGit2,
  Layers,
  Plus,
  Search,
  Settings2,
} from 'lucide-react';
import type {
  AdapterCapability,
  ComparisonRun,
  DesignPackData,
  FileFormat,
  InventoryConfigRule,
  OutcomeStatus,
} from './types/qe';
import { OutcomeBadge } from './components/OutcomeBadge';
import { RunInspector } from './components/RunInspector';
import { NewComparisonView } from './components/NewComparisonView';
import { AdaptersView } from './components/AdaptersView';
import { ConfigView } from './components/ConfigView';
import { DesignPackView } from './components/DesignPackView';

type NavSection = 'runs' | 'new' | 'adapters' | 'config' | 'design';

export default function App() {
  const [nav, setNav] = useState<NavSection>('runs');
  const [runs, setRuns] = useState<ComparisonRun[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [adapters, setAdapters] = useState<AdapterCapability[]>([]);
  const [configs, setConfigs] = useState<InventoryConfigRule[]>([]);
  const [designPack, setDesignPack] = useState<DesignPackData | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingRunDetail, setLoadingRunDetail] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [formatFilter, setFormatFilter] = useState<'ALL' | FileFormat>('ALL');
  const [outcomeFilter, setOutcomeFilter] = useState<'ALL' | OutcomeStatus>('ALL');
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    let active = true;
    async function loadAll() {
      setLoading(true);
      setError(null);
      try {
        const [runsRes, adaptersRes, cfgRes, packRes] = await Promise.all([
          fetch('/api/runs'),
          fetch('/api/adapters'),
          fetch('/api/configs'),
          fetch('/api/design-pack'),
        ]);
        if (!runsRes.ok || !adaptersRes.ok || !cfgRes.ok || !packRes.ok) {
          throw new Error('Failed to load QE workbench data from local server.');
        }
        const [runsJson, adaptersJson, cfgJson, packJson] = await Promise.all([
          runsRes.json(),
          adaptersRes.json(),
          cfgRes.json(),
          packRes.json(),
        ]);
        if (!active) return;
        setRuns(runsJson.runs || []);
        setAdapters(adaptersJson.adapters || []);
        setConfigs(cfgJson.configs || []);
        setDesignPack(packJson || null);
      } catch (err) {
        if (active) {
          setError(err instanceof Error ? err.message : 'Unable to reach local API');
        }
      } finally {
        if (active) setLoading(false);
      }
    }
    loadAll();
    return () => {
      active = false;
    };
  }, []);

  const selectedRun = useMemo(
    () => runs.find((r) => r.id === selectedRunId) || null,
    [runs, selectedRunId]
  );

  const filteredRuns = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return runs.filter((r) => {
      if (formatFilter !== 'ALL' && r.format !== formatFilter) return false;
      if (outcomeFilter !== 'ALL' && r.overallOutcome !== outcomeFilter) return false;
      if (q) {
        const hay = `${r.id} ${r.appCode} ${r.subCode} ${r.baseline.filename} ${r.candidate.filename} ${r.mvp}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [runs, formatFilter, outcomeFilter, searchQuery]);

  const metrics = useMemo(() => {
    return {
      total: runs.length,
      passed: runs.filter((r) => r.overallOutcome === 'VERIFIED_PASS').length,
      defects: runs.filter((r) => r.overallOutcome === 'CONFIRMED_DEFECT').length,
      review: runs.filter((r) => r.overallOutcome === 'POTENTIAL_VARIANCE').length,
      blocked: runs.filter((r) => r.overallOutcome === 'BLOCKED').length,
    };
  }, [runs]);

  const handleRunCreated = (newRun: ComparisonRun) => {
    setRuns((prev) => [newRun, ...prev]);
    setSelectedRunId(newRun.id);
    setNav('runs');
  };

  const handleRunUpdated = (updated: ComparisonRun) => {
    setRuns((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
  };

  const handleSelectRun = async (run: ComparisonRun) => {
    setSelectedRunId(run.id);
    if (!run.isSummary) return;
    setLoadingRunDetail(true);
    try {
      const res = await fetch(`/api/runs/${encodeURIComponent(run.id)}`);
      const raw = await res.text();
      const data = raw ? JSON.parse(raw) : {};
      if (!res.ok) throw new Error(data.error || 'Failed to load run details.');
      if (data.run) {
        setRuns((prev) => prev.map((r) => (r.id === data.run.id ? data.run : r)));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load full comparison run.');
    } finally {
      setLoadingRunDetail(false);
    }
  };

  const breadcrumbLabel =
    nav === 'runs'
      ? selectedRun
        ? `Comparison Runs / ${selectedRun.id}`
        : 'Comparison Runs'
      : nav === 'new'
      ? 'New Comparison'
      : nav === 'adapters'
      ? 'Adapters & Coverage'
      : nav === 'config'
      ? 'Inventory & Config'
      : 'Discovery & Design Pack';

  return (
    <div className="min-h-screen flex bg-slate-50 text-slate-900">
      {/* Left Workspace Sidebar */}
      <aside className="hidden md:flex md:w-64 md:flex-col border-r border-slate-200 bg-white shrink-0">
        <div className="h-14 px-5 flex items-center border-b border-slate-200">
          <span className="font-display text-base font-bold tracking-tight text-slate-900 whitespace-nowrap">
            DocVerify QE
          </span>
        </div>

        <nav className="flex-1 p-3 space-y-1">
          {[
            { id: 'runs' as NavSection, label: 'Comparison Runs', Icon: FileDiff },
            { id: 'new' as NavSection, label: 'New Comparison', Icon: Plus },
            { id: 'adapters' as NavSection, label: 'Adapters & Coverage', Icon: Layers },
            { id: 'config' as NavSection, label: 'Inventory & Config', Icon: Settings2 },
            { id: 'design' as NavSection, label: 'Design & Risk Pack', Icon: BookOpen },
          ].map((item) => {
            const Icon = item.Icon;
            const active = nav === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  setNav(item.id);
                  if (item.id !== 'runs') setSelectedRunId(null);
                }}
                className={`w-full flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors whitespace-nowrap ${
                  active
                    ? 'bg-blue-50 text-blue-700'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                }`}
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="p-4 border-t border-slate-200 text-xs text-slate-500 space-y-1">
          <div className="flex items-center gap-1.5 font-medium text-slate-700">
            <FolderGit2 className="w-3.5 h-3.5 shrink-0" />
            <span>IMDS DCP → DDGS SmartComm</span>
          </div>
          <div>Local Synthetic Sandbox</div>
          <div>Production Submission Disabled</div>
        </div>
      </aside>

      {/* Main Column */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top Bar Contract: Breadcrumbs left, 1 Primary CTA right */}
        <header className="h-14 border-b border-slate-200 bg-white px-6 flex items-center justify-between gap-8 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <span className="md:hidden font-display text-sm font-bold text-slate-900 whitespace-nowrap">
              DocVerify QE
            </span>
            <span className="text-sm font-medium text-slate-600 truncate">
              Migration Validation / {breadcrumbLabel}
            </span>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <button
              type="button"
              onClick={() => {
                setSelectedRunId(null);
                setNav('new');
              }}
              className="inline-flex items-center gap-1.5 rounded-md bg-blue-700 px-3.5 py-2 text-xs font-medium text-white hover:bg-blue-800 transition-colors whitespace-nowrap shrink-0"
            >
              <Plus className="w-3.5 h-3.5" />
              New Comparison
            </button>
          </div>
        </header>

        {/* Mobile Nav Strip */}
        <div className="md:hidden flex items-center gap-1 overflow-x-auto border-b border-slate-200 bg-white px-4 py-2">
          {(
            [
              { id: 'runs', label: 'Runs' },
              { id: 'new', label: 'Upload' },
              { id: 'adapters', label: 'Adapters' },
              { id: 'config', label: 'Config' },
              { id: 'design', label: 'Design Pack' },
            ] as Array<{ id: NavSection; label: string }>
          ).map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                setNav(item.id);
                if (item.id !== 'runs') setSelectedRunId(null);
              }}
              className={`px-3 py-1 rounded text-xs font-medium whitespace-nowrap shrink-0 ${
                nav === item.id ? 'bg-blue-50 text-blue-700' : 'text-slate-600'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>

        {/* Main Content Viewport */}
        <main className="flex-1 p-6 max-w-[1400px] w-full mx-auto">
          {error && (
            <div className="mb-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
              {error}
            </div>
          )}

          {nav === 'runs' && selectedRun && (
            <RunInspector
              run={selectedRun}
              loadingDetail={loadingRunDetail}
              onBack={() => setSelectedRunId(null)}
              onRunUpdated={handleRunUpdated}
            />
          )}

          {nav === 'runs' && !selectedRun && (
            <div className="space-y-6">
              <div>
                <h1 className="text-xl font-semibold text-slate-900">
                  Document Migration Comparison Runs
                </h1>
                <p className="text-xs text-slate-500 mt-1">
                  Validate IMDS/OpenText DCP baseline outputs against DDGS/SmartComm candidates across AFP (Papyrus), PDF, PCL, and RT/RPT files.
                </p>
              </div>

              {/* Quantitative KPI Strip */}
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                {[
                  { label: 'Total Runs', value: metrics.total, tone: 'text-slate-900' },
                  { label: 'Verified Pass', value: metrics.passed, tone: 'text-emerald-700' },
                  { label: 'Confirmed Defect', value: metrics.defects, tone: 'text-red-700' },
                  { label: 'Human Review / Papyrus', value: metrics.review, tone: 'text-amber-700' },
                  { label: 'Blocked', value: metrics.blocked, tone: 'text-slate-700' },
                ].map((stat) => (
                  <div
                    key={stat.label}
                    className="rounded-lg border border-slate-200 bg-white px-4 py-3.5"
                  >
                    <div className="text-xs text-slate-500">{stat.label}</div>
                    <div className={`mt-1 text-2xl font-semibold font-mono tabular-nums ${stat.tone}`}>
                      {loading ? '—' : stat.value}
                    </div>
                  </div>
                ))}
              </div>

              {/* Filter & Search Toolbar */}
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-4 py-3">
                <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-md overflow-x-auto">
                  {(['ALL', 'AFP', 'PDF', 'PCL', 'RT'] as const).map((fmt) => (
                    <button
                      key={fmt}
                      type="button"
                      onClick={() => setFormatFilter(fmt)}
                      className={`px-3 py-1.5 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 ${
                        formatFilter === fmt
                          ? 'bg-white text-slate-900 shadow-sm'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      {fmt === 'ALL' ? 'All Formats' : fmt === 'RT' ? 'RT / RPT' : fmt}
                    </button>
                  ))}
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  <select
                    value={outcomeFilter}
                    onChange={(e) => setOutcomeFilter(e.target.value as 'ALL' | OutcomeStatus)}
                    aria-label="Filter by outcome status"
                    className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-700"
                  >
                    <option value="ALL">All Outcomes</option>
                    <option value="VERIFIED_PASS">Verified Pass</option>
                    <option value="CONFIRMED_DEFECT">Confirmed Defect</option>
                    <option value="POTENTIAL_VARIANCE">Potential Variance (Review)</option>
                    <option value="BLOCKED">Blocked</option>
                  </select>

                  <div className="relative">
                    <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Filter run ID, app code, file..."
                      className="w-56 rounded-md border border-slate-300 pl-8 pr-3 py-1.5 text-xs text-slate-900 placeholder:text-slate-400"
                    />
                  </div>
                </div>
              </div>

              {/* High-Density Runs Table */}
              <div className="rounded-lg border border-slate-200 bg-white overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-50 text-slate-500 border-b border-slate-200">
                      <tr>
                        <th className="px-4 py-3 font-medium">Run ID</th>
                        <th className="px-4 py-3 font-medium">Format</th>
                        <th className="px-4 py-3 font-medium">App / Sub-Code</th>
                        <th className="px-4 py-3 font-medium">IMDS Baseline → DDGS Candidate</th>
                        <th className="px-4 py-3 font-medium text-right">Pages / Records</th>
                        <th className="px-4 py-3 font-medium text-right">Findings</th>
                        <th className="px-4 py-3 font-medium">Outcome</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {loading ? (
                        Array.from({ length: 4 }).map((_, idx) => (
                          <tr key={idx}>
                            <td colSpan={7} className="px-4 py-4">
                              <div className="h-4 w-full rounded bg-slate-100 animate-pulse" />
                            </td>
                          </tr>
                        ))
                      ) : filteredRuns.length === 0 ? (
                        <tr>
                          <td colSpan={7} className="px-4 py-10 text-center text-slate-500">
                            <div className="space-y-2">
                              <p>No comparison runs match the selected filters.</p>
                              <button
                                type="button"
                                onClick={() => {
                                  setFormatFilter('ALL');
                                  setOutcomeFilter('ALL');
                                  setSearchQuery('');
                                }}
                                className="text-blue-700 font-medium hover:underline"
                              >
                                Clear filters
                              </button>
                            </div>
                          </td>
                        </tr>
                      ) : (
                        filteredRuns.map((run) => (
                          <tr
                            key={run.id}
                            onClick={() => handleSelectRun(run)}
                            className="cursor-pointer hover:bg-slate-50 transition-colors"
                          >
                            <td className="px-4 py-3 font-mono font-semibold text-blue-700 whitespace-nowrap">
                              {run.id}
                            </td>
                            <td className="px-4 py-3 font-mono font-medium text-slate-800 whitespace-nowrap">
                              {run.format}
                            </td>
                            <td className="px-4 py-3 whitespace-nowrap">
                              <div className="font-mono text-slate-900">
                                {run.appCode} / {run.subCode}
                              </div>
                              <div className="text-[11px] text-slate-500">
                                {run.environmentMarker} · {run.configVersion}
                              </div>
                            </td>
                            <td className="px-4 py-3 font-mono text-[11px] text-slate-700">
                              <div className="truncate max-w-xs">{run.baseline.filename}</div>
                              <div className="truncate max-w-xs text-slate-500">{run.candidate.filename}</div>
                            </td>
                            <td className="px-4 py-3 font-mono tabular-nums text-right text-slate-800 whitespace-nowrap">
                              {run.baseline.pageCount}p / {run.baseline.recordCount}r
                            </td>
                            <td className="px-4 py-3 font-mono tabular-nums text-right text-slate-800 whitespace-nowrap">
                              {run.findings.length}
                            </td>
                            <td className="px-4 py-3 whitespace-nowrap">
                              <OutcomeBadge status={run.overallOutcome} />
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {nav === 'new' && (
            <NewComparisonView configs={configs} onRunCreated={handleRunCreated} />
          )}

          {nav === 'adapters' && <AdaptersView adapters={adapters} />}

          {nav === 'config' && <ConfigView configs={configs} />}

          {nav === 'design' && <DesignPackView pack={designPack} />}
        </main>
      </div>
    </div>
  );
}

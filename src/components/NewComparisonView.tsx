import { useState } from 'react';
import { Play, ShieldCheck, Upload } from 'lucide-react';
import type { ComparisonRun, FileFormat, InventoryConfigRule } from '../types/qe';

interface NewComparisonViewProps {
  configs: InventoryConfigRule[];
  onRunCreated: (run: ComparisonRun) => void;
}

export function NewComparisonView({ configs, onRunCreated }: NewComparisonViewProps) {
  const [selectedConfigId, setSelectedConfigId] = useState(configs[0]?.id || '');
  const [formatOverride, setFormatOverride] = useState<FileFormat | 'AUTO'>('AUTO');
  const [baselineFile, setBaselineFile] = useState<File | null>(null);
  const [candidateFile, setCandidateFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedConfig = configs.find((c) => c.id === selectedConfigId) || configs[0];

  const parseResponseJson = async (res: Response) => {
    const text = await res.text();
    try {
      return text ? JSON.parse(text) : {};
    } catch {
      throw new Error(
        res.ok
          ? 'Unexpected non-JSON response from server.'
          : `Server returned HTTP ${res.status}: ${text.replace(/<[^>]+>/g, ' ').trim().slice(0, 180) || res.statusText}`
      );
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!baselineFile || !candidateFile) {
      setError('Select both an IMDS baseline file and a DDGS candidate file.');
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      const fd = new FormData();
      fd.append('configId', selectedConfigId);
      if (formatOverride !== 'AUTO') {
        fd.append('format', formatOverride);
      }
      fd.append('baseline', baselineFile);
      fd.append('candidate', candidateFile);

      const res = await fetch('/api/compare', {
        method: 'POST',
        body: fd,
      });
      const data = await parseResponseJson(res);
      if (!res.ok) throw new Error(data.error || 'Comparison failed');
      onRunCreated(data.run);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Comparison request failed');
    } finally {
      setSubmitting(false);
    }
  };

  const runNegativeTest = async (scenario: string) => {
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch('/api/compare/negative-test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scenario }),
      });
      const data = await parseResponseJson(res);
      if (!res.ok) throw new Error(data.error || 'Negative test failed');
      onRunCreated(data.run);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Negative test execution failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <form
          onSubmit={handleSubmit}
          className="lg:col-span-2 rounded-lg border border-slate-200 bg-white p-6 space-y-5"
        >
          <div>
            <h1 className="text-lg font-semibold text-slate-900">
              Run Local Sanitized File Comparison
            </h1>
            <p className="text-xs text-slate-500 mt-1">
              Files are processed strictly in-memory inside this local sandbox. Production submission is disabled by policy.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1.5">
                Approved Inventory Configuration
              </label>
              <select
                value={selectedConfigId}
                onChange={(e) => setSelectedConfigId(e.target.value)}
                className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900"
              >
                {configs.map((cfg) => (
                  <option key={cfg.id} value={cfg.id}>
                    {cfg.appCode}/{cfg.subCode} · {cfg.expectedFormats.join(',')} · {cfg.version}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1.5">
                Target Format Adapter
              </label>
              <select
                value={formatOverride}
                onChange={(e) => setFormatOverride(e.target.value as FileFormat | 'AUTO')}
                className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900"
              >
                <option value="AUTO">Auto-detect from file extension</option>
                <option value="AFP">AFP / MO:DCA (Papyrus Review)</option>
                <option value="PDF">PDF Document + Visual Diff</option>
                <option value="PCL">PCL5 / Print Stream</option>
                <option value="RT">RT / RPT Report File</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="rounded-md border border-dashed border-slate-300 bg-slate-50 p-4 space-y-2">
              <div className="text-xs font-semibold text-slate-800">
                IMDS Baseline (OpenText DCP)
              </div>
              <input
                type="file"
                accept=".afp,.pdf,.pcl,.prn,.rt,.rpt,.txt,.gz"
                onChange={(e) => setBaselineFile(e.target.files?.[0] || null)}
                className="block w-full text-xs text-slate-600 file:mr-3 file:rounded file:border file:border-slate-300 file:bg-white file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-slate-700"
              />
              <div className="text-[11px] text-slate-500">
                {baselineFile
                  ? `${baselineFile.name} (${(baselineFile.size / (1024 * 1024)).toFixed(2)} MB)`
                  : 'Accepts .afp, .pdf, .pcl, .rt, .rpt, or .gz (up to 500 MB per file / 500 MB decompressed)'}
              </div>
            </div>

            <div className="rounded-md border border-dashed border-slate-300 bg-slate-50 p-4 space-y-2">
              <div className="text-xs font-semibold text-slate-800">
                DDGS Candidate (SmartComm)
              </div>
              <input
                type="file"
                accept=".afp,.pdf,.pcl,.prn,.rt,.rpt,.txt,.gz"
                onChange={(e) => setCandidateFile(e.target.files?.[0] || null)}
                className="block w-full text-xs text-slate-600 file:mr-3 file:rounded file:border file:border-slate-300 file:bg-white file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-slate-700"
              />
              <div className="text-[11px] text-slate-500">
                {candidateFile
                  ? `${candidateFile.name} (${(candidateFile.size / (1024 * 1024)).toFixed(2)} MB)`
                  : 'Processed locally in memory up to 500 MB; PII tokens redacted in findings'}
              </div>
            </div>
          </div>

          {selectedConfig && (
            <div className="rounded-md border border-slate-200 bg-slate-50/70 p-3.5 text-xs text-slate-600 space-y-1">
              <div>
                <span className="font-medium text-slate-800">Pairing Keys: </span>
                <span className="font-mono">{selectedConfig.pairingKeys.join(' + ')}</span>
              </div>
              <div>
                <span className="font-medium text-slate-800">Approved PII Fields: </span>
                <span className="font-mono">{selectedConfig.piiFields.join(', ')}</span>
              </div>
              <div>
                <span className="font-medium text-slate-800">Visual / Numeric Tolerance: </span>
                <span className="font-mono tabular-nums">
                  {selectedConfig.visualTolerancePct}% visual · ${selectedConfig.numericToleranceAbs.toFixed(2)} numeric
                </span>
              </div>
            </div>
          )}

          {error && (
            <div className="rounded-md border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs text-red-800 font-medium">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="inline-flex items-center gap-2 rounded-md bg-blue-700 px-4 py-2 text-xs font-medium text-white hover:bg-blue-800 disabled:opacity-50"
          >
            <Upload className="w-4 h-4" />
            {submitting ? 'Executing Comparison...' : 'Run Multi-Layer Comparison'}
          </button>
        </form>

        {/* Negative & Security Test Suite */}
        <div className="rounded-lg border border-slate-200 bg-white p-6 space-y-4">
          <div className="flex items-start gap-2.5">
            <ShieldCheck className="w-5 h-5 text-slate-700 shrink-0 mt-0.5" />
            <div>
              <h2 className="text-sm font-semibold text-slate-900">
                Negative & Security Guard Tests
              </h2>
              <p className="text-xs text-slate-500 mt-1">
                Verify that malformed, compressed, or unsafe inputs are deterministically marked <strong>Blocked</strong> and never pass.
              </p>
            </div>
          </div>

          <div className="space-y-2.5">
            {[
              {
                id: 'corrupt_gzip',
                title: 'Corrupt / Truncated GZIP Stream',
                desc: 'Validates .gz CRC & truncated stream rejection.',
              },
              {
                id: 'nested_gzip',
                title: 'Unexpected Nested GZIP Archive',
                desc: 'Detects 0x1F 0x8B nested compression inside extracted payload.',
              },
              {
                id: 'path_traversal',
                title: 'Path Traversal Filename (../)',
                desc: 'Blocks directory separator injection before parsing.',
              },
              {
                id: 'unsupported_format',
                title: 'Unsupported Archive (.zip)',
                desc: 'Explicitly reports unsupported format instead of skipping.',
              },
            ].map((item) => (
              <div
                key={item.id}
                className="rounded-md border border-slate-200 p-3 flex items-center justify-between gap-3"
              >
                <div>
                  <div className="text-xs font-medium text-slate-900">{item.title}</div>
                  <div className="text-[11px] text-slate-500">{item.desc}</div>
                </div>
                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => runNegativeTest(item.id)}
                  className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0"
                >
                  <Play className="w-3 h-3" />
                  Run Test
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

import { useState } from 'react';
import { CheckCircle2, ShieldAlert } from 'lucide-react';
import type { ConfigValidationResult, InventoryConfigRule } from '../types/qe';

interface ConfigViewProps {
  configs: InventoryConfigRule[];
}

export function ConfigView({ configs }: ConfigViewProps) {
  const [selectedId, setSelectedId] = useState(configs[0]?.id || '');
  const selected = configs.find((c) => c.id === selectedId) || configs[0];

  const [draftJson, setDraftJson] = useState(() =>
    JSON.stringify(configs[0] || {}, null, 2)
  );
  const [validationResult, setValidationResult] = useState<ConfigValidationResult | null>(null);
  const [validating, setValidating] = useState(false);

  const handleSelectConfig = (cfg: InventoryConfigRule) => {
    setSelectedId(cfg.id);
    setDraftJson(JSON.stringify(cfg, null, 2));
    setValidationResult(null);
  };

  const handleValidate = async (overrideJson?: string) => {
    setValidating(true);
    try {
      const parsed = JSON.parse(overrideJson ?? draftJson);
      const res = await fetch('/api/configs/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(parsed),
      });
      const data = await res.json();
      setValidationResult(data);
    } catch (err) {
      setValidationResult({
        valid: false,
        blockerReasons: [
          err instanceof Error ? `Invalid JSON syntax: ${err.message}` : 'Invalid JSON',
        ],
        warnings: [],
      });
    } finally {
      setValidating(false);
    }
  };

  const loadInvalidTestCase = (kind: 'prod' | 'pii' | 'draft') => {
    const clone = { ...(selected || configs[0]) } as Record<string, unknown>;
    if (kind === 'prod') {
      clone.productionSubmissionAllowed = true;
    } else if (kind === 'pii') {
      clone.piiTokenizationApproved = false;
      clone.piiFields = [];
    } else if (kind === 'draft') {
      clone.approvalStatus = 'Draft';
      clone.pairingKeys = [];
    }
    const text = JSON.stringify(clone, null, 2);
    setDraftJson(text);
    handleValidate(text);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-slate-900">
          Versioned File Inventory & Governance Rules
        </h1>
        <p className="text-xs text-slate-500 mt-1 max-w-3xl">
          All application codes, sub-codes, pairing keys, PII rules, and tolerances are strictly configuration-driven. Invalid, unapproved, or production-enabled configurations are rejected before execution.
        </p>
      </div>

      {/* Inventory Table */}
      <div className="rounded-lg border border-slate-200 bg-white overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 text-slate-500 border-b border-slate-200">
              <tr>
                <th className="px-4 py-2.5 font-medium">App / Sub-Code</th>
                <th className="px-4 py-2.5 font-medium">MVP & Owners</th>
                <th className="px-4 py-2.5 font-medium">Formats</th>
                <th className="px-4 py-2.5 font-medium">Pairing Keys</th>
                <th className="px-4 py-2.5 font-medium">Env / Prod Gate</th>
                <th className="px-4 py-2.5 font-medium">Version & Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {configs.map((cfg) => (
                <tr
                  key={cfg.id}
                  onClick={() => handleSelectConfig(cfg)}
                  className={`cursor-pointer transition-colors ${
                    selectedId === cfg.id ? 'bg-blue-50/60' : 'hover:bg-slate-50'
                  }`}
                >
                  <td className="px-4 py-3 font-mono font-semibold text-slate-900">
                    {cfg.appCode} / {cfg.subCode}
                  </td>
                  <td className="px-4 py-3 text-slate-700">
                    <div className="font-medium text-slate-900">{cfg.mvp}</div>
                    <div className="text-[11px] text-slate-500">
                      {cfg.businessOwner} · {cfg.technicalOwner}
                    </div>
                  </td>
                  <td className="px-4 py-3 font-mono text-slate-800">
                    {cfg.expectedFormats.join(', ')}
                  </td>
                  <td className="px-4 py-3 font-mono text-[11px] text-slate-600">
                    {cfg.pairingKeys.join(' + ')}
                  </td>
                  <td className="px-4 py-3 text-slate-700">
                    <div>{cfg.environment}</div>
                    <div className="text-[11px] text-slate-500">Prod disabled</div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="font-mono text-slate-900">{cfg.version}</div>
                    <div className="text-[11px] text-emerald-700 font-medium">
                      {cfg.approvalStatus} ({cfg.reviewer})
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Live Configuration Schema & Policy Validator */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="rounded-lg border border-slate-200 bg-white p-5 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-slate-900">
              Configuration Schema Inspector & Validator
            </h2>
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={() => loadInvalidTestCase('prod')}
                className="rounded border border-slate-200 px-2 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-50"
              >
                Test Prod Gate Blocker
              </button>
              <button
                type="button"
                onClick={() => loadInvalidTestCase('pii')}
                className="rounded border border-slate-200 px-2 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-50"
              >
                Test Unapproved PII Blocker
              </button>
              <button
                type="button"
                onClick={() => loadInvalidTestCase('draft')}
                className="rounded border border-slate-200 px-2 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-50"
              >
                Test Draft / Missing Key
              </button>
            </div>
          </div>

          <textarea
            rows={15}
            value={draftJson}
            onChange={(e) => setDraftJson(e.target.value)}
            className="w-full rounded-md border border-slate-300 bg-slate-50 p-3 font-mono text-xs text-slate-900"
          />

          <button
            type="button"
            disabled={validating}
            onClick={() => handleValidate()}
            className="rounded-md bg-blue-700 px-4 py-2 text-xs font-medium text-white hover:bg-blue-800 disabled:opacity-50"
          >
            {validating ? 'Validating...' : 'Validate Configuration Rules'}
          </button>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-5 space-y-4">
          <h2 className="text-sm font-semibold text-slate-900">Validation & Blocker Report</h2>
          {!validationResult ? (
            <div className="rounded-md border border-dashed border-slate-200 p-6 text-center text-xs text-slate-500">
              Click "Validate Configuration Rules" or run one of the negative policy checks to inspect configuration enforcement.
            </div>
          ) : validationResult.valid ? (
            <div className="rounded-md border border-emerald-200 bg-emerald-50 p-4 space-y-2">
              <div className="flex items-center gap-2 text-sm font-semibold text-emerald-800">
                <CheckCircle2 className="w-4 h-4" />
                Configuration Approved & Safe for Execution
              </div>
              <p className="text-xs text-emerald-700">
                All required metadata, PII tokenization flags, pairing keys, tolerances, and non-production gates passed validation.
              </p>
            </div>
          ) : (
            <div className="rounded-md border border-red-200 bg-red-50 p-4 space-y-2">
              <div className="flex items-center gap-2 text-sm font-semibold text-red-800">
                <ShieldAlert className="w-4 h-4" />
                Configuration Blocker — Execution Halted
              </div>
              <ul className="space-y-1 text-xs text-red-800 list-disc pl-4">
                {validationResult.blockerReasons.map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
            </div>
          )}

          {validationResult && validationResult.warnings.length > 0 && (
            <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900 space-y-1">
              <div className="font-semibold">Warnings</div>
              {validationResult.warnings.map((w, i) => (
                <div key={i}>• {w}</div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

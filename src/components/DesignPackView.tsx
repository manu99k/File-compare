import type { DesignPackData } from '../types/qe';

interface DesignPackViewProps {
  pack: DesignPackData | null;
}

export function DesignPackView({ pack }: DesignPackViewProps) {
  if (!pack) {
    return (
      <div className="rounded-lg border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
        Loading Discovery & Design deliverables...
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-lg font-semibold text-slate-900">
          Discovery & Architecture Design Pack
        </h1>
        <p className="text-xs text-slate-500 mt-1 max-w-3xl">
          Governance artifacts separating this safe local prototype from approved non-production environment integrations: requirements traceability, threat model, unresolved owner questions, and phased rollout.
        </p>
      </div>

      {/* 1. Architecture & Data Flow Overview */}
      <div className="rounded-lg border border-slate-200 bg-white p-5 space-y-3">
        <h2 className="text-sm font-semibold text-slate-900">
          Modular Architecture & Privacy-Safe Data Flow
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-5 gap-3 text-xs">
          {[
            {
              step: '01. Config & Policy Gate',
              desc: 'Validates versioned inventory, approved PII list, pairing keys, and blocks production.',
            },
            {
              step: '02. Secure Ingestion',
              desc: 'In-memory processing, path traversal guard, SHA-256 hashing, bounded GZIP checks.',
            },
            {
              step: '03. Pluggable Adapters',
              desc: 'Routes to AFP (MO:DCA + Papyrus), PDF (pdf-lib/pdfjs), PCL (ESC parser), or RT/RPT.',
            },
            {
              step: '04. Multi-Layer Engine',
              desc: 'Executes Structural, Redacted Text, Visual Pixel/ESC, and Control Total checks.',
            },
            {
              step: '05. Human Sign-Off',
              desc: 'Surfaces Potential Variances & Papyrus checks for mandatory QE/Business approval.',
            },
          ].map((node) => (
            <div key={node.step} className="rounded-md border border-slate-200 bg-slate-50 p-3 space-y-1">
              <div className="font-semibold text-slate-900">{node.step}</div>
              <p className="text-slate-600 leading-relaxed">{node.desc}</p>
            </div>
          ))}
        </div>
      </div>

      {/* 2. Requirements & Traceability Matrix */}
      <div className="rounded-lg border border-slate-200 bg-white overflow-hidden">
        <div className="border-b border-slate-200 px-5 py-3">
          <h2 className="text-sm font-semibold text-slate-900">
            Requirements, Assumptions & Test Traceability Matrix
          </h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 text-slate-500 border-b border-slate-200">
              <tr>
                <th className="px-4 py-2.5 font-medium">ID</th>
                <th className="px-4 py-2.5 font-medium">Category</th>
                <th className="px-4 py-2.5 font-medium">Requirement & Assumption</th>
                <th className="px-4 py-2.5 font-medium">Verification Method</th>
                <th className="px-4 py-2.5 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {pack.requirementsRegister.map((r) => (
                <tr key={r.id}>
                  <td className="px-4 py-2.5 font-mono font-semibold text-slate-900 whitespace-nowrap">
                    {r.id}
                  </td>
                  <td className="px-4 py-2.5 font-medium text-slate-700 whitespace-nowrap">
                    {r.category}
                  </td>
                  <td className="px-4 py-2.5 text-slate-800 space-y-1">
                    <div>{r.requirement}</div>
                    <div className="text-[11px] text-slate-500">Assumption: {r.assumption}</div>
                  </td>
                  <td className="px-4 py-2.5 text-slate-600">{r.verificationMethod}</td>
                  <td className="px-4 py-2.5 font-medium text-emerald-700 whitespace-nowrap">
                    {r.status}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* 3. Security & Privacy Threat Assessment */}
      <div className="rounded-lg border border-slate-200 bg-white overflow-hidden">
        <div className="border-b border-slate-200 px-5 py-3">
          <h2 className="text-sm font-semibold text-slate-900">
            Security & Privacy Threat Assessment
          </h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 text-slate-500 border-b border-slate-200">
              <tr>
                <th className="px-4 py-2.5 font-medium">ID</th>
                <th className="px-4 py-2.5 font-medium">Threat & Vector</th>
                <th className="px-4 py-2.5 font-medium">Severity</th>
                <th className="px-4 py-2.5 font-medium">Implemented Control</th>
                <th className="px-4 py-2.5 font-medium">Residual Risk</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {pack.threatAssessment.map((t) => (
                <tr key={t.id}>
                  <td className="px-4 py-2.5 font-mono font-semibold text-slate-900">{t.id}</td>
                  <td className="px-4 py-2.5 text-slate-800">
                    <div className="font-medium text-slate-900">{t.threat}</div>
                    <div className="text-[11px] text-slate-500">{t.vector}</div>
                  </td>
                  <td className="px-4 py-2.5 font-medium text-red-700">{t.severity}</td>
                  <td className="px-4 py-2.5 text-slate-700">{t.mitigationControl}</td>
                  <td className="px-4 py-2.5 text-slate-600">{t.residualRisk}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* 4. Unresolved Decisions & Phased Implementation Plan */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="rounded-lg border border-slate-200 bg-white p-5 space-y-3">
          <h2 className="text-sm font-semibold text-slate-900">
            Unresolved Decisions & Questions for Owners
          </h2>
          <div className="space-y-3">
            {pack.unresolvedQuestions.map((q) => (
              <div key={q.id} className="rounded-md border border-slate-200 bg-slate-50 p-3 text-xs space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono font-semibold text-slate-900">{q.id} · {q.topic}</span>
                  <span className="text-slate-500">{q.owner}</span>
                </div>
                <p className="text-slate-800">{q.question}</p>
                <div className="text-[11px] text-amber-800">Impact: {q.blockingImpact}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-5 space-y-3">
          <h2 className="text-sm font-semibold text-slate-900">Phased Implementation Roadmap</h2>
          <div className="space-y-3">
            {pack.phasedPlan.map((p) => (
              <div key={p.phase} className="rounded-md border border-slate-200 bg-slate-50 p-3 text-xs space-y-1.5">
                <div className="font-semibold text-slate-900">{p.phase}</div>
                <div className="text-[11px] text-slate-500">Environment: {p.environment}</div>
                <p className="text-slate-700">{p.scope}</p>
                <ul className="list-disc pl-4 text-slate-600 space-y-0.5">
                  {p.exitCriteria.map((ec, i) => (
                    <li key={i}>{ec}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

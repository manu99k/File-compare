import type { AdapterCapability } from '../types/qe';

interface AdaptersViewProps {
  adapters: AdapterCapability[];
}

export function AdaptersView({ adapters }: AdaptersViewProps) {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-slate-900">
          Pluggable Format Adapters & Verification Boundaries
        </h1>
        <p className="text-xs text-slate-500 mt-1 max-w-3xl">
          Each adapter declares what it can parse, which multi-layer checks it performs, what it cannot verify automatically, and when human review (such as ISIS Papyrus for AFP) is mandatory.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {adapters.map((a) => (
          <div key={a.format} className="rounded-lg border border-slate-200 bg-white p-5 space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2 text-xs text-slate-500">
                  <span className="font-mono font-semibold text-slate-800">{a.format}</span>
                  <span aria-hidden="true">·</span>
                  <span>{a.supportStatus}</span>
                </div>
                <h2 className="text-base font-semibold text-slate-900 mt-1">{a.displayName}</h2>
              </div>
              <span
                className={`rounded border px-2 py-0.5 text-xs font-medium whitespace-nowrap shrink-0 ${
                  a.humanReviewRequired
                    ? 'border-amber-200 bg-amber-50 text-amber-800'
                    : 'border-emerald-200 bg-emerald-50 text-emerald-800'
                }`}
              >
                {a.humanReviewRequired ? 'Human Review Mandatory' : 'Automated Primary'}
              </span>
            </div>

            <div className="text-xs text-slate-600">
              <span className="font-medium text-slate-800">Parser Engine: </span>
              <span className="font-mono">{a.parserEngine}</span>
            </div>

            {a.approvedExternalTool && (
              <div className="text-xs text-amber-900 bg-amber-50 border border-amber-200 rounded px-3 py-2">
                <span className="font-semibold">Approved Companion Tool: </span>
                {a.approvedExternalTool}
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t border-slate-100 text-xs">
              <div>
                <div className="font-semibold text-slate-800 mb-1.5">Checks Performed</div>
                <ul className="space-y-1 text-slate-600 list-disc pl-4">
                  {a.checksPerformed.map((item, i) => (
                    <li key={i}>{item}</li>
                  ))}
                </ul>
              </div>
              <div>
                <div className="font-semibold text-red-800 mb-1.5">Cannot Verify Automatically</div>
                <ul className="space-y-1 text-slate-600 list-disc pl-4">
                  {a.cannotVerify.map((item, i) => (
                    <li key={i}>{item}</li>
                  ))}
                </ul>
              </div>
            </div>

            <div className="pt-2 border-t border-slate-100 text-xs text-slate-600">
              <span className="font-medium text-slate-800">Human Review Trigger: </span>
              {a.humanReviewTrigger}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

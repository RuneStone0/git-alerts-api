import React from 'react';
import { useQuery } from '@tanstack/react-query';

/**
 * The scan queue lives in the scan factory, not in this API. The factory publishes a JSON
 * snapshot next to the UI's static files, so this page reads that file directly and never
 * mutates anything. If the snapshot is missing or old, say so plainly.
 */
interface QueueSnapshot {
  generated_at: string;
  campaign: {
    name: string;
    state: string;
    targets_total: number;
    repos_total: number;
    repos_done: number;
    repos_pending: number;
    eta_days: number;
    repos_per_minute: number;
    by_state: Record<string, number>;
  } | null;
  pending: Array<{
    org: string;
    domain: string;
    repo_count: number;
    state: string;
    attempts: number;
    claimed_at: string | null;
    last_error: string | null;
  }>;
  pending_truncated: number;
  recent: Array<{
    org: string;
    domain: string;
    state: string;
    repo_count: number;
    findings_new: number;
    updated_at: string;
    last_error: string | null;
    repos_scanned: number | null;
    repos_total: number | null;
    findings: number | null;
    finished_at: string | null;
  }>;
  findings: { total: number; reportable: number; by_state: Record<string, number> };
  skips: Record<string, number>;
}

const fetchQueue = async (): Promise<QueueSnapshot | null> => {
  const res = await fetch('/factory/queue.json', { cache: 'no-store' });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`queue snapshot: HTTP ${res.status}`);
  // nginx answers a missing file under /factory with index.html and a 200, so an unguarded
  // res.json() reports a syntax error about '<' instead of the real fault: the mount is gone.
  const type = res.headers.get('content-type') ?? '';
  if (!type.includes('json')) {
    throw new Error('queue snapshot unreadable: served as HTML, so the /factory mount is missing or empty');
  }
  return res.json();
};

const minutesOld = (iso: string): number =>
  Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));

const fmt = (n: number | null | undefined): string =>
  n === null || n === undefined ? '—' : n.toLocaleString();

const Stat: React.FC<{ label: string; value: string; hint?: string }> = ({ label, value, hint }) => (
  <div className="rounded-lg border border-border bg-card p-4">
    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
    <p className="mt-1 text-2xl font-semibold text-foreground">{value}</p>
    {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
  </div>
);

export const Queue: React.FC = () => {
  const { data, isLoading, error } = useQuery({
    queryKey: ['factory-queue'],
    queryFn: fetchQueue,
    refetchInterval: 60_000,
  });

  if (isLoading) {
    return <p className="text-muted-foreground">Loading queue...</p>;
  }

  if (error) {
    return (
      <div className="rounded-lg border border-border bg-card p-6">
        <h2 className="text-lg font-semibold text-foreground">Queue snapshot unreadable</h2>
        <p className="mt-2 text-sm text-muted-foreground">{String((error as Error).message)}</p>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold text-foreground">Scan queue</h1>
        <div className="rounded-lg border border-border bg-card p-6">
          <p className="text-sm text-foreground">No queue snapshot has been published yet.</p>
          <p className="mt-2 text-sm text-muted-foreground">
            The scan factory owns the queue. Publish it on the host with
            <code className="mx-1 rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
              python3 scripts/scan_factory/factory.py queue
            </code>
            and this page will show the pending targets. Every factory tick republishes it.
          </p>
        </div>
      </div>
    );
  }

  const camp = data.campaign;
  const age = minutesOld(data.generated_at);
  const stale = age > 45;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Scan queue</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Owned by the scan factory, which is outside this app. This page is read-only.
          </p>
        </div>
        <p className={`text-sm ${stale ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground'}`}>
          snapshot {age <= 1 ? 'just now' : `${age} min old`}
          {stale && ' — the factory tick may have stopped'}
        </p>
      </div>

      {!camp ? (
        <p className="text-sm text-muted-foreground">The snapshot carries no campaign.</p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
            <Stat label="State" value={camp.state} hint={camp.name} />
            <Stat
              label="Pending targets"
              value={fmt(camp.by_state.queued ?? 0)}
              hint={`${fmt(camp.by_state.claimed ?? 0)} claimed now`}
            />
            <Stat label="Done" value={fmt(camp.by_state.scanned ?? 0)} hint={`of ${fmt(camp.targets_total)} targets`} />
            <Stat
              label="Repos left"
              value={fmt(camp.repos_pending)}
              hint={`${fmt(camp.repos_done)} of ${fmt(camp.repos_total)} scanned`}
            />
            <Stat
              label="ETA"
              value={camp.eta_days ? `${camp.eta_days.toFixed(1)} d` : '—'}
              hint={`at ${camp.repos_per_minute} repos/min`}
            />
          </div>

          <section className="rounded-lg border border-border bg-card">
            <header className="border-b border-border px-4 py-3">
              <h2 className="text-sm font-semibold text-foreground">Gate outcomes so far</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                {fmt(data.findings.total)} findings kept, {fmt(data.findings.reportable)} reportable
              </p>
            </header>
            <div className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-3 lg:grid-cols-6">
              {Object.entries(data.skips).map(([k, v]) => (
                <div key={k}>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">{k.replace(/_/g, ' ')}</p>
                  <p className="text-lg font-semibold text-foreground">{fmt(v)}</p>
                </div>
              ))}
            </div>
          </section>

          <section className="overflow-hidden rounded-lg border border-border bg-card">
            <header className="border-b border-border px-4 py-3">
              <h2 className="text-sm font-semibold text-foreground">Pending, next first</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                Smallest orgs go first so a pass keeps producing results early.
                {data.pending_truncated > 0 && ` ${fmt(data.pending_truncated)} more not shown.`}
              </p>
            </header>
            <div className="max-h-[28rem] overflow-y-auto">
              <table className="min-w-full">
                <thead className="sticky top-0 bg-card">
                  <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="px-4 py-2 font-medium">Org</th>
                    <th className="px-4 py-2 font-medium">Domain</th>
                    <th className="px-4 py-2 text-right font-medium">Repos</th>
                    <th className="px-4 py-2 font-medium">State</th>
                  </tr>
                </thead>
                <tbody>
                  {data.pending.map((t) => (
                    <tr key={`${t.org}:${t.domain}`} className="border-t border-border">
                      <td className="px-4 py-2 text-sm text-foreground">{t.org}</td>
                      <td className="px-4 py-2 text-sm text-muted-foreground">{t.domain}</td>
                      <td className="px-4 py-2 text-right text-sm text-foreground">{fmt(t.repo_count)}</td>
                      <td className="px-4 py-2 text-sm text-muted-foreground">
                        {t.state}
                        {t.state === 'claimed' && t.claimed_at && ` since ${new Date(t.claimed_at).toLocaleTimeString()}`}
                      </td>
                    </tr>
                  ))}
                  {data.pending.length === 0 && (
                    <tr>
                      <td colSpan={4} className="px-4 py-6 text-center text-sm text-muted-foreground">
                        Nothing pending. The pass is drained.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <section className="overflow-hidden rounded-lg border border-border bg-card">
            <header className="border-b border-border px-4 py-3">
              <h2 className="text-sm font-semibold text-foreground">Recently finished</h2>
            </header>
            <table className="min-w-full">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-4 py-2 font-medium">Org</th>
                  <th className="px-4 py-2 text-right font-medium">Repos scanned</th>
                  <th className="px-4 py-2 text-right font-medium">New findings</th>
                  <th className="px-4 py-2 font-medium">Finished</th>
                </tr>
              </thead>
              <tbody>
                {data.recent.map((r) => (
                  <tr key={`${r.org}:${r.updated_at}`} className="border-t border-border">
                    <td className="px-4 py-2 text-sm text-foreground">{r.org}</td>
                    <td className="px-4 py-2 text-right text-sm text-muted-foreground">
                      {fmt(r.repos_scanned ?? r.repo_count)}
                      {r.repos_total ? ` / ${fmt(r.repos_total)}` : ''}
                    </td>
                    <td className="px-4 py-2 text-right text-sm text-foreground">{fmt(r.findings_new)}</td>
                    <td className="px-4 py-2 text-sm text-muted-foreground">
                      {r.finished_at ? new Date(r.finished_at).toLocaleString() : new Date(r.updated_at).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </>
      )}
    </div>
  );
};

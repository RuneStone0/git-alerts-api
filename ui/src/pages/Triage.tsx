import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { nextSort, sortRows, type SortState } from '@/lib/table-sort';
import { SortHeader } from '@/components/SortHeader';

/**
 * Triage queue: findings that still need a verdict, ordered by how close they are to a
 * submission. Authored by the scan factory, published as JSON, read-only here.
 */
interface Check {
  ok: boolean;
  note: string;
}

interface TriageItem {
  ref: string;
  fingerprint: string;
  org: string | null;
  domain: string | null;
  type: string | null;
  repository: string;
  file: string;
  line: number | null;
  commit_url: string | null;
  state: string;
  triage_state: string;
  checks: Record<'ownership' | 'scope' | 'capability' | 'impact' | 'channel', Check>;
  score: number;
  outcome: string;
  command: string;
  path_class?: string;
  path_rank?: number;
}

interface TriageSnapshot {
  generated_at: string;
  open: number;
  ready_to_draft: number;
  by_score: Record<string, number>;
  items: TriageItem[];
  courtesy_orgs?: number;
  courtesy_findings?: number;
  courtesy?: Array<{
    org: string | null; domain: string | null; count: number; live?: number; types: string[]; refs: string[];
    repositories: string[]; policy?: string | null; securitytxt?: string | null;
    email?: string | null; discarded_emails?: string[]; has_channel: boolean;
  }>;
  recent_closed: Array<{
    ref: string; org: string | null; type: string | null; state: string;
    method: string | null; impact: string | null; updated_at: string | null;
  }>;
}

const fetchTriage = async (): Promise<TriageSnapshot | null> => {
  const res = await fetch('/factory/triage.json', { cache: 'no-store' });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`triage snapshot: HTTP ${res.status}`);
  const type = res.headers.get('content-type') ?? '';
  if (!type.includes('json')) {
    throw new Error('triage snapshot unreadable: served as HTML, so the /factory mount is missing or empty');
  }
  return res.json();
};

const CHECK_ORDER = ['ownership', 'scope', 'capability', 'impact', 'channel'] as const;

const Dot: React.FC<{ name: string; check: Check }> = ({ name, check }) => (
  <span className="inline-flex items-center gap-1" title={`${name}: ${check.note}`}>
    <span
      aria-hidden="true"
      className={`h-2 w-2 rounded-full ${check.ok ? 'bg-green-500' : 'bg-muted-foreground/40'}`}
    />
    <span className={`text-[10px] uppercase tracking-wide ${check.ok ? 'text-foreground' : 'text-muted-foreground'}`}>
      {name.slice(0, 4)}
    </span>
  </span>
);

export const Triage: React.FC = () => {
  const [copied, setCopied] = useState<string | null>(null);
  const [hideZero, setHideZero] = useState(false);
  // Both lists arrive complete in one snapshot, so ordering them here is the whole list.
  const [queueSort, setQueueSort] = useState<SortState | null>(null);
  const [courtesySort, setCourtesySort] = useState<SortState | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ['factory-triage'],
    queryFn: fetchTriage,
    refetchInterval: 60_000,
  });

  if (isLoading) return <p className="text-muted-foreground">Loading triage queue...</p>;
  if (error) {
    return (
      <div className="rounded-lg border border-border bg-card p-6">
        <h2 className="text-lg font-semibold text-foreground">Triage snapshot unreadable</h2>
        <p className="mt-2 text-sm text-muted-foreground">{String((error as Error).message)}</p>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold text-foreground">Triage queue</h1>
        <div className="rounded-lg border border-border bg-card p-6">
          <p className="text-sm text-foreground">No triage snapshot published yet.</p>
          <p className="mt-2 text-sm text-muted-foreground">
            Publish it on the host with
            <code className="mx-1 rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
              python3 scripts/scan_factory/factory.py triage-queue
            </code>
            and this page will list what needs a verdict.
          </p>
        </div>
      </div>
    );
  }

  const items = hideZero ? data.items.filter((i) => i.score > 0) : data.items;

  const sortedItems = sortRows(items, queueSort, (item, key) => {
    switch (key) {
      case 'ref':
        return item.ref;
      case 'org':
        return item.org ?? '';
      case 'score':
        return item.score;
      case 'outcome':
        return item.outcome;
      default:
        return null;
    }
  });

  const courtesyRows = sortRows(data.courtesy ?? [], courtesySort, (row, key) => {
    switch (key) {
      case 'org':
        return row.org ?? '';
      case 'findings':
        return row.count;
      case 'live':
        return row.live ?? 0;
      case 'contact':
        return row.email ?? '';
      default:
        return null;
    }
  });

  const copy = async (command: string) => {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(command);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      setCopied(null);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Triage queue</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {data.open} awaiting a verdict, {data.ready_to_draft} ready to draft. A finding needs all
            five checks before it can be reported.
          </p>
        </div>
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <input
            type="checkbox"
            checked={hideZero}
            onChange={(e) => setHideZero(e.target.checked)}
            className="h-4 w-4 rounded border-input"
          />
          hide 0/5
        </label>
      </div>

      <div className="overflow-hidden rounded-lg border border-border bg-card">
        <table className="min-w-full">
          <thead className="bg-muted">
            <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
              <SortHeader label="Ref" sortKey="ref" sort={queueSort} onSort={(key) => setQueueSort((current) => nextSort(current, key))} className="px-3 py-2 font-medium" />
              <SortHeader label="Org / type" sortKey="org" sort={queueSort} onSort={(key) => setQueueSort((current) => nextSort(current, key))} className="px-3 py-2 font-medium" title="Sort by org" />
              <SortHeader label="Checks" sortKey="score" sort={queueSort} onSort={(key) => setQueueSort((current) => nextSort(current, key))} className="px-3 py-2 font-medium" title="Sort by how many of the five checks pass, 5 of 5 first on a second click" />
              <SortHeader label="Next step" sortKey="outcome" sort={queueSort} onSort={(key) => setQueueSort((current) => nextSort(current, key))} className="px-3 py-2 font-medium" />
              <th className="px-3 py-2 font-medium">Record the verdict</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {sortedItems.map((item) => (
              <tr key={item.ref} className="align-top hover:bg-muted/40">
                <td className="px-3 py-3 whitespace-nowrap font-mono text-xs text-foreground">{item.ref}</td>
                <td className="px-3 py-3">
                  <p className="text-sm text-foreground">{item.org || '?'}</p>
                  <p className="text-xs text-muted-foreground">
                    {item.type}
                    {item.path_class ? ` · ${item.path_class}` : ''}
                    {item.line ? ` · line ${item.line}` : ''}
                  </p>
                  <a
                    href={`/findings?repository=${encodeURIComponent(item.repository)}`}
                    className="text-xs text-primary hover:underline"
                  >
                    open finding
                  </a>
                </td>
                <td className="px-3 py-3">
                  <div className="flex flex-wrap gap-x-3 gap-y-1">
                    {CHECK_ORDER.map((name) => (
                      <Dot key={name} name={name} check={item.checks[name]} />
                    ))}
                  </div>
                  <p className="mt-1 max-w-xs text-xs text-muted-foreground">{item.score}/5</p>
                </td>
                <td className="px-3 py-3 text-sm text-foreground">{item.outcome}</td>
                <td className="px-3 py-3">
                  <div className="flex items-start gap-2">
                    <code className="max-w-md break-all rounded bg-muted px-2 py-1 font-mono text-[11px] text-muted-foreground">
                      {item.command}
                    </code>
                    <button
                      onClick={() => copy(item.command)}
                      className="shrink-0 rounded border border-border px-2 py-1 text-xs text-foreground hover:bg-muted"
                    >
                      {copied === item.command ? 'copied' : 'copy'}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {sortedItems.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-sm text-muted-foreground">
                  Nothing awaiting a verdict.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <section className="overflow-hidden rounded-lg border border-border bg-card">
        <header className="border-b border-border px-3 py-2">
          <h2 className="text-sm font-semibold text-foreground">Courtesy lane</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {data.courtesy_findings || 0} findings across {data.courtesy_orgs || 0} orgs that are real
            but outside the program&apos;s scope, so no bounty lane. Grouped per org: one report, not
            one per finding.
          </p>
        </header>
        <table className="min-w-full">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
              <SortHeader label="Org" sortKey="org" sort={courtesySort} onSort={(key) => setCourtesySort((current) => nextSort(current, key))} className="px-3 py-2 font-medium" />
              <SortHeader label="Findings" sortKey="findings" sort={courtesySort} onSort={(key) => setCourtesySort((current) => nextSort(current, key))} className="px-3 py-2 font-medium" title="Sort by how many findings this org has, most first on a second click" />
              <SortHeader label="Live" sortKey="live" sort={courtesySort} onSort={(key) => setCourtesySort((current) => nextSort(current, key))} className="px-3 py-2 font-medium" title="Sort by how many of those findings still authenticate" />
              <th className="px-3 py-2 font-medium">Channel</th>
              <SortHeader label="Contact" sortKey="contact" sort={courtesySort} onSort={(key) => setCourtesySort((current) => nextSort(current, key))} className="px-3 py-2 font-medium" title="Sort by contact address" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {courtesyRows.map((c) => (
              <tr key={`${c.org}:${c.domain}`} className="align-top">
                <td className="px-3 py-2 text-sm text-foreground">
                  {c.org || '?'}
                  <span className="ml-2 text-xs text-muted-foreground">{c.domain}</span>
                </td>
                <td className="px-3 py-2 text-sm text-foreground">
                  {c.count}
                  <span className="ml-2 text-xs text-muted-foreground">{c.types.slice(0, 3).join(', ')}</span>
                </td>
                <td className="px-3 py-2 text-sm">
                  <span className={(c.live || 0) > 0 ? 'text-green-600' : 'text-muted-foreground'}>
                    {c.live || 0}/{c.count}
                  </span>
                </td>
                <td className="px-3 py-2 text-xs">
                  {c.has_channel ? (
                    <span className="text-foreground">
                      {c.policy ? (
                        <a href={c.policy} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                          policy
                        </a>
                      ) : (
                        <span className="text-muted-foreground">security.txt</span>
                      )}
                    </span>
                  ) : (
                    <span className="text-yellow-600">none found</span>
                  )}
                </td>
                <td className="px-3 py-2 text-xs text-muted-foreground">
                  {c.email || 'no usable address'}
                  {(c.discarded_emails || []).length > 0 && (
                    <span className="ml-1">
                      ({c.discarded_emails!.length} discarded as not matching the domain)
                    </span>
                  )}
                </td>
              </tr>
            ))}
            {(data.courtesy || []).length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-sm text-muted-foreground">
                  Nothing parked in the courtesy lane.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      <section className="overflow-hidden rounded-lg border border-border bg-card">
        <header className="border-b border-border px-3 py-2">
          <h2 className="text-sm font-semibold text-foreground">Recently closed</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Rejected or duplicate, with the gate that disqualified them. Reversible:
            {' '}factory.py validate --ref F-0001 --state candidate
          </p>
        </header>
        <table className="min-w-full">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
              <th className="px-3 py-2 font-medium">Ref</th>
              <th className="px-3 py-2 font-medium">Org / type</th>
              <th className="px-3 py-2 font-medium">By</th>
              <th className="px-3 py-2 font-medium">Reason</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {(data.recent_closed || []).map((r) => (
              <tr key={`${r.ref}:${r.updated_at}`} className="align-top">
                <td className="px-3 py-2 whitespace-nowrap font-mono text-xs text-foreground">{r.ref}</td>
                <td className="px-3 py-2 text-sm text-foreground">
                  {r.org || '?'}
                  <span className="ml-2 text-xs text-muted-foreground">{r.type}</span>
                </td>
                <td className="px-3 py-2 text-xs text-muted-foreground">{r.method || r.state}</td>
                <td className="px-3 py-2 max-w-lg text-xs text-muted-foreground">{r.impact || ''}</td>
              </tr>
            ))}
            {(data.recent_closed || []).length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-sm text-muted-foreground">
                  Nothing closed yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      <p className="text-xs text-muted-foreground">
        ownership: the commit is the org&apos;s. scope: repo and path are in the program&apos;s own scope.
        capability: the credential answered a read-only identity call. impact: a demonstrated impact
        category. channel: a program and a place to submit. Snapshot {data.generated_at}.
      </p>
    </div>
  );
};

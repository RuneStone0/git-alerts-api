import React from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, ExternalLink, Mail } from 'lucide-react';
import { programsApi, scansApi, findingsApi } from '@/services/api';

// One initiative, in full: the scope record the work was authorised against, then everything
// produced under it. The staleness note matters more than it looks: scope text goes off in weeks,
// so a program whose scope was read more than 30 days ago is flagged rather than trusted.

const DAY_MS = 24 * 60 * 60 * 1000;

const daysSince = (iso: string): number => {
  const then = new Date(`${iso}T00:00:00Z`).getTime();
  if (Number.isNaN(then)) return Number.NaN;
  return Math.floor((Date.now() - then) / DAY_MS);
};

const Card: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div className="rounded-lg border border-border bg-card p-4">
    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
    <div className="mt-1 break-words text-sm text-foreground">{children}</div>
  </div>
);

const statusClasses = (status: string): string => {
  if (status === 'completed') return 'text-green-500';
  if (status === 'failed') return 'text-red-500';
  if (status === 'in_progress') return 'text-amber-500';
  return 'text-muted-foreground';
};

export const ProgramDetail: React.FC = () => {
  const { slug = '' } = useParams<{ slug: string }>();

  const programQuery = useQuery({
    queryKey: ['program', slug],
    queryFn: () => programsApi.get(slug),
    enabled: Boolean(slug),
    retry: false,
  });

  const scansQuery = useQuery({
    queryKey: ['program-scans', slug],
    queryFn: () => scansApi.list({ program: slug, page_size: 100 }),
    enabled: Boolean(slug),
  });

  const findingsQuery = useQuery({
    queryKey: ['program-findings', slug],
    queryFn: () => findingsApi.list({ program: slug, page_size: 10 }),
    enabled: Boolean(slug),
  });

  if (programQuery.isLoading) {
    return (
      <div className="rounded-lg border border-border bg-card p-8 text-center">
        <p className="text-muted-foreground">Loading...</p>
      </div>
    );
  }

  if (programQuery.error || !programQuery.data) {
    return (
      <div className="space-y-4">
        <Link to="/programs" className="inline-flex items-center gap-2 text-sm text-primary hover:underline">
          <ArrowLeft className="h-4 w-4" /> Programs
        </Link>
        <div className="rounded-lg border border-border bg-card p-8 text-center">
          <p className="text-red-500">No program named “{slug}”.</p>
        </div>
      </div>
    );
  }

  const program = programQuery.data;
  const scans = scansQuery.data?.results ?? [];
  const scanCount = scansQuery.data?.count ?? scans.length;
  const findings = findingsQuery.data?.results ?? [];
  const findingCount = findingsQuery.data?.count ?? findings.length;
  const age = program.scope_read_on ? daysSince(program.scope_read_on) : Number.NaN;
  const stale = Number.isFinite(age) && age > 30;

  return (
    <div className="space-y-6">
      <div>
        <Link to="/programs" className="inline-flex items-center gap-2 text-sm text-primary hover:underline">
          <ArrowLeft className="h-4 w-4" /> Programs
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold text-foreground">{program.name}</h1>
          <span
            className={
              program.source === 'manual'
                ? 'rounded-full border border-primary/40 bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary'
                : 'rounded-full border border-border bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground'
            }
          >
            {program.source}
          </span>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          {program.slug}
          {program.domain ? ` · ${program.domain}` : ''}
        </p>
      </div>

      {stale && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-4">
          <p className="text-sm font-medium text-amber-600 dark:text-amber-400">
            Scope read {age} days ago. Anything older than 30 days is stale: re-read the policy
            before planning work against it.
          </p>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Card label="Domain">{program.domain || '—'}</Card>
        <Card label="Scope read on">
          {program.scope_read_on ?? '—'}
          {Number.isFinite(age) ? ` (${age}d)` : ''}
        </Card>
        <Card label="Payout">{program.payout_note || '—'}</Card>
        <Card label="Policy">
          {program.policy_url ? (
            <a
              href={program.policy_url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-primary hover:underline"
            >
              {program.policy_url}
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          ) : (
            '—'
          )}
        </Card>
        <Card label="Channel">
          {program.channel_contact ? (
            <a href={`mailto:${program.channel_contact}`} className="inline-flex items-center gap-1 text-primary hover:underline">
              <Mail className="h-3.5 w-3.5" />
              {program.channel_contact}
            </a>
          ) : program.channel_url ? (
            <a href={program.channel_url} target="_blank" rel="noreferrer" className="text-primary hover:underline">
              {program.channel_url}
            </a>
          ) : (
            '—'
          )}
        </Card>
        <Card label="Scans / findings">
          <span className="tabular-nums">{scanCount}</span> scans,{' '}
          <span className="tabular-nums">{findingCount}</span> findings
        </Card>
      </div>

      {program.scope_note && (
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Scope note</p>
          <p className="mt-2 whitespace-pre-wrap text-sm text-foreground">{program.scope_note}</p>
        </div>
      )}

      <div className="space-y-3">
        <h2 className="text-lg font-semibold text-foreground">Scans</h2>
        {scansQuery.isLoading ? (
          <div className="rounded-lg border border-border bg-card p-6 text-center">
            <p className="text-muted-foreground">Loading...</p>
          </div>
        ) : scans.length === 0 ? (
          <div className="rounded-lg border border-border bg-card p-6 text-center">
            <p className="text-muted-foreground">No scans attributed to this program yet.</p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-lg border border-border bg-card">
            <div className="divide-y divide-border">
              {scans.map((scan) => (
                <Link
                  key={scan.id}
                  to={`/scans/${scan.id}`}
                  className="block p-4 transition-colors hover:bg-muted/50"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-foreground">{scan.value}</p>
                      <p className={`text-xs ${statusClasses(scan.status)}`}>{scan.status}</p>
                    </div>
                    <p className="text-xs tabular-nums text-muted-foreground">
                      {scan.total_findings} findings · {scan.scanned_repositories} repos
                    </p>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="space-y-3">
        <h2 className="text-lg font-semibold text-foreground">Findings</h2>
        {findingsQuery.isLoading ? (
          <div className="rounded-lg border border-border bg-card p-6 text-center">
            <p className="text-muted-foreground">Loading...</p>
          </div>
        ) : findings.length === 0 ? (
          <div className="rounded-lg border border-border bg-card p-6 text-center">
            <p className="text-muted-foreground">No findings attributed to this program yet.</p>
            <p className="mt-2 text-sm text-muted-foreground">
              Findings attach when their scan is attributed, so run or attribute a scan first.
            </p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-lg border border-border bg-card">
            <div className="divide-y divide-border">
              {findings.map((finding) => (
                <div key={finding.id} className="p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="truncate text-sm font-medium text-foreground">{finding.type}</p>
                    <p className="text-xs tabular-nums text-muted-foreground">
                      {finding.value_length ?? 0} chars
                    </p>
                  </div>
                  <p className="mt-1 truncate text-xs text-muted-foreground">
                    {finding.repository}
                    {finding.file ? ` · ${finding.file}` : ''}
                  </p>
                </div>
              ))}
            </div>
            {findingCount > findings.length && (
              <Link
                to="/findings"
                className="block border-t border-border p-3 text-center text-sm text-primary hover:underline"
              >
                View all {findingCount} findings
              </Link>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

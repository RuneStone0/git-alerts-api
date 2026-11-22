import React from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { scansApi, findingsApi } from '@/services/api';
import {
  StatusIndicator,
  scanStatusLabel,
  scanStatusTone,
  validatedLabel,
  validatedTone,
} from '@/components/StatusIndicator';

export const Dashboard: React.FC = () => {
  const { data: scansPage, isLoading: scansLoading } = useQuery({
    queryKey: ['scans', { recent: true }],
    queryFn: () => scansApi.list({ page: 1, page_size: 5 }),
  });

  const { data: findingsPage, isLoading: findingsLoading } = useQuery({
    queryKey: ['findings', { recent: true }],
    queryFn: () => findingsApi.list({ page: 1, page_size: 5 }),
  });

  // Active-scans count cannot be read from a 5-row page, so ask the API for the count of each
  // live status directly (page_size 1 keeps the payload tiny; only `.count` is used).
  const { data: queuedPage, isLoading: queuedLoading } = useQuery({
    queryKey: ['scans', { count: 'queued' }],
    queryFn: () => scansApi.list({ status: 'queued', page: 1, page_size: 1 }),
  });
  const { data: inProgressPage, isLoading: inProgressLoading } = useQuery({
    queryKey: ['scans', { count: 'in_progress' }],
    queryFn: () => scansApi.list({ status: 'in_progress', page: 1, page_size: 1 }),
  });

  const totalScans = scansPage?.count ?? 0;
  const totalFindings = findingsPage?.count ?? 0;
  const activeScans = (queuedPage?.count ?? 0) + (inProgressPage?.count ?? 0);
  const recentScans = scansPage?.results ?? [];
  const recentFindings = findingsPage?.results ?? [];

  const formatScanType = (type: string) => {
    const typeMap: Record<string, string> = {
      org_repos: 'Organization Repositories',
      org_users: 'Organization Users',
      search_code: 'Search Code',
      search_commits: 'Search Commits',
      search_issues: 'Search Issues',
      search_repos: 'Search Repositories',
      search_users: 'Search Users',
    };
    return typeMap[type] || type;
  };

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-2xl font-bold text-foreground sm:text-3xl">Dashboard</h1>
        <Link
          to="/scans/new"
          className="inline-flex min-h-11 items-center justify-center whitespace-nowrap rounded-lg bg-primary px-4 py-2 font-medium text-primary-foreground transition-opacity hover:opacity-90"
        >
          New Scan
        </Link>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 gap-4 sm:gap-6 md:grid-cols-3">
        <div className="rounded-lg border border-border bg-card p-4 sm:p-6">
          <h3 className="text-sm font-medium text-muted-foreground">Total Scans</h3>
          <p className="text-3xl font-bold text-foreground mt-2">
            {scansLoading ? '...' : totalScans}
          </p>
          <Link to="/scans" className="text-xs text-primary hover:underline mt-1 inline-block">
            View all scans
          </Link>
        </div>

        <div className="rounded-lg border border-border bg-card p-4 sm:p-6">
          <h3 className="text-sm font-medium text-muted-foreground">Total Findings</h3>
          <p className="text-3xl font-bold text-foreground mt-2">
            {findingsLoading ? '...' : totalFindings}
          </p>
          <Link to="/findings" className="text-xs text-primary hover:underline mt-1 inline-block">
            View all findings
          </Link>
        </div>

        <div className="rounded-lg border border-border bg-card p-4 sm:p-6">
          <h3 className="text-sm font-medium text-muted-foreground">Active Scans</h3>
          <p className="text-3xl font-bold text-foreground mt-2">
            {scansLoading || queuedLoading || inProgressLoading ? '...' : activeScans}
          </p>
          <p className="text-xs text-muted-foreground mt-1">In progress or queued</p>
        </div>
      </div>

      {/* Recent Scans */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-semibold text-foreground">Recent Scans</h2>
          <Link to="/scans" className="text-sm text-primary hover:underline">
            View all
          </Link>
        </div>
        {scansLoading ? (
          <div className="p-8 bg-card border border-border rounded-lg text-center">
            <p className="text-muted-foreground">Loading...</p>
          </div>
        ) : recentScans.length === 0 ? (
          <div className="p-8 bg-card border border-border rounded-lg text-center">
            <p className="text-muted-foreground">No scans yet</p>
            <p className="text-sm text-muted-foreground mt-2">
              Start by creating a new scan
            </p>
          </div>
        ) : (
          <div className="bg-card border border-border rounded-lg overflow-hidden">
            <div className="divide-y divide-border">
              {recentScans.map((scan) => (
                <Link
                  key={scan.id}
                  to={`/scans/${scan.id}`}
                  className="block p-4 hover:bg-muted/50 transition-colors"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      {/* Fixed first column so the label sits at the same x on every row, whatever
                          the title length; the title wraps in its own column with a hanging indent. */}
                      <div className="grid grid-cols-[5.5rem_1fr] items-start gap-x-2">
                        <StatusIndicator
                          tone={scanStatusTone(scan.status)}
                          label={scanStatusLabel(scan.status)}
                        />
                        <span className="min-w-0 text-sm font-medium leading-5 text-foreground">
                          {formatScanType(scan.type)}
                        </span>
                        <p className="col-span-2 mt-1 truncate text-sm text-muted-foreground">
                          {scan.value}
                        </p>
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-sm tabular-nums text-foreground">
                        {scan.total_findings} findings
                      </p>
                      <p className="text-xs tabular-nums text-muted-foreground mt-1">
                        {new Date(scan.created_at).toLocaleDateString()}
                      </p>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Recent Findings */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-semibold text-foreground">Recent Findings</h2>
          <Link to="/findings" className="text-sm text-primary hover:underline">
            View all
          </Link>
        </div>
        {findingsLoading ? (
          <div className="p-8 bg-card border border-border rounded-lg text-center">
            <p className="text-muted-foreground">Loading...</p>
          </div>
        ) : recentFindings.length === 0 ? (
          <div className="p-8 bg-card border border-border rounded-lg text-center">
            <p className="text-muted-foreground">No findings yet</p>
            <p className="text-sm text-muted-foreground mt-2">
              Run a scan to discover security findings
            </p>
          </div>
        ) : (
          <div className="bg-card border border-border rounded-lg overflow-hidden">
            <div className="divide-y divide-border">
              {recentFindings.map((finding) => (
                <div
                  key={finding.id}
                  className="p-4 hover:bg-muted/50 transition-colors"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="grid grid-cols-[5.5rem_1fr] items-start gap-x-2">
                        <StatusIndicator
                          tone={validatedTone(finding.validated)}
                          label={validatedLabel(finding.validated)}
                        />
                        <span className="min-w-0 text-sm font-medium leading-5 text-foreground">
                          {finding.type}
                        </span>
                        <p className="col-span-2 mt-1 truncate text-sm text-muted-foreground">
                          {finding.repository}
                        </p>
                      </div>
                    </div>
                    <div className="shrink-0 max-w-[55%] text-right">
                      <p className="text-sm text-foreground truncate" title={finding.email || ''}>
                        {finding.email || 'N/A'}
                      </p>
                      <p className="text-xs tabular-nums text-muted-foreground mt-1">
                        {new Date(finding.created_at).toLocaleDateString()}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
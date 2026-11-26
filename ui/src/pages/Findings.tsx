import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import {
  Check,
  ChevronRight,
  Copy,
  ExternalLink,
  Flag,
  Link2,
  RefreshCw,
  ShieldCheck,
  SlidersHorizontal,
  Trash2,
  X,
} from 'lucide-react';
import { findingsApi, programsApi } from '@/services/api';
import type { Finding, HumanVerdict } from '@/types';
import {
  nextSort,
  readSortParam,
  sortRows,
  writeSortParams,
  type SortState,
  type SortValue,
} from '@/lib/table-sort';
import { SortHeader } from '@/components/SortHeader';

/**
 * Findings review surface.
 *
 * Two systems describe one finding and they used to be rendered as if they agreed. GitAlerts stores
 * TruffleHog's own `verified` flag in `validated`; the scan factory stores the pipeline's verdict in
 * a validation record plus the gate results in `gate_json`. A row can be green in the first and
 * closed in the second, which is exactly what most of these rows are.
 *
 * So the list is driven by the pipeline verdict, the scanner's claim is demoted to a line in the
 * drawer, and every row carries the gates that produced the verdict. `/factory/review.json` is
 * authored by `factory.py review-publish`; nothing on this page invents a verdict or a score.
 *
 * Drawer rule: no folds and no masked secrets. Each question a reviewer asks (what is it, does it
 * work, why this verdict, what would it cost, where does it go, what next) is answered once, in the
 * open, in that order. The value prints in full so the rotation can be checked and copied; the
 * detector note says what a live value of that kind buys, which is the fact the row alone lacks.
 *
 * Layout note: the old table was a natural-width table inside `overflow-x-auto`, which measured
 * 1791px against a 1199px container and produced the horizontal scrollbar. This one is
 * `table-fixed` with percentage widths and hidden columns at narrow breakpoints, so it cannot
 * overflow at any width.
 */

interface ReviewGate {
  key: string;
  label: string;
  question: string;
  status: 'pass' | 'fail' | 'skip' | 'unknown';
  note: string;
}

interface ReviewSignal {
  label: string;
  value: string;
  note: string;
}

/** One answer in the six-step flow. `status` is what the page colours, never a verdict. */
interface ReviewStep {
  key: string;
  title: string;
  status: 'done' | 'warn' | 'todo' | 'blocked' | string;
  body: string;
}

/** The harvested program record for the finding's domain, not a claim about the repository owner. */
interface ReviewProgram {
  name: string;
  platform: string | null;
  offers_bounty: boolean;
  scopes_count: number;
  policy: string;
  contact: string | null;
  read_on: string;
}

interface ReviewItem {
  fingerprint: string;
  ga_id: number | null;
  ref: string;
  org: string | null;
  domain: string | null;
  type: string | null;
  repository: string | null;
  file: string | null;
  line: number | null;
  commit_hash: string | null;
  commit_url: string | null;
  email: string | null;
  triage_state: string;
  triage_note: string | null;
  verdict_reason: string | null;
  path_class: string;
  repo_class: string;
  first_seen: string | null;
  last_seen: string | null;
  action: string;
  command: string | null;
  override: string | null;
  verdict: string;
  verdict_source: 'record' | 'triage' | 'none';
  headline: string;
  blocker: string | null;
  method: string | null;
  detail: string | null;
  actor: string | null;
  recorded_at: string | null;
  gates: ReviewGate[];
  likelihood: { score: number | null; band: string; basis: string };
  signals: ReviewSignal[];
  /** What the provider answered when the pipeline asked. `live` is the fact the page badges. */
  probe?: { state: string; note: string; live: boolean };
  severity: string | null;
  severity_source_url: string | null;
  severity_read_on: string | null;
  impact_category?: string | null;
  /** Facts the page filters on. Absent on a snapshot built before labels existed. */
  labels?: string[];
  /** The program record for this domain, or null when the dataset has none. */
  program?: ReviewProgram | null;
  /** The six questions: found, tested, extracted, impact, prove more, report. */
  steps?: ReviewStep[];
  channel: {
    platform: string | null;
    program: string | null;
    submit_url: string | null;
    policy_url: string | null;
    asset: string | null;
  };
  evidence: string | null;
}

interface ReviewSnapshot {
  generated_at: string;
  total: number;
  counts: Record<string, number>;
  by_band: Record<string, number>;
  reportable: number;
  /** Rows where a provider accepted the credential, whatever gate closed them. */
  proven_live?: number;
  /** Count per label, from the same pass that built the rows. */
  by_label?: Record<string, number>;
  /** One line per label, authored by the factory so the page cannot drift from it. */
  label_info?: Record<string, string>;
  items: ReviewItem[];
}

const fetchReview = async (): Promise<ReviewSnapshot | null> => {
  const res = await fetch('/factory/review.json', { cache: 'no-store' });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`review snapshot: HTTP ${res.status}`);
  const type = res.headers.get('content-type') ?? '';
  if (!type.includes('json')) {
    throw new Error('review snapshot unreadable: served as HTML, so the /factory mount is missing or empty');
  }
  return res.json();
};

const VERDICT: Record<string, { label: string; dot: string; text: string }> = {
  validated: { label: 'Validated', dot: 'bg-emerald-500', text: 'text-emerald-700 dark:text-emerald-400' },
  reported: { label: 'Reported', dot: 'bg-emerald-500', text: 'text-emerald-700 dark:text-emerald-400' },
  paid: { label: 'Paid', dot: 'bg-emerald-500', text: 'text-emerald-700 dark:text-emerald-400' },
  candidate: { label: 'Review', dot: 'bg-amber-500', text: 'text-amber-700 dark:text-amber-400' },
  blocked: { label: 'Blocked', dot: 'bg-rose-500', text: 'text-rose-700 dark:text-rose-400' },
  unprobeable: { label: 'Untestable', dot: 'bg-violet-500', text: 'text-violet-700 dark:text-violet-400' },
  rejected: { label: 'Closed', dot: 'bg-muted-foreground/50', text: 'text-muted-foreground' },
  duplicate: { label: 'Dup', dot: 'bg-muted-foreground/50', text: 'text-muted-foreground' },
  // The courtesy verdicts. Without these three the page fell back to "Untriaged" for every
  // out-of-scope row, which is how 78 settled findings were being counted as work still to do.
  out_of_scope: { label: 'Out of scope', dot: 'bg-amber-500', text: 'text-amber-700 dark:text-amber-400' },
  scope_unknown: { label: 'Scope unknown', dot: 'bg-amber-500', text: 'text-amber-700 dark:text-amber-400' },
  not_org_secret: { label: 'Third-party', dot: 'bg-violet-500', text: 'text-violet-700 dark:text-violet-400' },
  no_channel: { label: 'No channel', dot: 'bg-rose-500', text: 'text-rose-700 dark:text-rose-400' },
  untriaged: { label: 'Untriaged', dot: 'bg-sky-500', text: 'text-sky-700 dark:text-sky-400' },
};

const verdictMeta = (verdict: string) => VERDICT[verdict] ?? VERDICT.untriaged;

const BAND: Record<string, { label: string; width: string; text: string; bar: string }> = {
  high: { label: 'High', width: 'w-full', text: 'text-emerald-700 dark:text-emerald-400', bar: 'bg-emerald-500' },
  medium: { label: 'Medium', width: 'w-2/3', text: 'text-amber-700 dark:text-amber-400', bar: 'bg-amber-500' },
  low: { label: 'Low', width: 'w-1/3', text: 'text-orange-700 dark:text-orange-400', bar: 'bg-orange-500' },
  'very low': { label: 'Very low', width: 'w-[8%]', text: 'text-muted-foreground', bar: 'bg-muted-foreground/40' },
  unknown: { label: 'Unknown', width: 'w-0', text: 'text-muted-foreground', bar: 'bg-muted-foreground/30' },
};

const bandMeta = (band: string) => BAND[band] ?? BAND.unknown;

/**
 * The filter vocabulary the factory publishes.
 *
 * The three program labels are the point of this row: a paying program, a program that publishes a
 * policy and pays nothing, and no program record at all are three different reporting situations,
 * and the middle one is exactly where a live credential like F-0160 ends up. Collapsing them into
 * "out of scope" is what made the old page unable to answer "where does this get reported".
 */
const LABEL_META: Record<string, { text: string; tone: string; hint: string }> = {
  bounty: {
    text: 'Bounty program',
    tone: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
    hint: 'the program record for this domain pays a bounty',
  },
  'vdp-only': {
    text: 'VDP, no bounty',
    tone: 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400',
    hint: 'the program record publishes a policy and pays nothing',
  },
  'no-program': {
    text: 'No program',
    tone: 'border-rose-500/40 bg-rose-500/10 text-rose-700 dark:text-rose-400',
    hint: 'no program record exists for this domain, so no platform takes the report',
  },
  unmapped: {
    text: 'No domain',
    tone: 'border-border bg-muted text-muted-foreground',
    hint: 'the finding has no program domain, so no program could be resolved',
  },
  'out-of-scope': {
    text: 'Out of scope',
    tone: 'border-orange-500/40 bg-orange-500/10 text-orange-700 dark:text-orange-400',
    hint: "the repository is not in the program's own scope",
  },
  'third-party': {
    text: 'Third-party secret',
    tone: 'border-violet-500/40 bg-violet-500/10 text-violet-700 dark:text-violet-400',
    hint: 'the committer is not the org, so the secret is theirs to rotate',
  },
  live: {
    text: 'Active',
    tone: 'border-slate-400/40 bg-slate-500/10 text-slate-600 dark:text-slate-300',
    hint: 'the provider accepted the credential, so it is still usable; this says nothing about whether the finding is worth reporting',
  },
  dead: {
    text: 'Dead',
    tone: 'border-border bg-muted text-muted-foreground',
    hint: 'the provider refused the credential',
  },
  closed: {
    text: 'Closed',
    tone: 'border-border bg-muted text-muted-foreground',
    hint: 'a verdict closed the row',
  },
  untriaged: {
    text: 'Untriaged',
    tone: 'border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-400',
    hint: 'the pipeline has not reached the row',
  },
  'no-impact': {
    text: 'No impact',
    tone: 'border-border bg-muted text-muted-foreground',
    hint: 'no impact is written down for this row',
  },
  'no-channel': {
    text: 'No channel',
    tone: 'border-border bg-muted text-muted-foreground',
    hint: 'no submission channel is recorded',
  },
};

/** Chips are ordered by reporting situation, then by evidence, so the row reads left to right. */
const LABEL_ORDER = [
  'bounty', 'vdp-only', 'no-program', 'unmapped', 'out-of-scope', 'third-party',
  'live', 'dead', 'closed', 'untriaged', 'no-impact', 'no-channel',
];

const labelMeta = (key: string) =>
  LABEL_META[key] ?? {
    text: key,
    tone: 'border-border bg-muted text-muted-foreground',
    hint: '',
  };

/**
 * One line per detector: what the value is and what a live one buys.
 *
 * "Infura" and "AWS" tell a reviewer nothing about whether a live hit is a bill, an identity or a
 * public identifier, and that gap is why a live project ID read as a false positive. These are
 * descriptions of the detector, never of the row: no verdict, score or impact is read from here.
 * Keys are the TruffleHog detector names GitAlerts stores, lowercased.
 */
const DETECTOR_NOTE: Record<string, string> = {
  infura:
    "A project ID from the RPC URL. It authenticates the request and bills the owner's Infura project, so a live one is free RPC capacity on their quota.",
  alchemy:
    "An API key from the RPC URL. It authenticates and bills the owner's Alchemy app, so a live one is free RPC capacity on their quota.",
  aws: 'An access key ID. It names an IAM identity; it only authenticates together with its paired secret key.',
  postgres:
    'A connection string with a database password. A live one opens the database wherever its host is reachable.',
  mongodb:
    'A connection URI with database credentials. A live one opens the database wherever its host is reachable.',
  privatekey:
    'A private key file. A live one signs or authenticates as its owner wherever the matching public key is trusted.',
  githuboauth2:
    'An OAuth client secret for a GitHub app. It completes token exchanges for that client; it does not act as a user on its own.',
  algoliaadminkey: 'An Algolia admin key. A live one reads, writes and deletes every index the key reaches.',
  coinbase:
    'A Coinbase API credential. A live one reads the account and, inside its permissions, moves funds.',
  xai: "An xAI API key. A live one spends the owner's credit on model calls.",
  storyblokaccesstoken: "A Storyblok management token. A live one reads and edits the space's content.",
  twitterconsumerkey:
    'A Twitter/X consumer key. With its secret it signs requests as the app; alone it only names the app.',
  pubnubpublishkey:
    'A PubNub publish key, which is meant to be public. Abuse is messages sent on the owner\'s channels and quota.',
  uri: 'A URL that carried a credential or a signed token. Whether it is still a secret depends on the host in it.',
  gcp: 'A Google Cloud credential. A live one acts as the service account inside its IAM roles.',
  stripepaymentintent:
    'The client secret of one Stripe payment intent. It confirms that single payment, not the account.',
  sonarcloud: "An analysis token. A live one reads the org's projects and can push analysis results.",
  sonarqube: "An analysis token. A live one reads the server's projects and can push analysis results.",
  vercel: "A Vercel token. A live one deploys to and reads the team's projects.",
  cloudflareapitoken:
    'A Cloudflare API token. A live one reads and changes whatever zones and permissions it was scoped to.',
  twilio: 'An account SID and auth token. A live pair sends messages and reads billing on the account.',
};

/** The tiles. A verdict belongs to exactly one bucket. */
const BUCKETS: Array<{ key: string; label: string; hint: string; sample: string; verdicts: string[] }> = [
  {
    key: 'review',
    label: 'Needs review',
    hint: 'Every gate passed and a human has to write the impact or the channel',
    sample: 'candidate',
    verdicts: ['candidate'],
  },
  {
    key: 'blocked',
    label: 'Blocked by a gate',
    hint: 'A gate disqualifies the row, but no verdict has been written down yet',
    sample: 'blocked',
    verdicts: ['blocked'],
  },
  {
    key: 'courtesy',
    label: 'Courtesy lane',
    hint: 'Real but nobody pays for it: out of scope or a third party\'s secret, so the only route is a private note to the owner',
    sample: 'out_of_scope',
    verdicts: ['out_of_scope', 'scope_unknown', 'not_org_secret', 'no_channel'],
  },
  {
    key: 'untestable',
    label: 'Cannot test',
    hint: 'In scope, but no probe exists for this detector, so nothing can be proven from outside',
    sample: 'unprobeable',
    verdicts: ['unprobeable'],
  },
  {
    key: 'closed',
    label: 'Closed',
    hint: 'A validation record exists: rejected, duplicate, or already submitted',
    sample: 'rejected',
    verdicts: ['rejected', 'duplicate', 'validated', 'reported', 'paid'],
  },
  {
    key: 'untriaged',
    label: 'Untriaged',
    hint: 'The pipeline has not reached this row yet',
    sample: 'untriaged',
    verdicts: ['untriaged'],
  },
];

const BUCKET_OF: Record<string, string> = {};
for (const bucket of BUCKETS) for (const verdict of bucket.verdicts) BUCKET_OF[verdict] = bucket.key;

/** Sorting by verdict follows the tiles, left to right: work still to do comes first. */
const BUCKET_RANK: Record<string, number> = {};
BUCKETS.forEach((bucket, index) => {
  BUCKET_RANK[bucket.key] = index;
});

const repoLabel = (repository: string | null): string => {
  if (!repository) return 'unknown repository';
  const slug = repository.includes('github.com/') ? repository.split('github.com/')[1] : repository;
  return slug.replace(/\.git$/, '').replace(/\/$/, '');
};

const repoUrl = (repository: string | null): string | null => {
  if (!repository) return null;
  return repository.startsWith('http') ? repository : `https://github.com/${repository}`;
};

/** Deep link to the exact line that produced a finding, on the commit that holds it. */
const githubLineUrl = (item: ReviewItem): string | null => {
  if (!item.file || !item.repository) return null;
  const ownerRepo = repoLabel(item.repository).split('/').filter(Boolean).slice(0, 2).join('/');
  if (!ownerRepo.includes('/')) return null;
  const ref = item.commit_hash || 'HEAD';
  const path = String(item.file).split('/').map(encodeURIComponent).join('/');
  return `https://github.com/${ownerRepo}/blob/${ref}/${path}${item.line ? `#L${item.line}` : ''}`;
};

/**
 * Compact, unambiguous stamp: "Nov 23 22:22". `toLocaleString` on a narrow column wraps to three
 * lines in this container's font, which is what made the old table rows tall as well as wide.
 */
const shortDate = (iso: string | null): string => {
  if (!iso) return '-';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '-';
  const month = date.toLocaleString(undefined, { month: 'short' });
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${month} ${date.getDate()} ${hours}:${minutes}`;
};

/**
 * Writing to the clipboard needs two paths. This UI is served over plain HTTP, where
 * `navigator.clipboard` is undefined because the page is not a secure context, so the
 * selection-based fallback is the one that actually runs in the browser this page is for.
 * The fallback keeps its textarea off screen and restores focus, so it is invisible on click.
 */
const copyText = async (text: string): Promise<boolean> => {
  if (typeof navigator.clipboard?.writeText === 'function') {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Permission denied or an insecure origin: fall through to the selection path.
    }
  }
  const previous = document.activeElement as HTMLElement | null;
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.setAttribute('aria-hidden', 'true');
  area.style.position = 'fixed';
  area.style.top = '0';
  area.style.left = '0';
  area.style.width = '1px';
  area.style.height = '1px';
  area.style.padding = '0';
  area.style.border = 'none';
  area.style.opacity = '0';
  document.body.appendChild(area);
  let ok = false;
  try {
    area.focus();
    area.select();
    area.setSelectionRange(0, area.value.length);
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  } finally {
    document.body.removeChild(area);
    previous?.focus();
  }
  return ok;
};

/**
 * The reference is the handle people paste into chat, so it carries its own copy control.
 * The ref stays plain selectable text; only the small button beside it is interactive.
 */
const CopyRef: React.FC<{
  value: string;
  copied: boolean;
  onCopy: () => void;
  className?: string;
}> = ({ value, copied, onCopy, className }) => (
  <span className={`inline-flex min-w-0 items-center gap-1 ${className ?? ''}`}>
    <span className="select-text truncate font-mono text-[11px] text-muted-foreground">{value}</span>
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        onCopy();
      }}
      aria-label={copied ? `Copied ${value}` : `Copy reference ${value}`}
      title={copied ? 'Copied' : `Copy ${value}`}
      className="inline-flex shrink-0 items-center gap-0.5 rounded px-1 py-0.5 text-muted-foreground hover:bg-accent hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
      {copied ? <span className="text-[10px] font-medium">copied</span> : null}
    </button>
  </span>
);

/**
 * The drawer's indicator row answers the five questions a reviewer asks before reading anything:
 * what state, is it in scope, is there impact, how bad, and where does it go.
 */
const STATE_TONE = {
  neutral: 'border-border bg-muted text-muted-foreground',
  rejected: 'border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-400',
  candidate: 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400',
  good: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
  untestable: 'border-violet-500/30 bg-violet-500/10 text-violet-700 dark:text-violet-400',
};

const stateMeta = (item: ReviewItem): { label: string; tone: string } => {
  const outOfScope =
    item.triage_state === 'outside_scope_list' ||
    (item.verdict === 'blocked' && item.blocker === 'scope' && item.triage_state !== 'scope_unknown');
  if (outOfScope) return { label: 'Out of scope', tone: STATE_TONE.neutral };
  if (item.verdict === 'rejected' || item.verdict === 'duplicate' || item.triage_state === 'rejected') {
    return { label: 'Rejected', tone: STATE_TONE.rejected };
  }
  switch (item.verdict) {
    case 'candidate':
      return { label: 'Candidate', tone: STATE_TONE.candidate };
    case 'validated':
      return { label: 'Validated', tone: STATE_TONE.good };
    case 'reported':
    case 'paid':
      return { label: 'Reported', tone: STATE_TONE.good };
    case 'unprobeable':
      return { label: 'Untestable', tone: STATE_TONE.untestable };
    default:
      return { label: 'Untriaged', tone: STATE_TONE.neutral };
  }
};

/** Scope comes from the scope gate first, then the channel asset, so no new field is invented. */
const scopeMeta = (item: ReviewItem): string => {
  const gate = item.gates.find((entry) => entry.key === 'scope');
  if (gate?.status === 'pass') return 'In scope';
  if (gate?.status === 'unknown' || item.triage_state === 'scope_unknown') return 'Scope unknown';
  if (gate?.status === 'fail') return 'Out of scope';
  if (item.triage_state === 'outside_scope_list') return 'Out of scope';
  if (item.channel.asset) return 'In scope';
  return 'Unknown';
};

const impactMeta = (item: ReviewItem): string => {
  const raw = (item.impact_category ?? '').trim();
  if (!raw || raw === 'none' || raw === 'none_demonstrated') return 'None demonstrated';
  const words = raw.replace(/_/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
};

const Chip: React.FC<{ label: string; value: string; tone: string; title?: string }> = ({
  label,
  value,
  tone,
  title,
}) => (
  <span
    title={title}
    className={`inline-flex max-w-full items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] ${tone}`}
  >
    <span className="shrink-0 text-[10px] font-medium uppercase tracking-wide opacity-70">{label}</span>
    <span className="truncate font-medium">{value}</span>
  </span>
);

/**
 * Liveness as its own reading, not a verdict. A credential can be proven live and still be closed
 * by the ownership or scope gate, so this is shown beside the verdict and never replaces it.
 */
const probeMeta = (item: ReviewItem): { label: string; tone: string; title: string } => {
  const state = item.probe?.state ?? 'none';
  const note = item.probe?.note || 'no identity request was sent';
  switch (state) {
    case 'live':
      return { label: 'Accepted', tone: STATE_TONE.good, title: note };
    case 'dead':
      return { label: 'Refused', tone: STATE_TONE.rejected, title: note };
    case 'inconclusive':
      return { label: 'Inconclusive', tone: STATE_TONE.candidate, title: note };
    case 'unprobeable':
      return { label: 'Not probeable', tone: STATE_TONE.untestable, title: note };
    default:
      return { label: 'Not probed', tone: STATE_TONE.neutral, title: note };
  }
};

/**
 * The one marker a reviewer scans for: the provider accepted this credential.
 *
 * It says "Active", not "Live", because live read as "this finding is good" when all it means is
 * that the value still works. The colour is deliberately quiet for the same reason: liveness is
 * one input to the verdict, not the verdict.
 */
const ActiveBadge: React.FC<{ item: ReviewItem; className?: string }> = ({ item, className }) => {
  if (!item.probe?.live) return null;
  return (
    <span
      title={item.probe.note || 'the provider accepted this credential'}
      className={`inline-flex shrink-0 items-center gap-1 rounded-full border border-slate-400/40 bg-slate-500/10 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide text-slate-600 dark:text-slate-300 ${className ?? ''}`}
    >
      <span aria-hidden="true" className="h-1 w-1 rounded-full bg-slate-400" />
      Active
    </span>
  );
};

/**
 * A block of the drawer. Always open: the drawer was nine `<details>` elements, and a reason behind
 * a fold is a reason a reviewer skips. A rule and a small label cost less vertical space than a
 * summary row and carry the content without a click.
 */
const Section: React.FC<{ title: string; right?: React.ReactNode; children: React.ReactNode }> = ({
  title,
  right,
  children,
}) => (
  <section className="mt-3 border-t border-border pt-1.5">
    <div className="flex items-baseline gap-2">
      <h3 className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
      {right ? <span className="ml-auto shrink-0">{right}</span> : null}
    </div>
    <div className="mt-1 space-y-1">{children}</div>
  </section>
);

/** True when two recorded strings say the same thing, in either direction. */
const sameFact = (a?: string | null, b?: string | null): boolean => {
  const x = (a ?? '').trim().toLowerCase();
  const y = (b ?? '').trim().toLowerCase();
  if (!x || !y) return false;
  return x === y || (x.length > 12 && y.includes(x)) || (y.length > 12 && x.includes(y));
};

const Field: React.FC<{ label: string; className?: string; children: React.ReactNode }> = ({
  label,
  className,
  children,
}) => (
  <div className={`flex gap-2 ${className ?? ''}`}>
    <dt className="w-16 shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground">{label}</dt>
    <dd className="min-w-0 flex-1 break-words text-[11px] leading-snug text-foreground">{children}</dd>
  </div>
);

/** A command with its own copy button, printed in full rather than parked behind a fold. */
const CodeLine: React.FC<{
  label: string;
  name: string;
  value: string;
  copied: string | null;
  onCopy: (text: string, key: string) => void;
}> = ({ label, name, value, copied, onCopy }) => (
  <div className="flex items-start gap-2 rounded bg-muted px-2 py-1.5">
    <span className="mt-0.5 w-14 shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground">
      {label}
    </span>
    <code className="min-w-0 flex-1 break-all font-mono text-[10px] leading-relaxed text-foreground">
      {value}
    </code>
    <button
      onClick={() => onCopy(value, name)}
      aria-label={`Copy ${label}`}
      className="shrink-0 text-muted-foreground hover:text-foreground"
    >
      {copied === name ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  </div>
);

type PathTone = 'plain' | 'bad' | 'good' | 'muted';

const PATH_BOX: Record<PathTone, string> = {
  plain: 'border-border bg-card text-foreground',
  bad: 'border-rose-500/50 bg-rose-500/10 text-rose-700 dark:text-rose-300',
  good: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-800 dark:text-emerald-300',
  muted: 'border-dashed border-border text-muted-foreground',
};

interface PathStep {
  title: string;
  body: string;
  /** Caption on the arrow into the next box. */
  edge?: string;
  tone: PathTone;
}

/**
 * The attack path, drawn the way a reviewer reads a diagram faster than prose: what was exposed,
 * what answered for it, and what it would reach.
 *
 * Every box is a recorded fact (repository and commit, probe answer, impact field); the page does
 * not generate an exploit chain. The dashed box is the part nothing proved, which is exactly the
 * line between "this value still works" and "this is worth a report".
 */
const AttackPath: React.FC<{ steps: PathStep[] }> = ({ steps }) => (
  <section className="mt-3 rounded-lg border border-border bg-muted/20 px-3 py-2.5">
    <ol className="mx-auto max-w-[24rem]">
      {steps.map((step) => (
        <li key={step.title}>
          <div className={`rounded-md border px-3 py-1.5 text-center ${PATH_BOX[step.tone]}`}>
            <p className="text-[11px] font-semibold leading-tight">{step.title}</p>
            <p className="mt-0.5 break-words text-[10px] leading-snug opacity-80">{step.body}</p>
          </div>
          {step.edge ? (
            <div className="flex flex-col items-center py-0.5" aria-hidden="true">
              <span className="h-2 w-px bg-border" />
              <span className="text-[9px] leading-none text-muted-foreground">{step.edge}</span>
              <span className="h-2 w-px bg-border" />
            </div>
          ) : null}
        </li>
      ))}
    </ol>
    <p className="mt-1.5 flex flex-wrap items-center justify-center gap-3 text-[9px] text-muted-foreground">
      <span className="inline-flex items-center gap-1">
        <span aria-hidden="true" className="h-2 w-2 rounded-sm border border-rose-500/60 bg-rose-500/10" />
        exposed value
      </span>
      <span className="inline-flex items-center gap-1">
        <span aria-hidden="true" className="h-2 w-2 rounded-sm border border-dashed border-border" />
        nothing proven past here
      </span>
    </p>
  </section>
);

/**
 * The human trail: this row was sent somewhere. Deliberately quiet and unbranded, because it is
 * neither a verdict nor a proof, just a note that a submission left the building.
 */
const ReportedBadge: React.FC<{ finding?: Finding | null }> = ({ finding }) => {
  if (finding?.report_status !== 'reported') return null;
  const when = finding.reported_at ? shortDate(finding.reported_at) : null;
  return (
    <span
      title={when ? `marked reported ${when}` : 'marked reported'}
      className="inline-flex shrink-0 items-center rounded-full border border-border bg-muted px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide text-muted-foreground"
    >
      Reported
    </span>
  );
};

/**
 * The human's claim about a verdict. A claim is not a decision: it says which question the row's
 * verdict got wrong, and the reviewer settles it against the evidence. The three groups are kept
 * apart on purpose, because only the first is a false positive at all.
 */
const HUMAN_CLAIMS: {
  key: Exclude<HumanVerdict, ''>;
  label: string;
  chip: string;
  tone: string;
  reasons: { key: string; label: string }[];
}[] = [
  {
    key: 'detector_wrong',
    label: 'Detector was wrong',
    chip: 'Detector wrong',
    tone: 'border-rose-500/40 bg-rose-500/10 text-rose-700 dark:text-rose-300',
    reasons: [
      { key: 'scanner_fixture', label: "The scanner's own fixture or test data" },
      { key: 'fixture_in_detector_source', label: 'Inside a bundled archive or detector source' },
    ],
  },
  {
    key: 'not_ours',
    label: "Not this org's credential",
    chip: 'Not ours',
    tone: 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300',
    reasons: [
      { key: 'upstream_inherited', label: 'Comes from the upstream project' },
      { key: 'vendored_path', label: 'Sits in a dependency directory' },
      { key: 'documented_public', label: 'Published by the repository itself' },
      { key: 'same_value_as_earlier', label: 'Same value as an earlier row' },
    ],
  },
  {
    key: 'not_reportable',
    label: 'Real, but not reportable here',
    chip: 'Not reportable',
    tone: 'border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-300',
    reasons: [
      { key: 'live_not_eligible', label: 'Not eligible through this program' },
      { key: 'courtesy_out_of_scope', label: 'Out of scope, kept for the courtesy lane' },
      { key: 'scope_unlisted_repo', label: 'Repository is not in the scope list' },
      { key: 'scope_mismatch', label: 'Scope record is about another program' },
      { key: 'scope_unknown', label: 'No trustworthy scope record exists' },
      { key: 'no_program', label: 'No disclosure program at all' },
      { key: 'no_impact_by_design', label: 'No impact any program would accept' },
      { key: 'removed_from_tree', label: 'Value is no longer in the tree' },
      { key: 'revoked', label: 'Credential has been revoked' },
      { key: 'test_path_excluded', label: 'Test or example file' },
    ],
  },
];

const claimLabel = (verdict?: HumanVerdict, reason?: string): string => {
  const claim = HUMAN_CLAIMS.find((entry) => entry.key === verdict);
  if (!claim) return '';
  const why = claim.reasons.find((entry) => entry.key === reason)?.label;
  return why ? `${claim.label}: ${why.toLowerCase()}` : claim.label;
};

/**
 * The human trail for a claim, quiet for the same reason the reported badge is: it is neither a
 * verdict nor a proof, just the question a person asked the reviewer to settle.
 */
const ClaimBadge: React.FC<{ finding?: Finding | null }> = ({ finding }) => {
  const claim = HUMAN_CLAIMS.find((entry) => entry.key === finding?.human_verdict);
  if (!claim) return null;
  return (
    <span
      title={finding?.human_note ? `${claimLabel(finding.human_verdict, finding.human_reason)}: ${finding.human_note}` : claimLabel(finding?.human_verdict, finding?.human_reason)}
      className={`inline-flex shrink-0 items-center rounded-full border px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide ${claim.tone}`}
    >
      {claim.chip}
    </span>
  );
};

const DOT: Record<ReviewGate['status'], string> = {
  pass: 'bg-emerald-500',
  fail: 'bg-rose-500',
  skip: 'bg-muted-foreground/30',
  unknown: 'bg-sky-500',
};

const GATE_WORD: Record<ReviewGate['status'], string> = {
  pass: 'passed',
  fail: 'blocked',
  skip: 'not reached',
  unknown: 'not recorded',
};

const PAGE_SIZE = 40;
const FETCH_LIMIT = 500;

/**
 * The same orders the header offers, for the phone layout, which renders a list rather than a
 * header row. Values are `key:dir`, matching the URL pair.
 */
const SORT_OPTIONS: Array<{ value: string; label: string }> = [
  { value: '', label: 'As loaded' },
  { value: 'verdict:asc', label: 'Verdict, needs review first' },
  { value: 'likelihood:desc', label: 'Likelihood, high first' },
  { value: 'found:desc', label: 'Newest first' },
  { value: 'found:asc', label: 'Oldest first' },
  { value: 'type:asc', label: 'Type A-Z' },
  { value: 'repository:asc', label: 'Repository A-Z' },
];

export const Findings: React.FC = () => {
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [open, setOpen] = useState<ReviewItem | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [page, setPage] = useState(1);
  const [bucket, setBucket] = useState<string | null>(searchParams.get('verdict'));
  // Closed rows are noise for every review pass, so the default view drops them. `closed=1` is the
  // one-click way back, and it lives in the URL so a shared link shows what the sender saw.
  const [showClosed, setShowClosed] = useState(searchParams.get('closed') === '1');
  // Liveness is a second axis, not a sixth bucket: a live credential can still be closed by the
  // ownership or scope gate. This toggle narrows the list to rows a provider actually accepted,
  // and it stops hiding closed rows while it is on, because nearly every live row is closed.
  const [liveOnly, setLiveOnly] = useState(searchParams.get('live') === '1');
  // The label filter is the "which of these is not even a bounty" axis: one click on "VDP, no
  // bounty" or "No program" answers a question that used to take a drawer per row. It lives in the
  // URL like every other view param so a shared link opens on the same filtered list.
  const [labelFilter, setLabelFilter] = useState<string | null>(searchParams.get('label'));
  const [copied, setCopied] = useState<string | null>(null);

  // Ordering lives in the URL beside the other view params, so a shared link shows the order the
  // sender saw. It is derived on every render rather than mirrored in state, so the two cannot drift.
  const sortQuery = searchParams.toString();
  const sort = useMemo<SortState | null>(
    () => readSortParam(new URLSearchParams(sortQuery)),
    [sortQuery],
  );

  const [filterForm, setFilterForm] = useState({
    type: searchParams.get('type') || '',
    value: searchParams.get('value') || '',
    email: searchParams.get('email') || '',
    repository: searchParams.get('repository') || '',
    scan: searchParams.get('scan') || '',
    validated: searchParams.get('validated') || '',
    created_at: searchParams.get('created_at') || '',
    program: searchParams.get('program') || '',
  });

  const filters = {
    type: searchParams.get('type') || undefined,
    value: searchParams.get('value') || undefined,
    email: searchParams.get('email') || undefined,
    repository: searchParams.get('repository') || undefined,
    scan: searchParams.get('scan') ? Number(searchParams.get('scan')) : undefined,
    validated: searchParams.get('validated') ? searchParams.get('validated') === 'true' : undefined,
    created_at: searchParams.get('created_at') || undefined,
    program: searchParams.get('program') || undefined,
  };
  const activeFilters = Object.entries(filters).filter(([, value]) => value !== undefined);

  // Program choices for the filter select. A failed fetch leaves "All" only, which still works
  // because the filter itself is driven by the URL param.
  const { data: programChoices } = useQuery({
    queryKey: ['programs'],
    queryFn: () => programsApi.list(),
  });

  const { data: review } = useQuery({
    queryKey: ['review'],
    queryFn: fetchReview,
    refetchInterval: 120_000,
  });

  /**
   * One request holds everything the server will return, because the verdict lives in the factory
   * snapshot and the API cannot filter on it. Narrowing a full set in the browser is correct;
   * asking for 50 rows and then filtering would hide matches on other pages.
   */
  const { data, isLoading, error, isFetching } = useQuery({
    queryKey: ['findings', filters],
    queryFn: () => findingsApi.list({ ...filters, page: 1, page_size: FETCH_LIMIT }),
  });

  const rows: Finding[] = useMemo(() => {
    if (!data) return [];
    if (Array.isArray(data)) return data as unknown as Finding[];
    return (data.results ?? []) as Finding[];
  }, [data]);


  const byFingerprint = useMemo(() => {
    const map = new Map<string, ReviewItem>();
    for (const item of review?.items ?? []) map.set(item.fingerprint, item);
    return map;
  }, [review]);

  const byId = useMemo(() => {
    const map = new Map<number, ReviewItem>();
    for (const item of review?.items ?? []) if (item.ga_id != null) map.set(item.ga_id, item);
    return map;
  }, [review]);

  /** A finding the factory has never seen is still a row: it just has no verdict yet. */
  const reviewOf = useCallback(
    (finding: Finding): ReviewItem | undefined =>
      byId.get(finding.id) ??
      byFingerprint.get((finding as { fingerprint?: string }).fingerprint ?? ''),
    [byId, byFingerprint],
  );

  /**
   * Every row must open. A finding that predates the review snapshot (or arrived between publishes)
   * gets an honest empty verdict instead of an unclickable row.
   */
  const drawerItem = useCallback(
    (finding: Finding): ReviewItem => {
      const item = reviewOf(finding);
      if (item) return item;
      return {
        fingerprint: '',
        ga_id: finding.id,
        ref: `#${finding.id}`,
        org: null,
        domain: null,
        type: finding.type,
        repository: finding.repository,
        file: finding.file,
        line: finding.line,
        commit_hash: finding.commit_hash,
        commit_url: finding.commit_url,
        email: finding.email,
        triage_state: 'unknown',
        triage_note: null,
        verdict_reason: null,
        path_class: 'unknown',
        repo_class: 'unknown',
        first_seen: finding.created_at,
        last_seen: finding.updated_at,
        action: 'Run the triage pass; the factory has no row for this finding yet.',
        command: 'factory.py triage',
        override: null,
        verdict: 'untriaged',
        verdict_source: 'none',
        headline: 'Not triaged yet',
        blocker: null,
        method: null,
        detail: null,
        actor: null,
        recorded_at: null,
        gates: ['ownership', 'scope', 'capability', 'impact', 'channel'].map((key) => ({
          key,
          label: key,
          question: '',
          status: 'unknown' as const,
          note: 'the pipeline has not reached this row yet',
        })),
        likelihood: { score: null, band: 'unknown', basis: 'no triage data for this row' },
        signals: [],
        severity: null,
        severity_source_url: null,
        severity_read_on: null,
        channel: { platform: null, program: null, submit_url: null, policy_url: null, asset: null },
        evidence: null,
      };
    },
    [reviewOf],
  );

  const bucketOf = useCallback(
    (finding: Finding): string => {
      const item = reviewOf(finding);
      if (!item) return 'untriaged';
      return BUCKET_OF[item.verdict] ?? 'untriaged';
    },
    [reviewOf],
  );

  /**
   * What each sortable column compares. Verdict sorts by the tile order, so ascending puts needs
   * review at the top; likelihood compares the numeric score, and a row with no score sorts last.
   */
  const sortValue = useCallback(
    (finding: Finding, key: string): SortValue => {
      switch (key) {
        case 'verdict':
          return BUCKET_RANK[bucketOf(finding)] ?? 99;
        case 'type':
          return finding.type;
        case 'repository':
          return repoLabel(finding.repository);
        case 'likelihood':
          return reviewOf(finding)?.likelihood.score ?? null;
        case 'found':
          return finding.created_at;
        default:
          return null;
      }
    },
    [bucketOf, reviewOf],
  );

  const bucketCounts = useMemo(() => {
    const counts: Record<string, number> = {
      review: 0, blocked: 0, courtesy: 0, untestable: 0, closed: 0, untriaged: 0,
    };
    for (const finding of rows) {
      const key = bucketOf(finding);
      counts[key] = (counts[key] ?? 0) + 1;
    }
    return counts;
  }, [rows, bucketOf]);

  const inBucket = useMemo(
    () => (bucket ? rows.filter((finding) => bucketOf(finding) === bucket) : rows),
    [rows, bucket, bucketOf],
  );

  /**
   * The default view is the work still to do: an explicit bucket wins, then `showClosed`, and only
   * then do closed rows drop out. The count comes from the unfiltered set, so the Closed tile stays
   * honest while the row list hides those rows. Ordering is the last stage, so it orders exactly
   * what the page shows and `visible` stays the one list pagination and the counts read.
   */
  // "Settled" is closed plus courtesy: a recorded verdict, or a real finding nobody pays for. Both
  // are history rather than work, so the default view drops them and the tiles bring them back.
  const settledBucket = (finding: Finding) => {
    const key = bucketOf(finding);
    return key === 'closed' || key === 'courtesy';
  };
  const hiddenClosed = bucket || showClosed || liveOnly || labelFilter
    ? 0
    : (bucketCounts.closed ?? 0) + (bucketCounts.courtesy ?? 0);

  const visible = useMemo(() => {
    let filtered = hiddenClosed === 0 ? inBucket : inBucket.filter((finding) => !settledBucket(finding));
    if (liveOnly) filtered = filtered.filter((finding) => reviewOf(finding)?.probe?.live === true);
    if (labelFilter) {
      filtered = filtered.filter((finding) => (reviewOf(finding)?.labels ?? []).includes(labelFilter));
    }
    return sortRows(filtered, sort, sortValue);
  }, [inBucket, hiddenClosed, bucketOf, liveOnly, labelFilter, reviewOf, sort, sortValue]);  // eslint-disable-line react-hooks/exhaustive-deps

  const totalPages = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
  const pageRows = visible.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  useEffect(() => {
    if (page > totalPages) setPage(1);
  }, [page, totalPages]);

  // List rows deliberately carry no secret, so the drawer fetches the one finding it is showing.
  const { data: findingDetail } = useQuery({
    queryKey: ['finding', open?.ga_id],
    queryFn: () => findingsApi.get(open!.ga_id as number),
    enabled: Boolean(open?.ga_id),
  });
  const detail: Finding | null = findingDetail ?? null;

  /**
   * Every drawer has an address. `?finding=F-0160` opens that row directly, and the drawer rewrites
   * it on open and clears it on close, so a link can be pasted into a chat and land on the row the
   * sender was looking at. `?finding=` accepts the ref or the numeric id, because a ref can change
   * when a finding is re-imported and an id cannot.
   */
  /** The ref is the readable handle, but a row the factory has not seen has no ref yet. */
  const linkKey = (item: ReviewItem): string =>
    item.fingerprint ? item.ref : String(item.ga_id ?? item.ref);

  const sameItem = (item: ReviewItem, value: string): boolean =>
    [item.ref, String(item.ga_id ?? ''), `#${item.ga_id ?? ''}`].includes(value);

  /**
   * The address being closed, remembered for the render between the close and the URL update.
   *
   * `setOpen(null)` is an immediate state update, but the param deletion is a router navigation,
   * which react-router runs in a transition. So one render exists where the drawer is already
   * closed and `?finding=` still names the row: the open-from-URL effect below found it and
   * reopened the drawer, which is why closing needed two clicks (outside click, Escape and the
   * X button all went through here). Ignore that address until it has actually left the URL.
   */
  const closedRef = useRef<string | null>(null);

  const openItem = useCallback((item: ReviewItem) => {
    closedRef.current = null;
    setOpen(item);
    setSearchParams((current) => {
      const params = new URLSearchParams(current);
      params.set('finding', item.fingerprint ? item.ref : String(item.ga_id ?? item.ref));
      return params;
    }, { replace: true });
  }, [setSearchParams]);

  const closeDrawer = useCallback(() => {
    closedRef.current = searchParams.get('finding');
    setOpen(null);
    setSearchParams((current) => {
      const params = new URLSearchParams(current);
      params.delete('finding');
      return params;
    }, { replace: true });
  }, [searchParams, setSearchParams]);

  const wantedRef = searchParams.get('finding');
  useEffect(() => {
    if (!wantedRef) {
      closedRef.current = null;
      return;
    }
    if (wantedRef === closedRef.current) return;
    closedRef.current = null;
    if (!review) return;
    if (open && sameItem(open, wantedRef)) return;
    const match = review.items.find((item) => sameItem(item, wantedRef));
    if (match) {
      setOpen(match);
      return;
    }
    // A row newer than the snapshot still has an address: fetch it by id and open the honest
    // empty record, rather than leaving a link that opens nothing.
    const id = Number(wantedRef.replace(/^#/, ''));
    if (!Number.isFinite(id) || id <= 0) return;
    let cancelled = false;
    findingsApi.get(id).then((finding) => {
      if (!cancelled) setOpen(drawerItem(finding));
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [wantedRef, review, open, drawerItem]);

  const findingLink = (item: ReviewItem): string =>
    `${window.location.origin}${window.location.pathname}?finding=${encodeURIComponent(linkKey(item))}`;

  const deleteMutation = useMutation({
    mutationFn: findingsApi.delete,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['findings'] });
      closeDrawer();
    },
  });

  const bulkDeleteMutation = useMutation({
    mutationFn: async (ids: number[]) => {
      await Promise.all(ids.map((id) => findingsApi.delete(id)));
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['findings'] });
      setSelected(new Set());
    },
  });

  /**
   * The submission trail, recorded on the finding itself. `reported_at` is stamped by the client so
   * the row says when it was sent, and clearing the status clears the stamp with it. The factory's
   * verdict is a different system and is not touched here.
   */
  const reportMutation = useMutation({
    mutationFn: ({ id, status }: { id: number; status: '' | 'reported' }) =>
      findingsApi.setReportState(id, status),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['findings'] });
      queryClient.invalidateQueries({ queryKey: ['finding', variables.id] });
    },
  });

  /**
   * The human's claim, recorded on the finding. The reviewer settles it; nothing here changes the
   * factory verdict, the scanner flag or the review snapshot.
   */
  const humanMutation = useMutation({
    mutationFn: ({ id, claim }: {
      id: number;
      claim: { verdict: Exclude<HumanVerdict, ''>; reason: string; note?: string } | null;
    }) => findingsApi.setHumanVerdict(id, claim),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['findings'] });
      queryClient.invalidateQueries({ queryKey: ['finding', variables.id] });
    },
  });

  const copy = async (text: string, key: string) => {
    const ok = await copyText(text);
    if (!ok) return;
    setCopied(key);
    window.setTimeout(() => setCopied((current) => (current === key ? null : current)), 1400);
  };

  // Escape closes the drawer first, then the filter panel.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (open) closeDrawer();
      else if (showFilters) setShowFilters(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, showFilters, closeDrawer]);

  // The drawer scrolls its own body; the page behind it should not move.
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  const selectBucket = (key: string | null) => {
    setBucket(key);
    const params = new URLSearchParams(searchParams);
    if (key) params.set('verdict', key);
    else params.delete('verdict');
    setSearchParams(params);
    setPage(1);
  };

  const toggleClosed = () => {
    const next = !showClosed;
    setShowClosed(next);
    const params = new URLSearchParams(searchParams);
    if (next) params.set('closed', '1');
    else params.delete('closed');
    setSearchParams(params);
    setPage(1);
  };

  const toggleLiveOnly = () => {
    const next = !liveOnly;
    setLiveOnly(next);
    const params = new URLSearchParams(searchParams);
    if (next) params.set('live', '1');
    else params.delete('live');
    setSearchParams(params);
    setPage(1);
  };

  /** Third click on a header returns the list to the order the page loaded in. */
  const applySort = (next: SortState | null) => {
    const params = new URLSearchParams(searchParams);
    writeSortParams(params, next);
    setSearchParams(params);
    setPage(1);
  };

  const toggleSort = (key: string) => applySort(nextSort(sort, key));

  const applyFilters = () => {
    // A fresh URLSearchParams would drop a non-form param, so the order is re-added here or the
    // header click silently reverts the moment any filter is applied.
    const params = new URLSearchParams();
    Object.entries(filterForm).forEach(([key, value]) => {
      if (value) params.set(key, value);
    });
    if (bucket) params.set('verdict', bucket);
    if (showClosed) params.set('closed', '1');
    writeSortParams(params, sort);
    setSearchParams(params);
    setPage(1);
    setShowFilters(false);
  };

  const clearFilters = () => {
    setFilterForm({
      type: '',
      value: '',
      email: '',
      repository: '',
      scan: '',
      validated: '',
      created_at: '',
      program: '',
    });
    setBucket(null);
    setShowClosed(false);
    setLiveOnly(false);
    setLabelFilter(null);
    setSearchParams(new URLSearchParams());
    setPage(1);
  };

  /** One label at a time, like the verdict tiles: a second click on the same chip clears it. */
  const toggleLabel = (key: string) => {
    const next = labelFilter === key ? null : key;
    setLabelFilter(next);
    const params = new URLSearchParams(searchParams);
    if (next) params.set('label', next);
    else params.delete('label');
    setSearchParams(params);
    setPage(1);
  };

  const removeFilter = (key: string) => {
    const params = new URLSearchParams(searchParams);
    params.delete(key);
    setSearchParams(params);
    setFilterForm({ ...filterForm, [key]: '' });
    setPage(1);
  };

  const toggleSelection = (id: number) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  };

  const toggleSelectPage = () => {
    const next = new Set(selected);
    const allSelected = pageRows.every((finding) => next.has(finding.id));
    pageRows.forEach((finding) => (allSelected ? next.delete(finding.id) : next.add(finding.id)));
    setSelected(next);
  };


  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-foreground sm:text-3xl">Findings</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {visible.length} shown
            {bucket || labelFilter ? ` of ${rows.length}` : ''}
            {labelFilter ? ` · labeled ${labelMeta(labelFilter).text}` : ''}
            {review ? ` · ${review.reportable} reportable` : ''}
            {review?.proven_live ? ` · ${review.proven_live} active` : ''}
            {review ? ` · evidence read ${shortDate(review.generated_at)}` : ''}
          </p>
          {!bucket && !liveOnly ? (
            <button
              type="button"
              onClick={toggleClosed}
              title="Closed rows are rejected, duplicate, already reported or paid: hidden in the default view"
              className="mt-1 inline-flex items-center gap-1 text-xs text-muted-foreground underline decoration-dotted underline-offset-2 hover:text-foreground"
            >
              {showClosed ? 'Hide settled findings' : `${hiddenClosed} settled hidden`}
            </button>
          ) : null}
          {/* Phones have no header row to click, so the same orders are offered as a select. */}
          <label className="mt-2 flex items-center gap-2 text-xs text-muted-foreground sm:hidden">
            <span className="uppercase tracking-wide">Sort</span>
            <select
              value={sort ? `${sort.key}:${sort.dir}` : ''}
              onChange={(event) => {
                const [key, dir] = event.target.value.split(':');
                applySort(key ? { key, dir: dir === 'desc' ? 'desc' : 'asc' } : null);
              }}
              className="min-h-8 rounded-md border border-input bg-background px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            >
              {SORT_OPTIONS.map((option) => (
                <option key={option.value || 'none'} value={option.value}>
                  {option.label}
                </option>
              ))}
              {sort && !SORT_OPTIONS.some((option) => option.value === `${sort.key}:${sort.dir}`) ? (
                <option value={`${sort.key}:${sort.dir}`}>{`${sort.key}, ${sort.dir}`}</option>
              ) : null}
            </select>
          </label>
        </div>
        <div className="flex flex-wrap gap-2">
          {review?.proven_live ? (
            <button
              onClick={toggleLiveOnly}
              aria-pressed={liveOnly}
              className={`inline-flex min-h-10 items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
                liveOnly
                  ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
                  : 'border-border hover:bg-accent'
              }`}
              title="Rows where the provider accepted the credential, whatever gate closed them. Closed rows are included while this is on."
            >
              <ShieldCheck className="h-4 w-4" />
              Active
              <span className="rounded-full bg-emerald-500/15 px-1.5 text-xs">{review.proven_live}</span>
            </button>
          ) : null}
          <button
            onClick={() => queryClient.invalidateQueries({ queryKey: ['findings'] })}
            className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm font-medium transition-colors hover:bg-accent"
            title="Reload findings and the review snapshot"
          >
            <RefreshCw className={`h-4 w-4 ${isFetching ? 'animate-spin' : ''}`} />
            Refresh
          </button>
          <button
            onClick={() => setShowFilters(!showFilters)}
            className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
          >
            <SlidersHorizontal className="h-4 w-4" />
            {showFilters ? 'Hide filters' : 'Filters'}
            {activeFilters.length > 0 ? (
              <span className="rounded-full bg-primary-foreground/20 px-1.5 text-xs">
                {activeFilters.length}
              </span>
            ) : null}
          </button>
        </div>
      </div>

      {/* Verdict tiles: the first question a reviewer has is what they are looking at. */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {BUCKETS.map((item) => {
          const active = bucket === item.key;
          const style = verdictMeta(item.sample);
          return (
            <button
              key={item.key}
              onClick={() => selectBucket(active ? null : item.key)}
              title={item.hint}
              className={`rounded-lg border p-3 text-left transition-colors ${
                active ? 'border-primary bg-primary/5' : 'border-border bg-card hover:bg-accent/40'
              }`}
            >
              <span className="flex items-center gap-1.5">
                <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${style.dot}`} />
                <span className={`text-[10px] font-semibold uppercase tracking-wide ${style.text}`}>
                  {item.label}
                </span>
              </span>
              <span className="mt-1 block text-2xl font-bold leading-none text-foreground">
                {bucketCounts[item.key] ?? 0}
              </span>
            </button>
          );
        })}
      </div>

      {/* Labels: the reporting situation of a row, as one clickable filter row. */}
      {review?.by_label && Object.keys(review.by_label).length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            Labels
          </span>
          {LABEL_ORDER.filter((key) => (review.by_label?.[key] ?? 0) > 0).map((key) => {
            const meta = labelMeta(key);
            const count = review.by_label?.[key] ?? 0;
            const active = labelFilter === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => toggleLabel(key)}
                aria-pressed={active}
                title={review.label_info?.[key] ?? meta.hint}
                className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors ${meta.tone} ${
                  active ? 'ring-2 ring-primary/40' : 'opacity-85 hover:opacity-100'
                }`}
              >
                {meta.text}
                <span className="rounded-full bg-black/5 px-1 text-[10px] dark:bg-white/10">{count}</span>
              </button>
            );
          })}
          {labelFilter ? (
            <button
              type="button"
              onClick={() => toggleLabel(labelFilter)}
              className="inline-flex items-center gap-1 text-[11px] text-muted-foreground underline decoration-dotted underline-offset-2 hover:text-foreground"
            >
              <X className="h-3 w-3" />
              clear label
            </button>
          ) : null}
        </div>
      ) : null}

      {/* Active filters */}
      {activeFilters.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Filters
          </span>
          {activeFilters.map(([key, value]) => (
            <span
              key={key}
              className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-2.5 py-1 text-xs text-primary"
            >
              <span className="font-medium">{key}:</span>
              <span className="max-w-[16rem] truncate">{String(value)}</span>
              <button
                onClick={() => removeFilter(key)}
                className="font-bold hover:text-primary/70"
                title={`Remove ${key} filter`}
              >
                ×
              </button>
            </span>
          ))}
          <button
            onClick={clearFilters}
            className="text-xs text-muted-foreground underline hover:text-foreground"
          >
            Clear all
          </button>
        </div>
      ) : null}

      {/* Filter panel */}
      {showFilters ? (
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {(
              [
                ['type', 'Type', 'text', 'e.g. slack, aws'],
                ['repository', 'Repository', 'text', 'owner/repo'],
                ['email', 'Email', 'text', 'user@example.com'],
                ['value', 'Value', 'text', 'search inside the secret'],
              ] as const
            ).map(([key, label, type, placeholder]) => (
              <label key={key} className="block">
                <span className="mb-1 block text-xs font-medium text-foreground">{label}</span>
                <input
                  type={type}
                  value={filterForm[key]}
                  onChange={(event) => setFilterForm({ ...filterForm, [key]: event.target.value })}
                  placeholder={placeholder}
                  className="w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-sm text-foreground placeholder-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </label>
            ))}
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-foreground">Program</span>
              <select
                value={filterForm.program}
                onChange={(event) => setFilterForm({ ...filterForm, program: event.target.value })}
                className="w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              >
                <option value="">All</option>
                {(programChoices ?? []).map((program) => (
                  <option key={program.slug} value={program.slug}>
                    {program.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-foreground">Scanner flag</span>
              <select
                value={filterForm.validated}
                onChange={(event) => setFilterForm({ ...filterForm, validated: event.target.value })}
                className="w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              >
                <option value="">All</option>
                <option value="true">Scanner verified</option>
                <option value="false">Scanner unverified</option>
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-foreground">Found on</span>
              <input
                type="date"
                value={filterForm.created_at}
                onChange={(event) => setFilterForm({ ...filterForm, created_at: event.target.value })}
                className="w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-foreground">Scan id</span>
              <input
                type="number"
                value={filterForm.scan}
                onChange={(event) => setFilterForm({ ...filterForm, scan: event.target.value })}
                placeholder="e.g. 123"
                className="w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-sm text-foreground placeholder-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </label>
          </div>
          <div className="mt-3 flex gap-2">
            <button
              onClick={applyFilters}
              className="inline-flex min-h-9 items-center rounded-lg bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90"
            >
              Apply
            </button>
            <button
              onClick={clearFilters}
              className="inline-flex min-h-9 items-center rounded-lg border border-border px-4 py-1.5 text-sm font-medium hover:bg-accent"
            >
              Clear
            </button>
          </div>
        </div>
      ) : null}

      {/* Bulk actions */}
      {selected.size > 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-card px-3 py-2">
          <span className="text-sm text-muted-foreground">{selected.size} selected</span>
          <div className="flex gap-2">
            <button
              onClick={() => setSelected(new Set())}
              className="inline-flex min-h-9 items-center rounded-lg border border-border px-3 py-1.5 text-sm font-medium hover:bg-accent"
            >
              Clear selection
            </button>
            <button
              onClick={() => {
                const count = selected.size;
                if (window.confirm(`Delete ${count} finding${count > 1 ? 's' : ''}? This cannot be undone.`)) {
                  bulkDeleteMutation.mutate(Array.from(selected));
                }
              }}
              disabled={bulkDeleteMutation.isPending}
              className="inline-flex min-h-9 items-center rounded-lg bg-destructive px-3 py-1.5 text-sm font-medium text-destructive-foreground hover:opacity-90 disabled:opacity-50"
            >
              {bulkDeleteMutation.isPending ? 'Deleting...' : `Delete ${selected.size}`}
            </button>
          </div>
        </div>
      ) : null}

      {/* Rows */}
      {isLoading ? (
        <div className="rounded-lg border border-border bg-card p-8 text-center text-sm text-muted-foreground">
          Loading findings...
        </div>
      ) : error ? (
        <div className="rounded-lg border border-border bg-card p-8 text-center text-sm text-destructive">
          Failed to load findings
        </div>
      ) : visible.length === 0 ? (
        <div className="rounded-lg border border-border bg-card p-8 text-center text-sm text-muted-foreground">
          {rows.length === 0
            ? 'No findings match these filters'
            : hiddenClosed > 0
              ? `All ${hiddenClosed} findings here are settled. Show them with the link above.`
              : 'Nothing in this bucket'}
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-border bg-card">
          {/* sm and up: fixed layout, so no column can push the page sideways */}
          <table className="hidden w-full table-fixed text-sm sm:table">
            <thead className="bg-muted/60 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="w-8 px-2 py-2">
                  <input
                    type="checkbox"
                    aria-label="Select this page"
                    checked={pageRows.length > 0 && pageRows.every((finding) => selected.has(finding.id))}
                    onChange={toggleSelectPage}
                    className="h-3.5 w-3.5 cursor-pointer rounded border-input text-primary"
                  />
                </th>
                <SortHeader
                  label="Verdict"
                  sortKey="verdict"
                  sort={sort}
                  onSort={toggleSort}
                  title="Sort by verdict: needs review first"
                  className="w-[6.5rem] px-2 py-2 font-medium"
                />
                <SortHeader
                  label="Finding"
                  sortKey="type"
                  sort={sort}
                  onSort={toggleSort}
                  title="Sort by finding type"
                  className="w-[32%] px-2 py-2 font-medium"
                />
                <SortHeader
                  label="Repository"
                  sortKey="repository"
                  sort={sort}
                  onSort={toggleSort}
                  title="Sort by repository"
                  className="hidden px-2 py-2 font-medium lg:table-cell"
                />
                <SortHeader
                  label="Likelihood"
                  sortKey="likelihood"
                  sort={sort}
                  onSort={toggleSort}
                  title="Sort by likelihood score, highest first on a second click"
                  className="hidden w-[5.5rem] px-2 py-2 font-medium md:table-cell"
                />
                <SortHeader
                  label="Found"
                  sortKey="found"
                  sort={sort}
                  onSort={toggleSort}
                  title="Sort by when the finding was first seen"
                  className="hidden w-[7.5rem] px-2 py-2 font-medium xl:table-cell"
                />
                <th className="w-6 px-1 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {pageRows.map((finding) => {
                const item = reviewOf(finding);
                const style = verdictMeta(item?.verdict ?? 'untriaged');
                const band = bandMeta(item?.likelihood.band ?? 'unknown');
                return (
                  <tr
                    key={finding.id}
                    onClick={() => openItem(drawerItem(finding))}
                    className="cursor-pointer hover:bg-muted/50"
                  >
                    <td className="px-2 py-1.5" onClick={(event) => event.stopPropagation()}>
                      <input
                        type="checkbox"
                        aria-label={`Select ${finding.id}`}
                        checked={selected.has(finding.id)}
                        onChange={() => toggleSelection(finding.id)}
                        className="h-3.5 w-3.5 cursor-pointer rounded border-input text-primary"
                      />
                    </td>
                    <td className="overflow-hidden px-2 py-1.5">
                      <span className="flex min-w-0 items-center gap-1.5" title={item?.headline}>
                        <span aria-hidden="true" className={`h-1.5 w-1.5 shrink-0 rounded-full ${style.dot}`} />
                        <span className={`truncate text-[10px] font-semibold uppercase tracking-wide ${style.text}`}>
                          {style.label}
                        </span>
                      </span>
                    </td>
                    <td className="px-2 py-1.5">
                      <span className="flex min-w-0 items-center gap-2">
                        <span className="truncate font-medium text-foreground">{finding.type}</span>
                        {item ? <ActiveBadge item={item} /> : null}
                        <CopyRef
                          className="min-w-0"
                          value={item?.ref ?? `#${finding.id}`}
                          copied={copied === `ref:${finding.id}`}
                          onCopy={() => copy(item?.ref ?? `#${finding.id}`, `ref:${finding.id}`)}
                        />
                        <ReportedBadge finding={finding} />
                        <ClaimBadge finding={finding} />
                      </span>
                    </td>
                    <td className="hidden px-2 py-1.5 lg:table-cell">
                      <span className="block truncate font-mono text-[11px] text-muted-foreground">
                        {repoLabel(finding.repository)}
                      </span>
                    </td>
                    <td className="hidden px-2 py-1.5 md:table-cell">
                      <span className={`text-[11px] font-medium ${band.text}`}>{band.label}</span>
                    </td>
                    <td className="hidden px-2 py-1.5 text-[11px] text-muted-foreground xl:table-cell">
                      <span className="block truncate whitespace-nowrap">{shortDate(finding.created_at)}</span>
                    </td>
                    <td className="px-1 py-1.5">
                      <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {/* Phones: three lines per row, no table to overflow */}
          <ul className="divide-y divide-border sm:hidden">
            {pageRows.map((finding) => {
              const item = reviewOf(finding);
              const style = verdictMeta(item?.verdict ?? 'untriaged');
              const band = bandMeta(item?.likelihood.band ?? 'unknown');
              return (
                <li key={finding.id} className="px-3 py-2.5">
                  <span className="flex items-center gap-1.5">
                    <span aria-hidden="true" className={`h-1.5 w-1.5 shrink-0 rounded-full ${style.dot}`} />
                    <span className={`text-[10px] font-semibold uppercase tracking-wide ${style.text}`}>
                      {style.label}
                    </span>
                    <CopyRef
                      className="ml-auto min-w-0"
                      value={item?.ref ?? `#${finding.id}`}
                      copied={copied === `ref:${finding.id}`}
                      onCopy={() => copy(item?.ref ?? `#${finding.id}`, `ref:${finding.id}`)}
                    />
                    <ReportedBadge finding={finding} />
                        <ClaimBadge finding={finding} />
                  </span>
                  <button onClick={() => openItem(drawerItem(finding))} className="w-full text-left">
                    <span className="mt-0.5 flex items-center gap-2">
                      <span className="truncate text-sm font-medium text-foreground">{finding.type}</span>
                      {item ? <ActiveBadge item={item} /> : null}
                    </span>
                    <span className="mt-0.5 flex items-center gap-2 text-[11px] text-muted-foreground">
                      <span className="truncate font-mono">{repoLabel(finding.repository)}</span>
                      <span className={`ml-auto shrink-0 ${band.text}`}>{band.label}</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>

          {/* Pagination */}
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-3 py-2">
            <p className="text-xs text-muted-foreground">
              {visible.length === 0
                ? '0 findings'
                : `${(page - 1) * PAGE_SIZE + 1}-${Math.min(page * PAGE_SIZE, visible.length)} of ${visible.length}`}
            </p>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage((current) => Math.max(1, current - 1))}
                disabled={page <= 1}
                className="inline-flex min-h-8 items-center rounded-lg border border-border px-2.5 py-1 text-xs font-medium hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
              >
                Previous
              </button>
              <span className="text-xs text-muted-foreground">
                {page} / {totalPages}
              </span>
              <button
                onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
                disabled={page >= totalPages}
                className="inline-flex min-h-8 items-center rounded-lg border border-border px-2.5 py-1 text-xs font-medium hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
              >
                Next
              </button>
            </div>
          </div>
        </div>
      )}

      {open ? (
        <FindingDrawer
          item={open}
          detail={detail}
          copied={copied}
          onCopy={copy}
          onClose={closeDrawer}
          link={findingLink(open)}
          onDelete={() => {
            if (window.confirm(`Delete this ${open.type} finding? This cannot be undone.`)) {
              if (open.ga_id != null) deleteMutation.mutate(open.ga_id);
            }
          }}
          deleting={deleteMutation.isPending}
          onReport={(status) => {
            if (open.ga_id != null) reportMutation.mutate({ id: open.ga_id, status });
          }}
          reporting={reportMutation.isPending}
          onHuman={(claim) => {
            if (open.ga_id != null) humanMutation.mutate({ id: open.ga_id, claim });
          }}
          humanPending={humanMutation.isPending}
        />
      ) : null}
    </div>
  );
};

/**
 * The drawer is one reading order and no folds: what it is, whether it works, why the verdict,
 * what it would cost, where it goes, what to do next.
 *
 * Two rules earn their keep. Nothing hides behind a disclosure: a reason a reviewer has to click
 * for is a reason they skip on the second pass, and every fact used to live in two folds at once
 * (the flow's "how it was tested" and the gate list carried the same sentence). One place per fact.
 * And the value is printed in full, unmasked: this panel exists so whoever has to rotate a
 * credential can copy the exact string the provider accepted. A masked value cannot be checked
 * against the scanner's own split of it, and it turns a five second look into a click.
 */
const FindingDrawer: React.FC<{
  item: ReviewItem;
  detail: Finding | null;
  copied: string | null;
  /** The shareable address of this row: `?finding=<ref>`. */
  link: string;
  onCopy: (text: string, key: string) => void;
  onClose: () => void;
  onDelete: () => void;
  deleting: boolean;
  /** Write the submission trail on this row: 'reported' stamps the date, '' clears both. */
  onReport: (status: '' | 'reported') => void;
  reporting: boolean;
  /** Record or clear this human's claim about the verdict. */
  onHuman: (claim: { verdict: Exclude<HumanVerdict, ''>; reason: string; note?: string } | null) => void;
  humanPending: boolean;
}> = ({
  item, detail, copied, link, onCopy, onClose, onDelete, deleting, onReport, reporting,
  onHuman, humanPending,
}) => {
  const recorded = (detail?.human_verdict ?? '') as HumanVerdict;
  const [claim, setClaim] = useState<Exclude<HumanVerdict, ''> | ''>(recorded);
  const [reason, setReason] = useState(detail?.human_reason ?? '');
  const [note, setNote] = useState(detail?.human_note ?? '');
  const [seededFor, setSeededFor] = useState<number | null>(detail?.id ?? null);
  // The drawer opens before the detail request lands, so the claim is seeded once, when it does.
  useEffect(() => {
    if (detail && detail.id !== seededFor) {
      setClaim((detail.human_verdict ?? '') as HumanVerdict);
      setReason(detail.human_reason ?? '');
      setNote(detail.human_note ?? '');
      setSeededFor(detail.id);
    }
  }, [detail, seededFor]);
  const style = verdictMeta(item.verdict);
  const band = bandMeta(item.likelihood.band);
  const line = githubLineUrl(item);
  const secret = detail && typeof detail.value === 'string' && detail.value ? detail.value : null;
  const length = detail?.value_length ?? (secret ? secret.length : null);
  const state = stateMeta(item);
  const scopeValue = scopeMeta(item);
  const probe = probeMeta(item);
  const hint = DETECTOR_NOTE[(item.type ?? '').trim().toLowerCase()];
  const impactGate = item.gates.find((gate) => gate.key === 'impact');
  const impactStep = item.steps?.find((step) => step.key === 'impact');
  const prove = item.steps?.find((step) => step.key === 'prove');
  const report = item.steps?.find((step) => step.key === 'report');
  const channelName = item.channel.program ?? item.channel.platform ?? null;
  const hasChannel = Boolean(
    channelName || item.channel.submit_url || item.channel.policy_url || item.channel.asset,
  );
  const location = `${item.file ?? 'unknown file'}${item.line ? `:${item.line}` : ''}`;
  // The scanner's evidence line and the probe note are usually the same sentence; print it once.
  const evidence = sameFact(item.evidence, item.probe?.note) ? null : item.evidence;
  const reported = detail?.report_status === 'reported';

  /**
   * The path, assembled from the four facts every row carries: where the value sits, what kind of
   * credential it is, what the provider answered, and what impact is written down. A reader who
   * stops after this box has the shape of the issue.
   */
  const pathSteps: PathStep[] = [
    {
      title: 'Exposed in a public repository',
      body: `${repoLabel(item.repository) ?? 'unknown repository'}${
        item.commit_hash ? ` @ ${item.commit_hash.slice(0, 7)}` : ''
      }`,
      edge: 'carries',
      tone: 'plain',
    },
    {
      title: `${item.type} credential`,
      body: `${length ?? '?'} chars, ${location.split('/').pop()}`,
      edge: item.probe?.state === 'live' || item.probe?.state === 'dead' ? 'asked' : 'no probe sent',
      tone: 'bad',
    },
    {
      title: probe.label === 'Accepted' ? 'Provider accepted it' : `Provider: ${probe.label.toLowerCase()}`,
      body: item.probe?.note || 'no identity request exists for this detector',
      edge: item.probe?.live ? 'unlocks' : 'unlocks nothing',
      tone: item.probe?.live ? 'good' : 'muted',
    },
    {
      title: 'Impact',
      body: impactMeta(item),
      tone: impactGate?.status === 'pass' ? 'plain' : 'muted',
    },
  ];

  return (
    <div className="fixed inset-0 z-50 flex" role="dialog" aria-modal="true" aria-label="Finding">
      <button
        aria-label="Close"
        onClick={onClose}
        className="hidden flex-1 cursor-default bg-black/40 sm:block"
      />
      <aside className="flex h-full w-full flex-col border-l border-border bg-card shadow-2xl sm:w-[46rem] sm:max-w-full">
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          <header className="sticky top-0 z-10 border-b border-border bg-card px-4 py-2.5">
            <div className="flex items-center gap-2">
              <span aria-hidden="true" className={`h-2 w-2 shrink-0 rounded-full ${style.dot}`} />
              <span className={`text-[11px] font-semibold uppercase tracking-wide ${style.text}`}>
                {style.label}
              </span>
              <CopyRef value={item.ref} copied={copied === 'ref'} onCopy={() => onCopy(item.ref, 'ref')} />
              <button
                type="button"
                onClick={() => onCopy(link, 'link')}
                title={link}
                className="inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                {copied === 'link' ? <Check className="h-3 w-3" /> : <Link2 className="h-3 w-3" />}
                {copied === 'link' ? 'link copied' : 'link'}
              </button>
              <button
                onClick={onClose}
                className="ml-auto rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                aria-label="Close details"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <h2 className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-lg font-bold leading-tight text-foreground">
              {item.type}
              <ActiveBadge item={item} />
              <span className="text-[11px] font-normal text-muted-foreground">
                {[
                  state.label,
                  state.label.toLowerCase() === scopeValue.toLowerCase()
                    ? null
                    : `scope ${scopeValue.toLowerCase()}`,
                  `likelihood ${band.label}`,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
            </h2>
            <a
              href={repoUrl(item.repository) ?? '#'}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-0.5 block truncate font-mono text-[11px] text-primary hover:underline"
              title={`${repoLabel(item.repository) ?? ''} ${location}`}
            >
              {repoLabel(item.repository)} · {location}
            </a>
          </header>

          <div className="px-4 pb-6">
            <p className="mt-3 text-sm font-medium leading-snug text-foreground">{item.headline}</p>
            {item.detail ? (
              <p className="mt-0.5 text-xs leading-snug text-muted-foreground">{item.detail}</p>
            ) : null}

            <AttackPath steps={pathSteps} />

            {/* The credential, in full. The note above the component says why it is not masked. */}
            <section className="mt-3 rounded-lg border border-border bg-muted/30">
              <div className="flex items-center gap-2 border-b border-border px-3 py-1">
                <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Value
                </span>
                {length != null ? (
                  <span className="text-[10px] text-muted-foreground">{length} chars</span>
                ) : null}
                <button
                  onClick={() => secret && onCopy(secret, 'value')}
                  disabled={!secret}
                  className="ml-auto inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-40"
                  aria-label="Copy value"
                >
                  {copied === 'value' ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                  {copied === 'value' ? 'copied' : 'copy'}
                </button>
              </div>
              <code className="block whitespace-pre-wrap break-all px-3 py-2 font-mono text-[12px] leading-relaxed text-foreground">
                {secret ?? (detail ? 'no value stored on this record' : 'loading value...')}
              </code>
            </section>
            {hint ? <p className="mt-1 text-[11px] leading-snug text-muted-foreground">{hint}</p> : null}

            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {item.severity ? (
                <Chip
                  label="severity"
                  value={item.severity}
                  tone={STATE_TONE.neutral}
                  title={item.severity_source_url ?? undefined}
                />
              ) : null}
              {hasChannel ? (
                <Chip
                  label="channel"
                  value={channelName ?? 'intake'}
                  tone={STATE_TONE.neutral}
                  title={item.channel.submit_url ?? undefined}
                />
              ) : null}
            </div>

            {/* The factory's evidence string is the gate or probe record as written, not a retest. */}
            {evidence ? (
              <Section title="Evidence">
                <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words rounded bg-muted px-2 py-1.5 font-mono text-[10px] leading-relaxed text-muted-foreground">
                  {evidence}
                </pre>
              </Section>
            ) : null}

            {/**
              * The decision path: each gate in the order the pipeline asked it, drawn on one rail so
              * the chain reads as cause and effect. The first gate that failed is marked and every
              * gate below it is dimmed as not reached, which is the answer to "why is this closed"
              * without a paragraph of prose.
              */}
            <Section
              title="Decision path"
              right={
                item.verdict_reason ? (
                  <code className="font-mono text-[10px] text-muted-foreground">{item.verdict_reason}</code>
                ) : undefined
              }
            >
              <ol className="mt-0.5">
                {item.gates.map((gate, index) => {
                  const firstFail = item.gates.findIndex((entry) => entry.status === 'fail');
                  // Only a skipped gate was never reached. A probe that ran while an earlier gate
                  // failed still ran, so dimming it would misreport the evidence.
                  const stopped = gate.status === 'skip';
                  return (
                    <li
                      key={gate.key}
                      className={`relative flex gap-2 pl-4 ${stopped ? 'opacity-50' : ''}`}
                      title={gate.question || undefined}
                    >
                      <span
                        aria-hidden="true"
                        className={`absolute left-[3px] top-3 h-full w-px bg-border ${
                          index === item.gates.length - 1 ? 'hidden' : ''
                        }`}
                      />
                      <span
                        aria-hidden="true"
                        className={`absolute left-0 top-1.5 h-2 w-2 rounded-full ring-2 ring-card ${DOT[gate.status]}`}
                      />
                      <div className="min-w-0 flex-1 pb-2">
                        <p className="flex flex-wrap items-baseline gap-x-1.5 text-xs">
                          <span className="font-medium text-foreground">{gate.label}</span>
                          <span className="text-[11px] text-muted-foreground">
                            {GATE_WORD[gate.status]}
                          </span>
                          {index === firstFail ? (
                            <span className="ml-auto rounded-sm bg-rose-500/10 px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-rose-700 dark:text-rose-300">
                              stopped here
                            </span>
                          ) : null}
                        </p>
                        {sameFact(gate.note, item.probe?.note) ? null : (
                          <p className="text-[11px] leading-snug text-muted-foreground">{gate.note}</p>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ol>
            </Section>

            <Section title="Impact">
              <p className="text-xs leading-snug text-foreground">
                {impactStep?.body ?? impactMeta(item)}
              </p>
              {impactGate?.note && !sameFact(impactGate.note, impactStep?.body) ? (
                <p className="text-[11px] leading-snug text-muted-foreground">{impactGate.note}</p>
              ) : null}
            </Section>

            <Section title="Report to">
              {hasChannel ? (
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                  {channelName ? <span className="font-medium text-foreground">{channelName}</span> : null}
                  {item.channel.platform ? (
                    <span className="text-muted-foreground">{item.channel.platform}</span>
                  ) : null}
                  {item.channel.asset ? (
                    <span className="font-mono text-[11px] text-muted-foreground">{item.channel.asset}</span>
                  ) : null}
                  {item.channel.submit_url ? (
                    <a
                      href={item.channel.submit_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary hover:underline"
                      title={item.channel.submit_url}
                    >
                      submit form
                    </a>
                  ) : null}
                  {item.channel.policy_url ? (
                    <a
                      href={item.channel.policy_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary hover:underline"
                      title={item.channel.policy_url}
                    >
                      policy
                    </a>
                  ) : null}
                </div>
              ) : report?.body ? null : (
                <p className="text-xs text-muted-foreground">
                  No submission channel is recorded for this asset.
                </p>
              )}
              <p className="text-[11px] leading-snug text-muted-foreground">
                {item.program ? (
                  <>
                    {item.program.name}
                    {item.program.platform ? ` on ${item.program.platform}` : ''}
                    {item.program.offers_bounty ? ', pays a bounty' : ', VDP, no bounty'}
                    {item.program.read_on ? `, read ${item.program.read_on}` : ''}
                    {item.program.policy ? (
                      <>
                        {' · '}
                        <a
                          href={item.program.policy}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-primary hover:underline"
                        >
                          policy
                        </a>
                      </>
                    ) : null}
                    {item.program.contact ? (
                      <>
                        {' · '}
                        <a
                          href={`mailto:${item.program.contact}`}
                          className="text-primary hover:underline"
                        >
                          {item.program.contact}
                        </a>
                      </>
                    ) : null}
                  </>
                ) : (
                  'No program record exists for this domain.'
                )}
              </p>
              {report?.body ? (
                <p className="text-[11px] leading-snug text-muted-foreground">{report.body}</p>
              ) : null}
            </Section>

            <Section title="Your read">
              {recorded ? (
                <>
                  <p className="text-xs leading-snug text-foreground">
                    {claimLabel(recorded, detail?.human_reason)}
                  </p>
                  {detail?.human_note ? (
                    <p className="text-[11px] leading-snug text-muted-foreground">{detail.human_note}</p>
                  ) : null}
                  <p className="text-[11px] text-muted-foreground">
                    Recorded{detail?.human_at ? ` ${shortDate(detail.human_at)}` : ''}. The reviewer settles
                    it against the evidence; this does not change the verdict.
                  </p>
                </>
              ) : (
                <p className="text-xs leading-snug text-muted-foreground">
                  Say which question this verdict got wrong. It is a claim the reviewer checks, not a
                  verdict of its own.
                </p>
              )}
              <div className="mt-2 flex flex-wrap gap-1.5">
                {HUMAN_CLAIMS.map((entry) => (
                  <button
                    key={entry.key}
                    onClick={() => {
                      setClaim(entry.key);
                      setReason('');
                    }}
                    className={`inline-flex min-h-8 items-center rounded-lg border px-2.5 py-1 text-[11px] font-medium ${
                      claim === entry.key ? entry.tone : 'border-border text-muted-foreground hover:bg-accent'
                    }`}
                  >
                    {entry.label}
                  </button>
                ))}
              </div>
              {claim ? (
                <div className="mt-2 space-y-1.5">
                  <select
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                    className="w-full rounded-lg border border-border bg-background px-2 py-1.5 text-xs"
                  >
                    <option value="">Pick the reason</option>
                    {HUMAN_CLAIMS.find((entry) => entry.key === claim)?.reasons.map((entry) => (
                      <option key={entry.key} value={entry.key}>{entry.label}</option>
                    ))}
                  </select>
                  <input
                    value={note}
                    onChange={(event) => setNote(event.target.value)}
                    maxLength={512}
                    placeholder="One line a reviewer can check (optional)"
                    className="w-full rounded-lg border border-border bg-background px-2 py-1.5 text-xs"
                  />
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => onHuman({ verdict: claim, reason, note })}
                      disabled={!reason || humanPending || item.ga_id == null}
                      className="inline-flex min-h-8 items-center rounded-lg bg-primary px-3 py-1 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
                    >
                      {humanPending ? 'Saving...' : recorded ? 'Update claim' : 'Record claim'}
                    </button>
                    {recorded ? (
                      <button
                        onClick={() => {
                          setClaim('');
                          setReason('');
                          setNote('');
                          onHuman(null);
                        }}
                        disabled={humanPending}
                        className="inline-flex min-h-8 items-center rounded-lg border border-border px-3 py-1 text-xs font-medium hover:bg-accent disabled:opacity-50"
                      >
                        Clear
                      </button>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </Section>

            <Section title="Next">
              <p className="text-xs leading-snug text-foreground">{item.action}</p>
              {prove?.body ? (
                <p className="text-[11px] leading-snug text-muted-foreground">{prove.body}</p>
              ) : null}
              {item.command ? (
                <CodeLine label="command" name="command" value={item.command} copied={copied} onCopy={onCopy} />
              ) : null}
              {item.override ? (
                <CodeLine label="override" name="override" value={item.override} copied={copied} onCopy={onCopy} />
              ) : null}
            </Section>

            <Section
              title="Where it lives"
              right={
                line ? (
                  <a
                    href={line}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-[10px] text-primary hover:underline"
                    title={line}
                  >
                    source line <ExternalLink className="h-2.5 w-2.5" />
                  </a>
                ) : undefined
              }
            >
              <dl className="grid grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-2">
                <Field label="File" className="sm:col-span-2">
                  <span className="break-all font-mono text-[11px]">{location}</span>
                </Field>
                <Field label="Commit">
                  {item.commit_hash ? (
                    item.commit_url ? (
                      <a
                        href={item.commit_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-mono text-[11px] text-primary hover:underline"
                        title={item.commit_url}
                      >
                        {item.commit_hash.slice(0, 7)}
                      </a>
                    ) : (
                      <span className="font-mono text-[11px]">{item.commit_hash.slice(0, 7)}</span>
                    )
                  ) : (
                    '-'
                  )}
                </Field>
                <Field label="Author">{item.email ?? '-'}</Field>
                <Field label="Org">
                  {item.org ?? '-'}
                  {item.domain ? ` · ${item.domain}` : ''}
                </Field>
                <Field label="Classes">
                  {item.repo_class} · {item.path_class}
                </Field>
                <Field label="Seen">
                  {shortDate(item.first_seen)} to {shortDate(item.last_seen)}
                </Field>
              </dl>
            </Section>
          </div>
        </div>

        <footer className="flex flex-wrap items-center gap-2 border-t border-border px-4 py-2.5">
          <button
            onClick={onDelete}
            disabled={deleting || item.ga_id == null}
            className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-destructive/40 px-3 py-1.5 text-sm font-medium text-destructive hover:bg-destructive/10 disabled:opacity-50"
          >
            <Trash2 className="h-3.5 w-3.5" />
            {deleting ? 'Deleting...' : 'Delete'}
          </button>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            {reported ? (
              <>
                <span className="text-[11px] text-muted-foreground">
                  Reported{detail?.reported_at ? ` ${shortDate(detail.reported_at)}` : ''}
                </span>
                <button
                  onClick={() => onReport('')}
                  disabled={reporting}
                  className="inline-flex min-h-9 items-center rounded-lg border border-border px-3 py-1.5 text-sm font-medium hover:bg-accent disabled:opacity-50"
                >
                  {reporting ? 'Saving...' : 'Undo'}
                </button>
              </>
            ) : (
              <button
                onClick={() => onReport('reported')}
                disabled={reporting || item.ga_id == null}
                title="Record that this finding was submitted. It does not change the pipeline verdict."
                className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-1.5 text-sm font-medium text-emerald-700 hover:bg-emerald-500/15 disabled:opacity-50 dark:text-emerald-300"
              >
                <Flag className="h-3.5 w-3.5" />
                {reporting ? 'Saving...' : 'Mark reported'}
              </button>
            )}
            <button
              onClick={onClose}
              className="inline-flex min-h-9 items-center rounded-lg bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90"
            >
              Close
            </button>
          </div>
        </footer>
      </aside>
    </div>
  );
};

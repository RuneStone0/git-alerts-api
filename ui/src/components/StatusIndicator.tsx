/**
 * Compact status indicator: a 6px dot plus a 10px uppercase label.
 *
 * Replaces the status pills (px-2 py-1 text-xs rounded-full) that were previously dropped into a
 * wrapping flex row: because that row contained variable-width siblings, the pill landed in a
 * different place on every card. This renders at a fixed height on one line, so as long as callers
 * put it first in a row it always appears in the same spot.
 */
export type StatusTone = 'success' | 'warning' | 'danger' | 'info' | 'neutral';

const DOT: Record<StatusTone, string> = {
  success: 'bg-green-500 dark:bg-green-400',
  warning: 'bg-amber-500 dark:bg-amber-400',
  danger: 'bg-red-500 dark:bg-red-400',
  info: 'bg-blue-500 dark:bg-blue-400',
  neutral: 'bg-muted-foreground/60',
};

const TEXT: Record<StatusTone, string> = {
  success: 'text-green-700 dark:text-green-400',
  warning: 'text-amber-700 dark:text-amber-400',
  danger: 'text-red-700 dark:text-red-400',
  info: 'text-blue-700 dark:text-blue-400',
  neutral: 'text-muted-foreground',
};

export function scanStatusTone(status: string): StatusTone {
  switch (status) {
    case 'completed':
      return 'success';
    case 'in_progress':
      return 'warning';
    case 'queued':
      return 'info';
    case 'failed':
      return 'danger';
    default:
      return 'neutral';
  }
}

export function scanStatusLabel(status: string): string {
  return status.replace(/_/g, ' ');
}

export function validatedTone(validated: boolean): StatusTone {
  return validated ? 'success' : 'warning';
}

export function validatedLabel(validated: boolean): string {
  return validated ? 'validated' : 'unvalidated';
}

export function StatusIndicator({
  tone,
  label,
  className = '',
}: {
  tone: StatusTone;
  label: string;
  className?: string;
}) {
  return (
    <span className={`inline-flex h-5 shrink-0 items-center gap-1.5 ${className}`}>
      <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${DOT[tone]}`} />
      <span
        className={`text-[10px] font-semibold uppercase leading-none tracking-wide ${TEXT[tone]}`}
      >
        {label}
      </span>
    </span>
  );
}

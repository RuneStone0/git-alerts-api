import React from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
import type { SortState } from '@/lib/table-sort';

/**
 * A table head cell that sorts its column when clicked.
 *
 * It renders the `<th>` itself so the page keeps its own width and padding classes, and it carries
 * `aria-sort` so the state is announced instead of being a colour cue only. The button fills the
 * cell, which gives the whole header a click target rather than just the label text.
 */
export const SortHeader: React.FC<{
  label: React.ReactNode;
  sortKey: string;
  sort: SortState | null;
  onSort: (key: string) => void;
  className?: string;
  /** What this column's order means in practice, e.g. "needs review first". */
  title?: string;
  align?: 'left' | 'right';
}> = ({ label, sortKey, sort, onSort, className, title, align = 'left' }) => {
  const active = sort?.key === sortKey;
  const dir = active ? sort?.dir : null;
  const Icon = dir === 'asc' ? ArrowUp : dir === 'desc' ? ArrowDown : ArrowUpDown;
  return (
    <th
      scope="col"
      aria-sort={dir === 'asc' ? 'ascending' : dir === 'desc' ? 'descending' : 'none'}
      className={className}
    >
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        title={title ?? `Sort by ${typeof label === 'string' ? label.toLowerCase() : sortKey}`}
        className={`inline-flex w-full items-center gap-1 rounded hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
          align === 'right' ? 'justify-end' : 'text-left'
        } ${active ? 'text-foreground' : ''}`}
      >
        <span className="truncate">{label}</span>
        <Icon
          aria-hidden="true"
          className={`h-3 w-3 shrink-0 ${active ? 'opacity-100' : 'opacity-40'}`}
        />
      </button>
    </th>
  );
};

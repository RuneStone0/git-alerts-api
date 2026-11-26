/**
 * Column sorting for the dashboards' tables.
 *
 * Every table that sorts in the browser already holds its whole result set (findings fetch one page
 * of 500 and filter it locally, the triage snapshot arrives in one document), so ordering is a pure
 * function of the array rather than a second request. A server-paginated table cannot use this
 * honestly: sorting page 1 of 40 gives the top of a page, not the top of the list, so those tables
 * need the API's `ordering` parameter instead.
 */

export type SortDirection = 'asc' | 'desc';

export interface SortState {
  key: string;
  dir: SortDirection;
}

/** What one row exposes for one column: a primitive to compare, or nothing. */
export type SortValue = string | number | boolean | null | undefined;

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

const isBlank = (value: SortValue): boolean => value === null || value === undefined || value === '';

/**
 * Ascending, then the direction flips it. Blanks stay last in both directions: a row with no
 * likelihood score or no date is not "smallest", it is missing, and parking it at the bottom keeps
 * the first screen full of rows that actually carry a value.
 */
export const compareValues = (a: SortValue, b: SortValue, dir: SortDirection = 'asc'): number => {
  const aBlank = isBlank(a);
  const bBlank = isBlank(b);
  if (aBlank || bBlank) {
    if (aBlank && bBlank) return 0;
    return aBlank ? 1 : -1;
  }
  let result: number;
  if (typeof a === 'number' && typeof b === 'number') result = a - b;
  else if (typeof a === 'boolean' && typeof b === 'boolean') result = Number(a) - Number(b);
  else result = collator.compare(String(a), String(b));
  return dir === 'asc' ? result : -result;
};

/**
 * One column at a time: first click ascending, second descending, third back to the order the page
 * was served in. The third state is worth keeping, because "as loaded" is not any column's order
 * (findings arrive newest first, and the page then groups them by bucket).
 */
export const nextSort = (current: SortState | null, key: string): SortState | null => {
  if (!current || current.key !== key) return { key, dir: 'asc' };
  if (current.dir === 'asc') return { key, dir: 'desc' };
  return null;
};

/**
 * Stable: rows with equal values keep the incoming order, so re-sorting never shuffles unrelated
 * rows and re-rendering never makes the list jump.
 */
export const sortRows = <T,>(
  rows: T[],
  sort: SortState | null,
  select: (row: T, key: string) => SortValue,
): T[] => {
  if (!sort) return rows;
  return rows
    .map((row, index) => ({ row, index, value: select(row, sort.key) }))
    .sort((a, b) => compareValues(a.value, b.value, sort.dir) || a.index - b.index)
    .map((entry) => entry.row);
};

/** `sort` and `dir` are the URL names, so a shared link shows the order the sender saw. */
export const readSortParam = (params: URLSearchParams): SortState | null => {
  const key = params.get('sort');
  if (!key) return null;
  return { key, dir: params.get('dir') === 'desc' ? 'desc' : 'asc' };
};

export const writeSortParams = (params: URLSearchParams, sort: SortState | null): void => {
  if (sort) {
    params.set('sort', sort.key);
    params.set('dir', sort.dir);
  } else {
    params.delete('sort');
    params.delete('dir');
  }
};

import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { programsApi } from '@/services/api';
import type { CreateProgramRequest, ProgramSource } from '@/types';

// Programs are the durable home for one initiative: the scope record, the channel, and (via the
// program FK on scans and findings) everything produced against it. The crawler finds most of
// these on its own; `manual` exists because a program that publishes a policy the crawler never
// saw still has to be storable, which is exactly what happened with Zillow.

const emptyForm: CreateProgramRequest = {
  slug: '',
  name: '',
  domain: '',
  policy_url: '',
  channel_contact: '',
  channel_url: '',
  scope_note: '',
  scope_read_on: '',
  payout_note: '',
  source: 'manual',
};

const apiError = (error: unknown): string => {
  const data = (error as { response?: { data?: unknown } })?.response?.data;
  if (typeof data === 'string') return data;
  if (data && typeof data === 'object') {
    return Object.entries(data as Record<string, unknown>)
      .map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join(', ') : String(value)}`)
      .join('; ');
  }
  return 'Request failed';
};

const inputClass =
  'w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none';
const labelClass = 'mb-1 block text-sm font-medium text-foreground';

const SourceBadge: React.FC<{ source: ProgramSource }> = ({ source }) => (
  <span
    className={
      source === 'manual'
        ? 'rounded-full border border-primary/40 bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary'
        : 'rounded-full border border-border bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground'
    }
  >
    {source}
  </span>
);

export const Programs: React.FC = () => {
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<CreateProgramRequest>(emptyForm);
  const [formError, setFormError] = useState<string | null>(null);

  const { data: programs, isLoading, error } = useQuery({
    queryKey: ['programs'],
    queryFn: () => programsApi.list(),
  });

  const createMutation = useMutation({
    mutationFn: (payload: CreateProgramRequest) => programsApi.create(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['programs'] });
      setForm(emptyForm);
      setShowForm(false);
      setFormError(null);
    },
    onError: (err) => setFormError(apiError(err)),
  });

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    setFormError(null);
    if (!form.slug.trim() || !form.name.trim()) {
      setFormError('slug and name are required');
      return;
    }
    // Blank optional fields are sent as undefined, not "": the serializer validates URL and date
    // fields, and an empty string is not an acceptable value for either.
    const filled = (value?: string): string | undefined => {
      const trimmed = value?.trim();
      return trimmed ? trimmed : undefined;
    };
    const payload: CreateProgramRequest = {
      slug: form.slug.trim(),
      name: form.name.trim(),
      source: form.source,
      domain: filled(form.domain),
      policy_url: filled(form.policy_url),
      channel_contact: filled(form.channel_contact),
      channel_url: filled(form.channel_url),
      scope_note: filled(form.scope_note),
      scope_read_on: filled(form.scope_read_on),
      payout_note: filled(form.payout_note),
    };
    createMutation.mutate(payload);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Programs</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            One record per initiative: scope, channel, and everything scanned against it.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowForm((open) => !open)}
          className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
        >
          <Plus className="h-4 w-4" />
          {showForm ? 'Close' : 'New program'}
        </button>
      </div>

      {showForm && (
        <form onSubmit={submit} className="space-y-4 rounded-lg border border-border bg-card p-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className={labelClass} htmlFor="slug">Slug</label>
              <input
                id="slug"
                className={inputClass}
                value={form.slug}
                onChange={(e) => setForm({ ...form, slug: e.target.value })}
                placeholder="zillow"
              />
            </div>
            <div>
              <label className={labelClass} htmlFor="name">Name</label>
              <input
                id="name"
                className={inputClass}
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Zillow Group"
              />
            </div>
            <div>
              <label className={labelClass} htmlFor="domain">Domain</label>
              <input
                id="domain"
                className={inputClass}
                value={form.domain}
                onChange={(e) => setForm({ ...form, domain: e.target.value })}
                placeholder="zillow.com"
              />
            </div>
            <div>
              <label className={labelClass} htmlFor="source">Source</label>
              <select
                id="source"
                className={inputClass}
                value={form.source}
                onChange={(e) => setForm({ ...form, source: e.target.value as ProgramSource })}
              >
                <option value="manual">manual</option>
                <option value="crawler">crawler</option>
              </select>
            </div>
            <div>
              <label className={labelClass} htmlFor="policy_url">Policy URL</label>
              <input
                id="policy_url"
                className={inputClass}
                value={form.policy_url}
                onChange={(e) => setForm({ ...form, policy_url: e.target.value })}
                placeholder="https://example.com/security"
              />
            </div>
            <div>
              <label className={labelClass} htmlFor="channel_contact">Channel contact</label>
              <input
                id="channel_contact"
                className={inputClass}
                value={form.channel_contact}
                onChange={(e) => setForm({ ...form, channel_contact: e.target.value })}
                placeholder="security@example.com"
              />
            </div>
            <div>
              <label className={labelClass} htmlFor="channel_url">Channel URL</label>
              <input
                id="channel_url"
                className={inputClass}
                value={form.channel_url}
                onChange={(e) => setForm({ ...form, channel_url: e.target.value })}
                placeholder="https://hackerone.com/example"
              />
            </div>
            <div>
              <label className={labelClass} htmlFor="scope_read_on">Scope read on</label>
              <input
                id="scope_read_on"
                type="date"
                className={inputClass}
                value={form.scope_read_on}
                onChange={(e) => setForm({ ...form, scope_read_on: e.target.value })}
              />
            </div>
          </div>
          <div>
            <label className={labelClass} htmlFor="scope_note">Scope note</label>
            <textarea
              id="scope_note"
              rows={4}
              className={inputClass}
              value={form.scope_note}
              onChange={(e) => setForm({ ...form, scope_note: e.target.value })}
              placeholder="Quote the program's own rules and note anything that constrains testing."
            />
          </div>
          <div>
            <label className={labelClass} htmlFor="payout_note">Payout note</label>
            <input
              id="payout_note"
              className={inputClass}
              value={form.payout_note}
              onChange={(e) => setForm({ ...form, payout_note: e.target.value })}
              placeholder="No published payout table."
            />
          </div>
          {formError && <p className="text-sm text-red-500">{formError}</p>}
          <button
            type="submit"
            disabled={createMutation.isPending}
            className="inline-flex rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            {createMutation.isPending ? 'Saving...' : 'Create program'}
          </button>
        </form>
      )}

      {isLoading ? (
        <div className="rounded-lg border border-border bg-card p-8 text-center">
          <p className="text-muted-foreground">Loading...</p>
        </div>
      ) : error ? (
        <div className="rounded-lg border border-border bg-card p-8 text-center">
          <p className="text-red-500">{apiError(error)}</p>
        </div>
      ) : !programs || programs.length === 0 ? (
        <div className="rounded-lg border border-border bg-card p-8 text-center">
          <p className="text-muted-foreground">No programs yet</p>
          <p className="mt-2 text-sm text-muted-foreground">
            Create one for the initiative you are working, or let the crawler fill the list.
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-border bg-card">
          <div className="divide-y divide-border">
            {programs.map((program) => (
              <Link
                key={program.id}
                to={`/programs/${program.slug}`}
                className="block p-4 transition-colors hover:bg-muted/50"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium text-foreground">{program.name}</span>
                      <SourceBadge source={program.source} />
                    </div>
                    <p className="mt-1 truncate text-sm text-muted-foreground">
                      {program.slug}
                      {program.domain ? ` · ${program.domain}` : ''}
                    </p>
                  </div>
                  <div className="text-right text-xs text-muted-foreground">
                    {program.scope_read_on ? `scope read ${program.scope_read_on}` : 'no scope date'}
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

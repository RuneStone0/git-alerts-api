// API Response Types
export interface PaginatedResponse<T> {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
}

// Auth Types
export interface LoginCredentials {
  username: string;
  password: string;
}

export interface TokenResponse {
  access: string;
  refresh: string;
}

export interface User {
  id: number;
  username: string;
  email: string;
}

// Scan Types
export type ScanType =
  | 'org_repos'
  | 'org_users'
  | 'search_code'
  | 'search_commits'
  | 'search_issues'
  | 'search_repos'
  | 'search_users';

export type ScanStatus = 'queued' | 'in_progress' | 'completed' | 'failed';

export interface Scan {
  id: number;
  user: string; // username, not user id
  type: ScanType;
  value: string;
  status: ScanStatus;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  total_repositories: number;
  total_findings: number;
  ignored_repositories: number;
  ignored_findings: number;
  scanned_repositories: number;
  error_message?: string;
  /** Program id, null when the scan belongs to no initiative yet. */
  program: number | null;
  program_slug: string | null;
}

export interface CreateScanRequest {
  type: ScanType;
  value: string;
}

// Finding Types
export interface Finding {
  id: number;
  scan: number;
  repository: string;
  type: string;
  /** Only present on the detail endpoint; list rows expose value_length instead. */
  value?: string;
  value_length?: number;
  description: string;
  file: string;
  line: number | null;
  email: string;
  commit_hash: string;
  commit_url: string | null;
  validated: boolean;
  created_at: string;
  updated_at: string;
  /** Program id, null when the finding belongs to no initiative yet. */
  program: number | null;
  program_slug: string | null;
  /**
   * GitAlerts' own submission trail, separate from the scanner flag and from the factory verdict:
   * what a human did with this row after reading it.
   */
  report_status?: '' | 'reported';
  reported_at?: string | null;
}

// Program (project) Types
export type ProgramSource = 'crawler' | 'manual';

export interface Program {
  id: number;
  slug: string;
  name: string;
  domain: string;
  policy_url: string;
  channel_contact: string;
  channel_url: string;
  scope_note: string;
  scope_read_on: string | null;
  payout_note: string;
  source: ProgramSource;
  created_at: string;
  updated_at: string;
}

export interface CreateProgramRequest {
  slug: string;
  name: string;
  domain?: string;
  policy_url?: string;
  channel_contact?: string;
  channel_url?: string;
  scope_note?: string;
  scope_read_on?: string;
  payout_note?: string;
  source?: ProgramSource;
}

// Ignore Types
export interface IgnoreFindingType {
  id: number;
  type: string;
  created_at: string;
}

export interface IgnoreFindingDomain {
  id: number;
  domain: string;
  created_at: string;
}

export interface CreateIgnoreTypeRequest {
  type: string;
}

export interface CreateIgnoreDomainRequest {
  domain: string;
}

// Integration Types
export type IntegrationType = 'github' | 'slack';
export type IntegrationStatus = 'connected' | 'disconnected' | 'pending' | 'failed';

export interface UserIntegration {
  id: number;
  user: string;
  provider: IntegrationType;
  status: IntegrationStatus;
  last_validated_at: string | null;
  error_message: string;
  created_at: string;
  updated_at: string;
}

export interface CreateIntegrationRequest {
  provider: IntegrationType;
  token: string;
}

// System Settings Types
export interface SystemSettings {
  id: number;
  skip_recent_days: number;
  verified_only: boolean;
  org_repos_only: boolean;
  updated_at: string;
}

export interface UpdateSystemSettingsRequest {
  skip_recent_days?: number;
  verified_only?: boolean;
  org_repos_only?: boolean;
}

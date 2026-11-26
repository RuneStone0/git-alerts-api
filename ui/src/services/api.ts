import apiClient from '@/lib/api-client';
import type {
  LoginCredentials,
  TokenResponse,
  Scan,
  CreateScanRequest,
  Finding,
  PaginatedResponse,
  IgnoreFindingType,
  IgnoreFindingDomain,
  CreateIgnoreTypeRequest,
  CreateIgnoreDomainRequest,
  UserIntegration,
  CreateIntegrationRequest,
  SystemSettings,
  UpdateSystemSettingsRequest,
  Program,
  CreateProgramRequest,
} from '@/types';

export interface InstanceConfig {
  auth_mode: 'login' | 'open';
  local_user: { id: number; username: string; email: string } | null;
}

// Public bootstrap config: tells the UI whether this deployment has a login at all
export const configApi = {
  get: async (): Promise<InstanceConfig> => {
    const response = await apiClient.get<InstanceConfig>('/api/config/');
    return response.data;
  },
};

// Auth API
export const authApi = {
  login: async (credentials: LoginCredentials): Promise<TokenResponse> => {
    const response = await apiClient.post<TokenResponse>('/api/token/', credentials);
    return response.data;
  },

  refreshToken: async (refresh: string): Promise<{ access: string }> => {
    const response = await apiClient.post<{ access: string }>('/api/token/refresh/', { refresh });
    return response.data;
  },
};

// Scans API
export const scansApi = {
  list: async (params?: {
    type?: string;
    value?: string;
    status?: string;
    program?: string;
    created_at?: string;
    completed_at?: string;
    page?: number;
    page_size?: number;
  }): Promise<PaginatedResponse<Scan>> => {
    const queryParams = new URLSearchParams();
    if (params?.type) queryParams.append('type', params.type);
    if (params?.value) queryParams.append('value', params.value);
    if (params?.status) queryParams.append('status', params.status);
    if (params?.program) queryParams.append('program', params.program);
    if (params?.created_at) queryParams.append('created_at', params.created_at);
    if (params?.completed_at) queryParams.append('completed_at', params.completed_at);
    if (params?.page !== undefined) queryParams.append('page', String(params.page));
    if (params?.page_size !== undefined) queryParams.append('page_size', String(params.page_size));

    const response = await apiClient.get<PaginatedResponse<Scan>>(
      `/scans/?${queryParams.toString()}`
    );
    return response.data;
  },

  get: async (id: number): Promise<Scan> => {
    const response = await apiClient.get<Scan>(`/scans/${id}/`);
    return response.data;
  },

  create: async (data: CreateScanRequest): Promise<Scan> => {
    const response = await apiClient.post<Scan>('/scans/', data);
    return response.data;
  },

  delete: async (id: number): Promise<void> => {
    await apiClient.delete(`/scans/${id}/`);
  },

  getFindings: async (scanId: number, page = 1): Promise<PaginatedResponse<Finding>> => {
    const response = await apiClient.get<PaginatedResponse<Finding>>(
      `/scans/${scanId}/findings/?page=${page}`
    );
    return response.data;
  },
};

// Findings API
export const findingsApi = {
  list: async (params?: {
    type?: string;
    value?: string;
    email?: string;
    repository?: string;
    scan?: number;
    validated?: boolean;
    program?: string;
    created_at?: string;
    page?: number;
    page_size?: number;
  }): Promise<PaginatedResponse<Finding>> => {
    const queryParams = new URLSearchParams();
    if (params?.type) queryParams.append('type', params.type);
    if (params?.value) queryParams.append('value', params.value);
    if (params?.email) queryParams.append('email', params.email);
    if (params?.repository) queryParams.append('repository', params.repository);
    if (params?.scan) queryParams.append('scan', params.scan.toString());
    if (params?.program) queryParams.append('program', params.program);
    if (params?.validated !== undefined) queryParams.append('validated', params.validated.toString());
    if (params?.created_at) queryParams.append('created_at', params.created_at);
    if (params?.page !== undefined) queryParams.append('page', String(params.page));
    if (params?.page_size !== undefined) queryParams.append('page_size', String(params.page_size));

    const response = await apiClient.get<PaginatedResponse<Finding>>(
      `/findings/?${queryParams.toString()}`
    );
    return response.data;
  },

  get: async (id: number): Promise<Finding> => {
    const response = await apiClient.get<Finding>(`/findings/${id}/`);
    return response.data;
  },

  update: async (id: number, data: Partial<Finding>): Promise<Finding> => {
    const response = await apiClient.patch<Finding>(`/findings/${id}/`, data);
    return response.data;
  },

  /**
   * Record that the finding was submitted, or clear that record. `reported_at` is sent with the
   * status so the two can never disagree: a row marked reported always carries its date, and an
   * undone row carries none.
   */
  setReportState: async (id: number, status: '' | 'reported'): Promise<Finding> => {
    const response = await apiClient.patch<Finding>(`/findings/${id}/`, {
      report_status: status,
      reported_at: status ? new Date().toISOString() : null,
    });
    return response.data;
  },

  delete: async (id: number): Promise<void> => {
    await apiClient.delete(`/findings/${id}/`);
  },
};

// Programs API. /programs/ answers a bare list (no pagination wrapper).
export const programsApi = {
  list: async (): Promise<Program[]> => {
    const response = await apiClient.get<Program[]>('/programs/');
    return response.data;
  },

  get: async (slug: string): Promise<Program> => {
    const response = await apiClient.get<Program>(`/programs/${slug}/`);
    return response.data;
  },

  create: async (data: CreateProgramRequest): Promise<Program> => {
    const response = await apiClient.post<Program>('/programs/', data);
    return response.data;
  },

  update: async (slug: string, data: Partial<CreateProgramRequest>): Promise<Program> => {
    const response = await apiClient.patch<Program>(`/programs/${slug}/`, data);
    return response.data;
  },
};

// Ignore Rules API
export const ignoreRulesApi = {
  // Finding Types
  listTypes: async (): Promise<IgnoreFindingType[]> => {
    const response = await apiClient.get<IgnoreFindingType[]>('/finding-ignores/types/');
    return response.data;
  },

  createType: async (data: CreateIgnoreTypeRequest): Promise<IgnoreFindingType> => {
    const response = await apiClient.post<IgnoreFindingType>('/finding-ignores/types/', data);
    return response.data;
  },

  deleteType: async (id: number): Promise<void> => {
    await apiClient.delete(`/finding-ignores/types/${id}`);
  },

  // Finding Domains
  listDomains: async (): Promise<IgnoreFindingDomain[]> => {
    const response = await apiClient.get<IgnoreFindingDomain[]>('/finding-ignores/domains/');
    return response.data;
  },

  createDomain: async (data: CreateIgnoreDomainRequest): Promise<IgnoreFindingDomain> => {
    const response = await apiClient.post<IgnoreFindingDomain>('/finding-ignores/domains/', data);
    return response.data;
  },

  deleteDomain: async (id: number): Promise<void> => {
    await apiClient.delete(`/finding-ignores/domains/${id}`);
  },
};

// Integrations API
export const integrationsApi = {
  list: async (): Promise<UserIntegration[]> => {
    const response = await apiClient.get<UserIntegration[]>('/integrations/');
    return response.data;
  },

  create: async (data: CreateIntegrationRequest): Promise<UserIntegration> => {
    const response = await apiClient.post<UserIntegration>('/integrations/', data);
    return response.data;
  },

  validate: async (id: number): Promise<{ message: string; integration_id: number; provider: string; status: string }> => {
    const response = await apiClient.post(`/integrations/${id}/validate/`);
    return response.data;
  },
};

// Settings API
export const settingsApi = {
  get: async (): Promise<SystemSettings> => {
    const response = await apiClient.get<SystemSettings>('/settings/');
    return response.data;
  },

  update: async (data: UpdateSystemSettingsRequest): Promise<SystemSettings> => {
    const response = await apiClient.patch<SystemSettings>('/settings/', data);
    return response.data;
  },
};
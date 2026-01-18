const API_BASE_URL = 'http://127.0.0.1:8000';

class ApiClient {
  private baseUrl: string;

  constructor(baseUrl: string = API_BASE_URL) {
    this.baseUrl = baseUrl;
  }

  private async request<T>(path: string, options?: RequestInit): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options?.headers,
      },
    });

    if (!response.ok) {
      throw new Error(`API error: ${response.status} ${response.statusText}`);
    }

    return response.json();
  }

  // Health
  health = {
    check: () => this.request<{ status: string }>('/health'),
    ready: () =>
      this.request<{
        status: string;
        services: Record<string, string>;
      }>('/health/ready'),
  };

  // Root info
  info = () =>
    this.request<{
      name: string;
      version: string;
      mode: string;
    }>('/');
}

export const api = new ApiClient();

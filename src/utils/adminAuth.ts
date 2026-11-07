// Helper to retrieve Admin Bearer / x-admin-token authentication headers
export function getAdminToken(): string | null {
  if (typeof window === 'undefined') return null;
  return sessionStorage.getItem('ielts_admin_token') || localStorage.getItem('ielts_admin_token');
}

export function getAdminAuthHeaders(): Record<string, string> {
  const token = getAdminToken();
  if (!token) return {};
  return {
    Authorization: `Bearer ${token}`,
    'x-admin-token': token
  };
}

export function getAuthenticatedFileUrl(url: string | undefined | null): string {
  if (!url) return '';
  if (url.startsWith('/api/files/')) {
    const token = getAdminToken();
    if (token) {
      const sep = url.includes('?') ? '&' : '?';
      return `${url}${sep}token=${encodeURIComponent(token)}`;
    }
  }
  return url;
}

// The only place the website talks to the server. Same JSON API the Android app uses.
export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export async function api(method, path, body) {
  let res;
  try {
    res = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'Cannot reach the shop. Check your internet connection and try again.');
  }
  let data = null;
  try { data = await res.json(); } catch { /* empty or not JSON */ }
  if (!res.ok) throw new ApiError(res.status, data?.error || 'Something went wrong. Please try again.');
  return data;
}

export const get = (path) => api('GET', path);
export const post = (path, body = {}) => api('POST', path, body);
export const put = (path, body = {}) => api('PUT', path, body);
export const patch = (path, body = {}) => api('PATCH', path, body);
export const del = (path) => api('DELETE', path);

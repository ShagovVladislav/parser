import axios from 'axios'

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000'

export const http = axios.create({
  baseURL: apiBaseUrl,
  withCredentials: true,
  withXSRFToken: true,
  xsrfCookieName: 'XSRF-TOKEN',
  xsrfHeaderName: 'X-XSRF-TOKEN',
  headers: {
    Accept: 'application/json',
    'Content-Type': 'application/json',
  },
})

function getCookie(name) {
  return document.cookie
    .split('; ')
    .find((row) => row.startsWith(`${name}=`))
    ?.split('=')
    .slice(1)
    .join('=')
}

http.interceptors.request.use((config) => {
  const csrfToken = getCookie('XSRF-TOKEN')

  if (csrfToken) {
    config.headers['X-XSRF-TOKEN'] = decodeURIComponent(csrfToken)
  }

  return config
})

export function csrf() {
  return http.get('/sanctum/csrf-cookie')
}

export function getApiError(error) {
  return error?.response?.data || {
    message: error?.message || 'Не удалось выполнить запрос.',
  }
}

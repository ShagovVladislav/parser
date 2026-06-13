import { csrf, http } from './http'

export async function login(email, password) {
  await csrf()
  const response = await http.post('/api/login', { email, password })

  return response.data.data
}

export async function me() {
  const response = await http.get('/api/me')

  return response.data.data
}

export async function logout() {
  await http.post('/api/logout')
}

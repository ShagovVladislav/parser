import { http } from './http'

export async function getOrganization() {
  const response = await http.get('/api/organization')

  return response.data.data
}

export async function saveOrganizationUrl(url) {
  const response = await http.post('/api/organization', { url })

  return response.data.data
}

export async function refreshOrganization() {
  const response = await http.post('/api/organization/refresh')

  return response.data.data
}

export async function getReviews(page = 1) {
  const response = await http.get('/api/organization/reviews', {
    params: { page },
  })

  return response.data
}

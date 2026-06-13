import { computed, reactive } from 'vue'
import * as authApi from '../api/authApi'
import { getApiError } from '../api/http'

const state = reactive({
  user: null,
  isLoading: false,
  error: null,
  didFetchMe: false,
})

export function useAuth() {
  const isAuthenticated = computed(() => Boolean(state.user))

  async function fetchMe() {
    if (state.user) {
      return state.user
    }

    state.isLoading = true
    state.error = null

    try {
      state.user = await authApi.me()

      return state.user
    } catch (error) {
      state.user = null
      state.error = error.response?.status === 401 ? null : getApiError(error)

      return null
    } finally {
      state.didFetchMe = true
      state.isLoading = false
    }
  }

  async function login(email, password) {
    state.isLoading = true
    state.error = null

    try {
      state.user = await authApi.login(email, password)
      state.didFetchMe = true

      return state.user
    } catch (error) {
      state.user = null
      state.error = getApiError(error)
      throw error
    } finally {
      state.isLoading = false
    }
  }

  async function logout() {
    state.isLoading = true
    state.error = null

    try {
      await authApi.logout()
    } finally {
      state.user = null
      state.didFetchMe = false
      state.isLoading = false
    }
  }

  return {
    user: computed(() => state.user),
    isAuthenticated,
    isLoading: computed(() => state.isLoading),
    error: computed(() => state.error),
    didFetchMe: computed(() => state.didFetchMe),
    fetchMe,
    login,
    logout,
  }
}

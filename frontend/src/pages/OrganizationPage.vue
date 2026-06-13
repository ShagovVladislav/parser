<script setup>
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import * as organizationApi from '../api/organizationApi'
import { getApiError } from '../api/http'
import AppHeader from '../components/AppHeader.vue'
import ErrorAlert from '../components/ErrorAlert.vue'
import LoadingState from '../components/LoadingState.vue'
import OrganizationForm from '../components/OrganizationForm.vue'
import OrganizationSummary from '../components/OrganizationSummary.vue'
import Pagination from '../components/Pagination.vue'
import ReviewsTable from '../components/ReviewsTable.vue'
import { useAuth } from '../composables/useAuth'

const router = useRouter()
const auth = useAuth()

const organization = ref(null)
const reviews = ref([])
const paginationMeta = ref(null)
const isLoadingPage = ref(false)
const isSubmitting = ref(false)
const isRefreshing = ref(false)
const isLoadingReviews = ref(false)
const error = ref(null)

async function loadOrganization() {
  isLoadingPage.value = true
  error.value = null

  try {
    organization.value = await organizationApi.getOrganization()

    if (organization.value) {
      await loadReviews(1)
    }
  } catch (requestError) {
    error.value = getApiError(requestError)
  } finally {
    isLoadingPage.value = false
  }
}

async function loadReviews(page = 1) {
  isLoadingReviews.value = true
  error.value = null

  try {
    const response = await organizationApi.getReviews(page)
    reviews.value = response.data || []
    paginationMeta.value = response.meta || null
  } catch (requestError) {
    error.value = getApiError(requestError)
  } finally {
    isLoadingReviews.value = false
  }
}

async function saveUrl(url) {
  isSubmitting.value = true
  error.value = null

  try {
    organization.value = await organizationApi.saveOrganizationUrl(url)
    await loadReviews(1)
  } catch (requestError) {
    error.value = getApiError(requestError)
  } finally {
    isSubmitting.value = false
  }
}

async function refresh() {
  isRefreshing.value = true
  error.value = null

  try {
    organization.value = await organizationApi.refreshOrganization()
    await loadReviews(1)
  } catch (requestError) {
    error.value = getApiError(requestError)
  } finally {
    isRefreshing.value = false
  }
}

async function logout() {
  await auth.logout()
  await router.push('/login')
}

onMounted(loadOrganization)
</script>

<template>
  <main class="page-shell">
    <AppHeader :user="auth.user.value" :is-loading="auth.isLoading.value" @logout="logout" />

    <section class="page-intro">
      <h1>Организация и отзывы</h1>
      <p class="muted">Вставьте ссылку на карточку Яндекс.Карт, backend запустит parser и сохранит данные.</p>
    </section>

    <ErrorAlert :error="error" />
    <LoadingState v-if="isLoadingPage" text="Загружаем данные..." />

    <OrganizationForm :is-loading="isSubmitting" @submit="saveUrl" />
    <LoadingState v-if="isSubmitting" text="Parser работает, это может занять до нескольких минут..." />

    <OrganizationSummary
      :organization="organization"
      :is-refreshing="isRefreshing"
      @refresh="refresh"
    />
    <LoadingState v-if="isRefreshing" text="Обновляем данные организации..." />

    <LoadingState v-if="isLoadingReviews" text="Загружаем отзывы..." />
    <ReviewsTable :reviews="reviews" />
    <Pagination :meta="paginationMeta" :is-loading="isLoadingReviews" @change="loadReviews" />
  </main>
</template>

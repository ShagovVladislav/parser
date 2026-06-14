<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
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

const DEFAULT_PER_PAGE = 50
const SCROLL_TOP_THRESHOLD = 700
const router = useRouter()
const auth = useAuth()

const perPageOptions = [25, 50, 100]

const organization = ref(null)
const reviews = ref([])
const paginationMeta = ref(null)
const perPage = ref(DEFAULT_PER_PAGE)
const showScrollTop = ref(false)
const isLoadingPage = ref(false)
const isSubmitting = ref(false)
const isRefreshing = ref(false)
const isLoadingReviews = ref(false)
const error = ref(null)

const reviewsSummary = computed(() => {
  if (!paginationMeta.value) {
    return 'Отзывы пока не загружены'
  }

  const first = paginationMeta.value.from || 0
  const last = paginationMeta.value.to || reviews.value.length
  const total = paginationMeta.value.total || 0

  if (total === 0) {
    return 'Отзывы пока не загружены'
  }

  return `Показаны ${first}-${last} из ${total}`
})

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

async function loadReviews(page = 1, options = {}) {
  if (isLoadingReviews.value) {
    return
  }

  isLoadingReviews.value = true
  error.value = null

  try {
    const response = await organizationApi.getReviews(page, perPage.value)

    reviews.value = response.data || []
    paginationMeta.value = response.meta || null

    if (options.scroll === true) {
      scrollToReviews()
    }
  } catch (requestError) {
    error.value = getApiError(requestError)
  } finally {
    isLoadingReviews.value = false
  }
}

async function changeReviewsPage(page) {
  await loadReviews(page, { scroll: true })
}

async function saveUrl(url) {
  isSubmitting.value = true
  error.value = null

  try {
    organization.value = await organizationApi.saveOrganizationUrl(url)
    reviews.value = []
    paginationMeta.value = null
    await loadReviews(1, { scroll: true })
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
    reviews.value = []
    paginationMeta.value = null
    await loadReviews(1, { scroll: true })
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

function handleScroll() {
  showScrollTop.value = window.scrollY > SCROLL_TOP_THRESHOLD
}

function scrollToTop() {
  window.scrollTo({
    top: 0,
    behavior: 'smooth',
  })
}

function scrollToReviews() {
  if (!paginationMeta.value) {
    return
  }

  requestAnimationFrame(() => {
    document.querySelector('.reviews-toolbar')?.scrollIntoView({
      behavior: 'smooth',
      block: 'start',
    })
  })
}

watch(perPage, async () => {
  if (!organization.value) {
    return
  }

  reviews.value = []
  paginationMeta.value = null
  await loadReviews(1, { scroll: true })
})

onMounted(async () => {
  await loadOrganization()
  window.addEventListener('scroll', handleScroll, { passive: true })
  handleScroll()
})

onBeforeUnmount(() => {
  window.removeEventListener('scroll', handleScroll)
})
</script>

<template>
  <main class="page-shell">
    <AppHeader :user="auth.user.value" :is-loading="auth.isLoading.value" @logout="logout" />

    <section class="page-intro">
      <h1>Организация и отзывы</h1>
      <p class="muted">
        Вставьте ссылку на карточку Яндекс.Карт, backend запустит parser и сохранит данные.
      </p>
    </section>

    <ErrorAlert :error="error" />
    <LoadingState v-if="isLoadingPage" text="Загружаем данные..." />

    <OrganizationForm :is-loading="isSubmitting" @submit="saveUrl" />
    <LoadingState
      v-if="isSubmitting"
      text="Parser работает, это может занять до нескольких минут..."
    />

    <OrganizationSummary
      :organization="organization"
      :is-refreshing="isRefreshing"
      @refresh="refresh"
    />
    <LoadingState v-if="isRefreshing" text="Обновляем данные организации..." />

    <section v-if="organization" class="reviews-toolbar">
      <div>
        <h2>Отзывы</h2>
        <p class="muted">{{ reviewsSummary }}</p>
      </div>

      <label class="compact-field">
        <span>На странице</span>
        <select v-model.number="perPage" :disabled="isLoadingReviews">
          <option v-for="option in perPageOptions" :key="option" :value="option">
            {{ option }}
          </option>
        </select>
      </label>
    </section>

    <LoadingState v-if="isLoadingReviews" text="Загружаем отзывы..." />
    <ReviewsTable :reviews="reviews" />
    <Pagination :meta="paginationMeta" :is-loading="isLoadingReviews" @change="changeReviewsPage" />

    <button
      v-if="showScrollTop"
      class="scroll-top-button"
      type="button"
      aria-label="Вернуться к началу страницы"
      @click="scrollToTop"
    >
      ↑
    </button>
  </main>
</template>

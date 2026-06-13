<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import * as organizationApi from '../api/organizationApi'
import { getApiError } from '../api/http'
import AppHeader from '../components/AppHeader.vue'
import ErrorAlert from '../components/ErrorAlert.vue'
import LoadingState from '../components/LoadingState.vue'
import OrganizationForm from '../components/OrganizationForm.vue'
import OrganizationSummary from '../components/OrganizationSummary.vue'
import ReviewsTable from '../components/ReviewsTable.vue'
import { useAuth } from '../composables/useAuth'

const router = useRouter()
const auth = useAuth()

const perPageOptions = [25, 50, 100]

const organization = ref(null)
const reviews = ref([])
const paginationMeta = ref(null)
const perPage = ref(50)
const reviewsSentinel = ref(null)
const showScrollTop = ref(false)
const isLoadingPage = ref(false)
const isSubmitting = ref(false)
const isRefreshing = ref(false)
const isLoadingReviews = ref(false)
const error = ref(null)

let reviewsObserver = null

const hasMoreReviews = computed(() => {
  return Boolean(
    paginationMeta.value &&
      paginationMeta.value.current_page < paginationMeta.value.last_page,
  )
})

const reviewsTotalLabel = computed(() => {
  if (!paginationMeta.value) {
    return reviews.value.length
  }

  return paginationMeta.value.total
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

  const shouldAppend = options.append === true
  isLoadingReviews.value = true
  error.value = null

  try {
    const response = await organizationApi.getReviews(page, perPage.value)
    const nextReviews = response.data || []

    reviews.value = shouldAppend ? mergeReviews(reviews.value, nextReviews) : nextReviews
    paginationMeta.value = response.meta || null
  } catch (requestError) {
    error.value = getApiError(requestError)
  } finally {
    isLoadingReviews.value = false
  }
}

function mergeReviews(currentReviews, nextReviews) {
  const seen = new Set(currentReviews.map((review) => review.id))
  const uniqueNextReviews = nextReviews.filter((review) => !seen.has(review.id))

  return [...currentReviews, ...uniqueNextReviews]
}

async function loadMoreReviews() {
  if (!hasMoreReviews.value || isLoadingReviews.value) {
    return
  }

  await loadReviews(paginationMeta.value.current_page + 1, { append: true })
}

async function saveUrl(url) {
  isSubmitting.value = true
  error.value = null

  try {
    organization.value = await organizationApi.saveOrganizationUrl(url)
    reviews.value = []
    paginationMeta.value = null
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
    reviews.value = []
    paginationMeta.value = null
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

function setupReviewsObserver() {
  if (reviewsObserver) {
    reviewsObserver.disconnect()
  }

  if (!('IntersectionObserver' in window) || !reviewsSentinel.value) {
    return
  }

  reviewsObserver = new IntersectionObserver(
    ([entry]) => {
      if (entry.isIntersecting) {
        loadMoreReviews()
      }
    },
    { rootMargin: '420px 0px' },
  )

  reviewsObserver.observe(reviewsSentinel.value)
}

function handleScroll() {
  showScrollTop.value = window.scrollY > 700
}

function scrollToTop() {
  window.scrollTo({
    top: 0,
    behavior: 'smooth',
  })
}

watch(perPage, async () => {
  if (!organization.value) {
    return
  }

  reviews.value = []
  paginationMeta.value = null
  await loadReviews(1)
})

onMounted(async () => {
  await loadOrganization()
  await nextTick()
  setupReviewsObserver()
  window.addEventListener('scroll', handleScroll, { passive: true })
  handleScroll()
})

onBeforeUnmount(() => {
  if (reviewsObserver) {
    reviewsObserver.disconnect()
  }

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
      </div>

      <label class="compact-field">
        <span>Подгружать по</span>
        <select v-model.number="perPage" :disabled="isLoadingReviews">
          <option v-for="option in perPageOptions" :key="option" :value="option">
            {{ option }}
          </option>
        </select>
      </label>
    </section>

    <LoadingState
      v-if="isLoadingReviews && !reviews.length"
      text="Загружаем отзывы..."
    />
    <ReviewsTable :reviews="reviews" />

    <div ref="reviewsSentinel" class="reviews-sentinel" aria-hidden="true"></div>

    <div v-if="isLoadingReviews && reviews.length" class="load-more-note">
      Загружаем следующую пачку отзывов...
    </div>

    <button
      v-if="hasMoreReviews && !isLoadingReviews"
      class="button button-secondary load-more-button"
      type="button"
      @click="loadMoreReviews"
    >
      Загрузить ещё
    </button>

    <p v-if="paginationMeta && !hasMoreReviews && reviews.length" class="reviews-end">
      Все загруженные backend отзывы показаны.
    </p>

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

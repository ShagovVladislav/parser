<script setup>
import { computed } from 'vue'

const props = defineProps({
  meta: {
    type: Object,
    default: null,
  },
  isLoading: {
    type: Boolean,
    default: false,
  },
})

const emit = defineEmits(['change'])

const visiblePages = computed(() => {
  if (!props.meta) {
    return []
  }

  const current = props.meta.current_page
  const last = props.meta.last_page
  const start = Math.max(1, current - 2)
  const end = Math.min(last, current + 2)
  const pages = []

  for (let page = start; page <= end; page += 1) {
    pages.push(page)
  }

  return pages
})

function goTo(page) {
  if (
    !props.meta ||
    props.isLoading ||
    page < 1 ||
    page > props.meta.last_page ||
    page === props.meta.current_page
  ) {
    return
  }

  emit('change', page)
}
</script>

<template>
  <nav v-if="meta && meta.last_page > 1" class="pagination" aria-label="Пагинация отзывов">
    <button
      class="button button-secondary"
      type="button"
      :disabled="isLoading || meta.current_page <= 1"
      @click="goTo(meta.current_page - 1)"
    >
      Назад
    </button>

    <div class="pagination-pages">
      <button
        v-if="visiblePages[0] > 1"
        class="pagination-page"
        type="button"
        :disabled="isLoading"
        @click="goTo(1)"
      >
        1
      </button>

      <span v-if="visiblePages[0] > 2" class="pagination-ellipsis">...</span>

      <button
        v-for="page in visiblePages"
        :key="page"
        class="pagination-page"
        :class="{ 'is-active': page === meta.current_page }"
        type="button"
        :disabled="isLoading || page === meta.current_page"
        @click="goTo(page)"
      >
        {{ page }}
      </button>

      <span
        v-if="visiblePages[visiblePages.length - 1] < meta.last_page - 1"
        class="pagination-ellipsis"
      >
        ...
      </span>

      <button
        v-if="visiblePages[visiblePages.length - 1] < meta.last_page"
        class="pagination-page"
        type="button"
        :disabled="isLoading"
        @click="goTo(meta.last_page)"
      >
        {{ meta.last_page }}
      </button>
    </div>

    <button
      class="button button-secondary"
      type="button"
      :disabled="isLoading || meta.current_page >= meta.last_page"
      @click="goTo(meta.current_page + 1)"
    >
      Вперёд
    </button>
  </nav>
</template>

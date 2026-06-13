<script setup>
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

function goTo(page) {
  if (!props.meta || props.isLoading || page < 1 || page > props.meta.last_page) {
    return
  }

  emit('change', page)
}
</script>

<template>
  <nav v-if="meta && meta.last_page > 1" class="pagination" aria-label="Пагинация отзывов">
    <button
      class="button button-secondary"
      :disabled="isLoading || meta.current_page <= 1"
      @click="goTo(meta.current_page - 1)"
    >
      Назад
    </button>

    <span>Страница {{ meta.current_page }} из {{ meta.last_page }} · всего {{ meta.total }}</span>

    <button
      class="button button-secondary"
      :disabled="isLoading || meta.current_page >= meta.last_page"
      @click="goTo(meta.current_page + 1)"
    >
      Вперёд
    </button>
  </nav>
</template>

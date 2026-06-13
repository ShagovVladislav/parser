<script setup>
import { ref } from 'vue'

defineProps({
  isLoading: {
    type: Boolean,
    default: false,
  },
})

const emit = defineEmits(['submit'])

const url = ref('')
const error = ref('')

function validate(value) {
  if (!value.trim()) {
    return 'Вставьте ссылку на Яндекс.Карты.'
  }

  try {
    const parsed = new URL(value)
    const host = parsed.hostname.toLowerCase()
    const isYandexHost = ['yandex.ru', 'www.yandex.ru', 'yandex.com', 'www.yandex.com'].includes(host)

    if (!isYandexHost || !parsed.pathname.includes('/maps/')) {
      return 'Ссылка должна вести на страницу Яндекс.Карт.'
    }
  } catch {
    return 'Введите корректный URL.'
  }

  return ''
}

function submit() {
  error.value = validate(url.value)

  if (error.value) {
    return
  }

  emit('submit', url.value.trim())
}
</script>

<template>
  <form class="panel" @submit.prevent="submit">
    <label class="field">
      <span>Ссылка на организацию в Яндекс.Картах</span>
      <input
        v-model="url"
        type="url"
        placeholder="https://yandex.ru/maps/org/..."
        :disabled="isLoading"
      >
    </label>

    <div v-if="error" class="field-error">{{ error }}</div>

    <button class="button" type="submit" :disabled="isLoading">
      {{ isLoading ? 'Загружаем...' : 'Загрузить отзывы' }}
    </button>
  </form>
</template>

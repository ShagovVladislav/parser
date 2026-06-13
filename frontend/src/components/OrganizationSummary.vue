<script setup>
defineProps({
  organization: {
    type: Object,
    default: null,
  },
  isRefreshing: {
    type: Boolean,
    default: false,
  },
})

defineEmits(['refresh'])

const statusLabels = {
  pending: 'Ожидает обработки',
  processing: 'Идёт загрузка',
  success: 'Данные загружены',
  failed: 'Ошибка загрузки',
}

function formatDate(value) {
  if (!value) {
    return '—'
  }

  return new Intl.DateTimeFormat('ru-RU', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
}
</script>

<template>
  <section v-if="organization" class="panel organization-summary">
    <div class="summary-header">
      <div>
        <h2>{{ organization.name || 'Организация без названия' }}</h2>
        <span class="status-badge" :class="`status-${organization.parse_status}`">
          {{ statusLabels[organization.parse_status] || organization.parse_status }}
        </span>
      </div>

      <button class="button button-secondary" :disabled="isRefreshing" @click="$emit('refresh')">
        {{ isRefreshing ? 'Обновляем...' : 'Обновить' }}
      </button>
    </div>

    <dl class="summary-grid">
      <div>
        <dt>Рейтинг</dt>
        <dd>{{ organization.rating ?? '—' }}</dd>
      </div>
      <div>
        <dt>Оценок</dt>
        <dd>{{ organization.rating_count ?? '—' }}</dd>
      </div>
      <div>
        <dt>Текстовых отзывов</dt>
        <dd>{{ organization.review_count ?? '—' }}</dd>
      </div>
      <div>
        <dt>Последний парсинг</dt>
        <dd>{{ formatDate(organization.last_parsed_at) }}</dd>
      </div>
    </dl>

    <div v-if="organization.parse_error" class="alert alert-error">
      {{ organization.parse_error }}
    </div>

    <div class="link-list">
      <a :href="organization.yandex_url" target="_blank" rel="noreferrer">Исходная ссылка</a>
      <a v-if="organization.final_url" :href="organization.final_url" target="_blank" rel="noreferrer">
        Итоговая ссылка
      </a>
    </div>
  </section>

  <section v-else class="empty-panel">
    Организация пока не загружена. Вставьте ссылку на карточку в Яндекс.Картах.
  </section>
</template>

<script setup>
defineProps({
  user: {
    type: Object,
    default: null,
  },
  isLoading: {
    type: Boolean,
    default: false,
  },
})

defineEmits(['logout'])
</script>

<template>
  <header class="app-header">
    <div>
      <div class="app-title">Yandex Reviews</div>
      <div v-if="user" class="muted">{{ user.name }} · {{ user.email }}</div>
    </div>

    <button class="button button-secondary" :disabled="isLoading" @click="$emit('logout')">
      Выйти
    </button>
  </header>
</template>

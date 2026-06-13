<script setup>
defineProps({
  text: {
    type: String,
    default: 'Загрузка...',
  },
})
</script>

<template>
  <div class="loading-state">
    <span class="spinner" aria-hidden="true"></span>
    <span>{{ text }}</span>
  </div>
</template>

<script setup>
defineProps({
  reviews: {
    type: Array,
    default: () => [],
  },
})
</script>

<template>
  <section class="reviews-section">
    <h2>Отзывы</h2>

    <div v-if="!reviews.length" class="empty-panel">
      Отзывы пока не загружены.
    </div>

    <article v-for="review in reviews" :key="review.id" class="review-card">
      <div class="review-meta">
        <strong>{{ review.author_name || 'Автор не указан' }}</strong>
        <span>{{ review.review_date_text || 'Дата не указана' }}</span>
        <span v-if="review.rating" class="rating">{{ review.rating }} / 5</span>
      </div>

      <p>{{ review.text }}</p>

      <div v-if="review.company_response" class="company-response">
        <strong>Ответ компании</strong>
        <p>{{ review.company_response }}</p>
      </div>
    </article>
  </section>
</template>

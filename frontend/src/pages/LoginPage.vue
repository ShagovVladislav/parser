<script setup>
import { ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import ErrorAlert from '../components/ErrorAlert.vue'
import LoadingState from '../components/LoadingState.vue'
import { useAuth } from '../composables/useAuth'

const router = useRouter()
const route = useRoute()
const auth = useAuth()

const email = ref('demo@example.com')
const password = ref('password')

async function submit() {
  try {
    await auth.login(email.value, password.value)
    await router.push(route.query.redirect || '/organization')
  } catch {
    // Error is stored in useAuth.
  }
}
</script>

<template>
  <main class="auth-page">
    <section class="auth-panel">
      <h1>Вход</h1>
      <p class="muted">Используйте demo-пользователя для тестового задания.</p>

      <ErrorAlert :error="auth.error.value" />
      <LoadingState v-if="auth.isLoading.value" text="Проверяем доступ..." />

      <form class="login-form" @submit.prevent="submit">
        <label class="field">
          <span>Email</span>
          <input v-model="email" type="email" autocomplete="email" required>
        </label>

        <label class="field">
          <span>Пароль</span>
          <input v-model="password" type="password" autocomplete="current-password" required>
        </label>

        <button class="button" type="submit" :disabled="auth.isLoading.value">
          Войти
        </button>
      </form>
    </section>
  </main>
</template>

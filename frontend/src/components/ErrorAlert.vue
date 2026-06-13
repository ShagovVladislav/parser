<script setup>
defineProps({
  error: {
    type: [Object, String, Error],
    default: null,
  },
})

function mainMessage(error) {
  if (!error) {
    return ''
  }

  if (typeof error === 'string') {
    return error
  }

  return error.message || 'Произошла ошибка.'
}

function validationMessages(error) {
  if (!error?.errors) {
    return []
  }

  return Object.values(error.errors).flat()
}
</script>

<template>
  <div v-if="error" class="alert alert-error" role="alert">
    <strong>{{ mainMessage(error) }}</strong>

    <ul v-if="validationMessages(error).length" class="alert-list">
      <li v-for="message in validationMessages(error)" :key="message">
        {{ message }}
      </li>
    </ul>

    <div v-if="error.parser_error" class="parser-error">
      <div>Код parser: {{ error.parser_error.code }}</div>
      <div>{{ error.parser_error.message }}</div>
    </div>
  </div>
</template>

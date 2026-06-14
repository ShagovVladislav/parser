# Frontend

Vue 3 SPA для тестового задания Laravel + Vue.

## Запуск

Production-вариант через Docker/NGINX запускается из корня проекта:

```bash
docker compose up -d --build
```

Frontend будет доступен на:

```text
http://localhost:8081
```

Dev-режим с hot reload:

```bash
cd frontend
cp .env.example .env
npm install
npm run dev
```

По умолчанию frontend ожидает backend по адресу:

```env
VITE_API_BASE_URL=http://localhost:8000
```

В Docker production-сборке используется `VITE_API_BASE_URL=/`, а запросы `/api` и `/sanctum` проксируются через NGINX.

## Demo login

```text
email: demo@example.com
password: password
```

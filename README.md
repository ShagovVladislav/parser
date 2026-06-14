# Yandex Maps Reviews Parser

Тестовое задание Laravel + Vue 3: приложение принимает ссылку на карточку организации в Яндекс.Картах, парсит данные организации и отзывы, сохраняет результат в PostgreSQL и показывает отзывы во Vue SPA с постраничной навигацией.

## Что Реализовано

- Laravel API backend.
- Vue 3 SPA frontend.
- Авторизация через Laravel Sanctum.
- Один demo-пользователь без регистрации.
- Ввод и валидация ссылки на Яндекс.Карты.
- Парсинг карточки организации через Node.js + Playwright.
- Сохранение организации и отзывов в PostgreSQL.
- Вывод рейтинга, количества оценок и количества текстовых отзывов.
- Вывод отзывов: автор, дата, текст, оценка.
- Постраничная навигация отзывов без перезагрузки страницы.
- Docker Compose для локального запуска backend, frontend, NGINX и PostgreSQL.

## Доступы

```text
email: demo@example.com
password: password
```

## Быстрый Запуск

Требуется Docker Desktop.

```bash
docker compose up -d --build
```

Backend будет доступен:

```text
http://localhost:8000
```

Production-сборка frontend отдаётся через NGINX:

```text
http://localhost:8081
```

NGINX также проксирует `/api` и `/sanctum` в Laravel-контейнер, поэтому в Docker-режиме frontend работает с API с того же origin.

Для `/api` в NGINX выставлены увеличенные proxy timeout, потому что `POST /api/organization` может ждать завершения Playwright parser несколько минут.

Если нужен dev-режим frontend с hot reload, его можно запускать отдельно:

```bash
cd frontend
cp .env.example .env
npm install
npm run dev
```

Frontend будет доступен:

```text
http://localhost:5173
```

Важно открывать frontend через `localhost`, а не через `127.0.0.1`, чтобы cookie-аутентификация Sanctum работала предсказуемо.

## Проверка Сценария

1. Открыть `http://localhost:8081/login`.
2. Войти под demo-пользователем.
3. Вставить ссылку на организацию Яндекс.Карт.
4. Дождаться завершения парсинга.
5. Проверить карточку организации, рейтинг, количество оценок и отзывов.
6. Переключать страницы отзывов через пагинацию.

Пример ссылки:

```text
https://yandex.ru/maps/-/CPtoBJJX
```

## Переменные Окружения

Основные backend-переменные находятся в `.env.example`.

Для Docker Compose значения задаются в `docker-compose.yml`:

```env
APP_URL=http://localhost:8000
FRONTEND_URL=http://localhost:8081
FRONTEND_URLS=http://localhost:8081,http://127.0.0.1:8081,http://localhost:5173,http://127.0.0.1:5173
SANCTUM_STATEFUL_DOMAINS=localhost:8081,127.0.0.1:8081,localhost:5173,127.0.0.1:5173,localhost:8000,127.0.0.1:8000

DB_CONNECTION=pgsql
DB_HOST=postgres
DB_PORT=5432
DB_DATABASE=parser
DB_USERNAME=parser
DB_PASSWORD=parser

YANDEX_PARSER_NODE_BINARY=node
YANDEX_PARSER_SCRIPT_PATH=/var/www/html/yandex-parser.js
YANDEX_PARSER_MAX_REVIEWS=700
YANDEX_PARSER_TIMEOUT=300
YANDEX_PARSER_DEBUG=false
YANDEX_PARSER_DEBUG_DIR=/var/www/html/storage/app/parser-debug
```

Frontend:

```env
VITE_API_BASE_URL=http://localhost:8000
```

В Docker production-сборке frontend собирается с:

```env
VITE_API_BASE_URL=/
```

Это нужно, чтобы браузер обращался к API через NGINX на том же origin: `http://localhost:8081/api/...`.

## Архитектура

Backend:

```text
app/
├── Http/
│   ├── Controllers/Api/
│   ├── Requests/
│   └── Resources/
├── Models/
│   ├── Organization.php
│   ├── Review.php
│   └── User.php
└── Services/
    ├── Organizations/OrganizationImportService.php
    └── Yandex/YandexParserService.php
```

Основные связи:

```text
User hasMany Organization
Organization belongsTo User
Organization hasMany Review
Review belongsTo Organization
```

Контроллеры тонкие: они принимают request, вызывают сервисы и возвращают API resources. Логика запуска parser и сохранения результата вынесена в сервисный слой.

Frontend:

```text
frontend/src/
├── api/
├── components/
├── composables/
├── pages/
└── router/

frontend/
├── Dockerfile
└── docker/nginx.conf
```

Авторизация хранится в composable `useAuth`. API-запросы идут через Axios с `withCredentials` и CSRF-cookie для Sanctum.

## API

```text
POST /api/login
GET  /api/me
POST /api/logout

GET  /api/organization
POST /api/organization
POST /api/organization/refresh

GET  /api/organization/reviews?page=1&per_page=50
```

Отзывы отдаются из БД через Laravel pagination. При переключении страницы frontend делает новый API-запрос, но страницу браузера не перезагружает.

## База Данных

Используется PostgreSQL.

Основные таблицы:

- `users`
- `organizations`
- `reviews`

`organizations` хранит исходную ссылку, итоговую ссылку, id компании Яндекса, название, рейтинг, счётчики и статус парсинга.

`reviews` хранит отзыв, автора, дату, оценку и `external_hash`, чтобы повторный парсинг не создавал дубли.

## Parser

Parser находится в корне проекта:

```text
yandex-parser.js
```

Запуск вручную:

```bash
node yandex-parser.js "https://yandex.ru/maps/-/CPtoBJJX" 700
```

Debug-режим:

```bash
node yandex-parser.js "https://yandex.ru/maps/-/CPtoBJJX" 700 --debug --debug-dir=./debug
```

Parser пишет успешный JSON только в stdout. Ошибки пишутся структурированным JSON в stderr.

Поддерживаемые форматы ссылок:

- прямой URL `/maps/org/.../{id}`;
- URL с `poi[uri]=ymapsbm1://org?oid=...`;
- короткие ссылки `/maps/-/...`.

## Подход К Парсингу

У Яндекс.Карт нет публичного API для отзывов, поэтому используется Playwright:

1. Открывается исходная ссылка.
2. Короткая ссылка раскрывается браузером.
3. Определяется id организации.
4. Открывается карточка и вкладка отзывов.
5. Parser кликает элементы раскрытия полного текста.
6. Parser ищет реальный scroll-контейнер отзывов и прокручивает его.
7. По мере прокрутки Яндекс подгружает новые отзывы.
8. Отзывы нормализуются, чистятся от служебного текста и дедуплицируются по hash.

На практике Яндекс часто отдаёт не все исторические отзывы, а примерно последние несколько сотен. Для тестовой организации parser сохранял около 600 отзывов при `YANDEX_PARSER_MAX_REVIEWS=700`, что соответствует ориентиру из ТЗ.

## Обработка Ошибок Parser

Parser возвращает структурированные ошибки:

```json
{
  "error": {
    "code": "ERROR_CODE",
    "message": "Human readable message",
    "details": {}
  }
}
```

Laravel преобразует эти ошибки в API-ответы. Например, если Яндекс показал капчу или ограничил доступ, API вернёт ошибку внешнего источника, а организация получит статус `failed`.

Основные статусы организации:

```text
pending
processing
success
failed
```

## Проверки

Backend:

```bash
docker compose exec -T app php artisan test
```

Parser syntax:

```bash
node --check yandex-parser.js
```

Frontend:

```bash
cd frontend
npm run build
```

## Что Доделал Бы При Большем Времени

- Перенёс бы запуск parser в очередь, чтобы HTTP-запрос не ждал несколько минут.
- Добавил бы прогресс парсинга и историю запусков.
- Сохранял бы warnings parser в БД и показывал их в интерфейсе.
- Добавил бы retry/backoff для временных проблем Яндекса.
- Добавил бы e2e-тесты frontend + backend.
- Улучшил бы parser через анализ внутренних сетевых запросов Яндекс.Карт, если потребуется стабильнее вытягивать максимум доступных отзывов.

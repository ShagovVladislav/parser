import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { chromium, errors as playwrightErrors } from 'playwright';

const DEFAULT_MAX_REVIEWS = 600;
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;
const DEFAULT_DEBUG_DIR = './debug';
const SCROLL_ITERATION_LIMIT = 120;

const DEBUG_STEPS = {
  initial: '01-initial-page',
  cardLoaded: '02-after-card-loaded',
  reviewsOpened: '03-after-reviews-opened',
  afterScroll: '04-after-scroll',
};

const SERVICE_TEXTS = [
  'Подписаться',
  'Вы подписаны',
  'Ещё',
  'Показать полностью',
  'Читать полностью',
  'Нравится',
  'Ответить',
  'Пожаловаться',
  'Поделиться',
];

const ERROR_CODES = new Set([
  'INVALID_USAGE',
  'INVALID_URL',
  'INVALID_HOST',
  'INVALID_MAPS_URL',
  'COMPANY_ID_NOT_FOUND',
  'CARD_NOT_LOADED',
  'REVIEWS_TAB_NOT_FOUND',
  'REVIEWS_CONTAINER_NOT_FOUND',
  'YANDEX_BLOCKED',
  'PARSER_TIMEOUT',
  'INVALID_RESULT',
  'UNKNOWN_ERROR',
]);

async function bootstrap() {
  const rawArgs = process.argv.slice(2);

  if (hasHelpFlag(rawArgs)) {
    printHelp();
    return;
  }

  const debug = getBootstrapDebugState(rawArgs);

  try {
    const options = parseCliArgs(rawArgs);
    Object.assign(debug, {
      enabled: options.debug,
      dir: path.resolve(options.debugDir),
    });

    await prepareDebugDir(debug);
    debugLog(debug, `Parser started with max_reviews=${options.maxReviews}, timeout_ms=${options.timeoutMs}`);

    let activeBrowser = null;
    const startedAt = Date.now();
    const runState = {
      startedAt,
      deadlineAt: startedAt + options.timeoutMs,
      debug,
      getBrowser: () => activeBrowser,
      setBrowser: (browser) => {
        activeBrowser = browser;
      },
    };

    const result = await runWithGlobalTimeout(
      () => runParser(options, runState),
      options.timeoutMs,
      runState
    );

    await writeDebugJson(debug, 'result.json', result);
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    const envelope = createErrorEnvelope(error);

    await writeDebugJson(debug, 'error.json', envelope);
    console.error(JSON.stringify(envelope, null, 2));
    process.exitCode = 1;
  }
}

async function runParser(options, state) {
  assertYandexMapsUrl(options.inputUrl);

  let companyId = tryExtractCompanyIdFromUrl(options.inputUrl);
  let browser = null;

  try {
    ensureNotTimedOut(state);
    debugLog(state.debug, 'Launching Chromium');

    browser = await chromium.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-dev-shm-usage',
        '--disable-setuid-sandbox',
      ],
    });
    state.setBrowser(browser);

    const context = await browser.newContext({
      locale: 'ru-RU',
      viewport: {
        width: 1440,
        height: 1000,
      },
      userAgent:
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 ' +
        '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    });

    const page = await context.newPage();
    page.setDefaultTimeout(getActionTimeout(state));
    page.setDefaultNavigationTimeout(getActionTimeout(state));

    debugLog(state.debug, 'Opening source URL');
    await page.goto(options.inputUrl, {
      waitUntil: 'domcontentloaded',
      timeout: getActionTimeout(state),
    });
    await page.waitForTimeout(2500);
    await assertNotYandexBlocked(page);
    await saveDebugPage(page, state.debug, DEBUG_STEPS.initial);

    if (!companyId) {
      companyId = tryExtractCompanyIdFromUrl(page.url());
    }

    if (!companyId) {
      debugLog(state.debug, 'Company ID was not found in URL, scanning page payload');
      companyId = await tryExtractCompanyIdFromPage(page);
    }

    if (!companyId) {
      throw new ParserError(
        'COMPANY_ID_NOT_FOUND',
        'Не удалось определить ID организации из ссылки или открытой страницы.',
        { source_url: options.inputUrl, final_url: page.url() }
      );
    }

    debugLog(state.debug, `Company ID resolved: ${companyId}`);
    await waitForMapCard(page);
    await assertNotYandexBlocked(page);
    await saveDebugPage(page, state.debug, DEBUG_STEPS.cardLoaded);

    const organization = await parseOrganizationInfo(page, companyId);

    debugLog(state.debug, 'Opening reviews tab');
    await openReviewsTab(page, companyId, state);
    await assertNotYandexBlocked(page);
    await saveDebugPage(page, state.debug, DEBUG_STEPS.reviewsOpened);

    const reviewCountFromPage = await extractReviewCountFromReviewsPage(page);

    if (organization.rating === null) {
      organization.rating = await extractRating(page);
    }

    if (organization.ratingCount === null) {
      organization.ratingCount = await extractRatingCount(page);
    }

    debugLog(state.debug, 'Collecting reviews');
    const reviews = await collectReviews(page, options.maxReviews, state);
    await saveDebugPage(page, state.debug, DEBUG_STEPS.afterScroll);

    const warnings = [];
    const result = buildResult({
      organization,
      reviews,
      sourceUrl: options.inputUrl,
      finalUrl: page.url(),
      maxReviews: options.maxReviews,
      reviewCountFromPage,
      startedAt: state.startedAt,
      warnings,
    });

    validateResult(result);
    debugLog(state.debug, `Parser finished, parsed_reviews_count=${result.reviews.length}`);

    return result;
  } finally {
    state.setBrowser(null);
    await closeBrowser(browser, state.debug);
  }
}

async function runWithGlobalTimeout(task, timeoutMs, state) {
  let timeoutId = null;
  let timedOut = false;

  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      timedOut = true;
      debugLog(state.debug, 'Global parser timeout reached');
      void closeBrowser(state.getBrowser(), state.debug);
      reject(
        new ParserError(
          'PARSER_TIMEOUT',
          `Превышено общее время работы парсера: ${timeoutMs} мс.`,
          { timeout_ms: timeoutMs }
        )
      );
    }, timeoutMs);
  });

  const taskPromise = task().catch((error) => {
    if (timedOut || isPlaywrightTimeout(error)) {
      throw new ParserError(
        'PARSER_TIMEOUT',
        `Превышено общее время работы парсера: ${timeoutMs} мс.`,
        { timeout_ms: timeoutMs }
      );
    }

    throw error;
  });

  try {
    return await Promise.race([taskPromise, timeoutPromise]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

function parseCliArgs(args) {
  const options = {
    inputUrl: null,
    maxReviews: DEFAULT_MAX_REVIEWS,
    debug: false,
    debugDir: DEFAULT_DEBUG_DIR,
    timeoutMs: DEFAULT_TIMEOUT_MS,
  };
  const positional = [];
  let maxReviewsFromOption = null;

  for (const arg of args) {
    if (arg === '--debug') {
      options.debug = true;
      continue;
    }

    if (arg.startsWith('--max-reviews=')) {
      maxReviewsFromOption = parsePositiveIntegerOption(arg, '--max-reviews');
      continue;
    }

    if (arg.startsWith('--timeout=')) {
      options.timeoutMs = parsePositiveIntegerOption(arg, '--timeout');
      continue;
    }

    if (arg.startsWith('--debug-dir=')) {
      const value = arg.slice('--debug-dir='.length).trim();

      if (!value) {
        throw new ParserError(
          'INVALID_USAGE',
          'Параметр --debug-dir должен содержать путь.',
          { option: '--debug-dir' }
        );
      }

      options.debugDir = value;
      continue;
    }

    if (arg.startsWith('--')) {
      throw new ParserError(
        'INVALID_USAGE',
        `Неизвестный параметр: ${arg}`,
        { option: arg }
      );
    }

    positional.push(arg);
  }

  if (positional.length === 0) {
    throw new ParserError(
      'INVALID_USAGE',
      'Не передан URL организации Яндекс.Карт.',
      { usage: getUsageLine() }
    );
  }

  if (positional.length > 2) {
    throw new ParserError(
      'INVALID_USAGE',
      'Передано слишком много позиционных аргументов.',
      { usage: getUsageLine() }
    );
  }

  options.inputUrl = positional[0];

  if (!options.inputUrl || !options.inputUrl.trim()) {
    throw new ParserError(
      'INVALID_USAGE',
      'URL организации не должен быть пустым.',
      { usage: getUsageLine() }
    );
  }

  if (positional[1] !== undefined) {
    options.maxReviews = parsePositiveInteger(positional[1], 'maxReviews');
  }

  if (maxReviewsFromOption !== null) {
    options.maxReviews = maxReviewsFromOption;
  }

  return options;
}

function parsePositiveIntegerOption(rawArg, optionName) {
  const value = rawArg.slice(`${optionName}=`.length);
  return parsePositiveInteger(value, optionName);
}

function parsePositiveInteger(value, label) {
  if (!/^\d+$/.test(String(value))) {
    throw new ParserError(
      'INVALID_USAGE',
      `Параметр ${label} должен быть положительным целым числом.`,
      { option: label, value }
    );
  }

  const parsed = Number(value);

  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new ParserError(
      'INVALID_USAGE',
      `Параметр ${label} должен быть положительным целым числом.`,
      { option: label, value }
    );
  }

  return parsed;
}

function hasHelpFlag(args) {
  return args.includes('--help') || args.includes('-h');
}

function getUsageLine() {
  return 'node yandex-parser.js "<yandex-maps-url>" [maxReviews] [--max-reviews=N] [--timeout=MS] [--debug] [--debug-dir=DIR]';
}

function printHelp() {
  console.log(`Yandex Maps organization reviews parser

Usage:
  node yandex-parser.js "<yandex-maps-url>"
  node yandex-parser.js "<yandex-maps-url>" 700
  node yandex-parser.js "<yandex-maps-url>" --max-reviews=700
  node yandex-parser.js "<yandex-maps-url>" 700 --debug
  node yandex-parser.js "<yandex-maps-url>" --debug --debug-dir=./debug --timeout=300000

Options:
  --max-reviews=N   Maximum number of reviews to collect. Default: ${DEFAULT_MAX_REVIEWS}
  --timeout=MS      Global parser timeout in milliseconds. Default: ${DEFAULT_TIMEOUT_MS}
  --debug           Write progress logs to stderr and save screenshots/HTML.
  --debug-dir=DIR   Directory for debug artifacts. Default: ${DEFAULT_DEBUG_DIR}
  --help, -h        Show this help.
`);
}

function assertYandexMapsUrl(url) {
  let parsedUrl;

  try {
    parsedUrl = new URL(url);
  } catch {
    throw new ParserError('INVALID_URL', 'Передана некорректная ссылка.', {
      source_url: url,
    });
  }

  if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
    throw new ParserError('INVALID_URL', 'Ссылка должна использовать http или https.', {
      protocol: parsedUrl.protocol,
    });
  }

  if (!isAllowedYandexHost(parsedUrl.hostname)) {
    throw new ParserError(
      'INVALID_HOST',
      'Ссылка должна вести на yandex.ru/maps или yandex.com/maps.',
      { host: parsedUrl.hostname }
    );
  }

  if (!parsedUrl.pathname.includes('/maps/')) {
    throw new ParserError(
      'INVALID_MAPS_URL',
      'Ссылка должна вести на карточку организации в Яндекс.Картах.',
      { pathname: parsedUrl.pathname }
    );
  }
}

function isAllowedYandexHost(hostname) {
  const normalized = hostname.toLowerCase();

  return (
    normalized === 'yandex.ru' ||
    normalized.endsWith('.yandex.ru') ||
    normalized === 'yandex.com' ||
    normalized.endsWith('.yandex.com')
  );
}

function tryExtractCompanyIdFromUrl(url) {
  let parsedUrl;

  try {
    parsedUrl = new URL(url);
  } catch {
    return null;
  }

  const pathId = tryExtractCompanyIdFromPath(parsedUrl.pathname);

  if (pathId) {
    return pathId;
  }

  const oidParam = parsedUrl.searchParams.get('oid');

  if (isValidCompanyId(oidParam)) {
    return oidParam;
  }

  const poiUri = parsedUrl.searchParams.get('poi[uri]');

  if (poiUri) {
    const idFromPoiUri = tryExtractCompanyIdFromLooseText(poiUri);

    if (idFromPoiUri) {
      return idFromPoiUri;
    }
  }

  const decodedUrl = safeDecode(url);
  const idFromDecodedUrl = tryExtractCompanyIdFromLooseText(decodedUrl);

  if (idFromDecodedUrl) {
    return idFromDecodedUrl;
  }

  return null;
}

function tryExtractCompanyIdFromPath(pathname) {
  if (!pathname) {
    return null;
  }

  const segments = pathname
    .split('/')
    .map((segment) => segment.trim())
    .filter(Boolean);

  const directId = segments.find(isValidCompanyId);

  return directId ?? null;
}

function tryExtractCompanyIdFromLooseText(value) {
  if (!value) {
    return null;
  }

  const variants = [
    value,
    safeDecode(value),
    safeDecode(safeDecode(value)),
  ];

  const patterns = [
    /[?&]oid=(\d{6,})/i,
    /oid=(\d{6,})/i,
    /oid%3D(\d{6,})/i,
    /org\?oid=(\d{6,})/i,
    /\/org\/[^/?#]+\/(\d{6,})(?:[/?#]|$)/i,
    /\/maps\/org\/[^/?#]+\/(\d{6,})(?:[/?#]|$)/i,
  ];

  for (const variant of variants) {
    for (const pattern of patterns) {
      const match = variant.match(pattern);

      if (match && isValidCompanyId(match[1])) {
        return match[1];
      }
    }
  }

  return null;
}

async function tryExtractCompanyIdFromPage(page) {
  const candidates = await page.evaluate(() => {
    const values = [];

    values.push(window.location.href);
    values.push(document.documentElement.innerHTML);

    document.querySelectorAll('a[href]').forEach((element) => {
      values.push(element.href);
      values.push(element.getAttribute('href'));
    });

    document.querySelectorAll('[data-bem], [data-id], [data-oid]').forEach((element) => {
      values.push(element.getAttribute('data-bem'));
      values.push(element.getAttribute('data-id'));
      values.push(element.getAttribute('data-oid'));
    });

    return values.filter(Boolean);
  });

  for (const candidate of candidates) {
    const companyId = tryExtractCompanyIdFromLooseText(candidate);

    if (companyId) {
      return companyId;
    }
  }

  return null;
}

function isValidCompanyId(value) {
  return typeof value === 'string' && /^\d{6,}$/.test(value);
}

function safeDecode(value) {
  if (!value) {
    return '';
  }

  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

async function waitForMapCard(page) {
  const possibleSelectors = [
    '[class*="business-card"]',
    '[class*="business-"]',
    '[class*="card"]',
    'h1',
  ];

  for (const selector of possibleSelectors) {
    const element = page.locator(selector).first();

    try {
      await element.waitFor({
        state: 'visible',
        timeout: 15000,
      });

      return;
    } catch {
      // пробуем следующий селектор
    }
  }

  throw new ParserError(
    'CARD_NOT_LOADED',
    'Не удалось дождаться загрузки карточки организации.',
    { url: page.url() }
  );
}

async function parseOrganizationInfo(page, companyId) {
  const name = await extractOrganizationName(page);
  const rating = await extractRating(page);
  const ratingCount = await extractRatingCount(page);

  return {
    yandexCompanyId: companyId,
    name,
    rating,
    ratingCount,
  };
}

async function extractOrganizationName(page) {
  const selectors = [
    'h1',
    '[class*="business-card-title-view__title"]',
    '[class*="card-title-view__title"]',
    '[class*="orgpage-header-view__header"] h1',
  ];

  for (const selector of selectors) {
    const value = await getTextBySelector(page, selector);

    if (value) {
      return normalizeText(value);
    }
  }

  return null;
}

async function extractRating(page) {
  const selectors = [
    '[class*="business-summary-rating-badge-view__rating"]',
    '[class*="rating-badge-view__rating"]',
    '[class*="business-rating-badge-view__rating"]',
    '[aria-label*="Рейтинг"]',
    '[aria-label*="рейтинг"]',
  ];

  for (const selector of selectors) {
    const value = await getTextBySelector(page, selector);
    const rating = parseRating(value);

    if (rating !== null) {
      return rating;
    }
  }

  const candidateTexts = await page.evaluate(() => {
    const texts = [];
    const selectorsToScan = [
      '[class*="rating"]',
      '[class*="Rating"]',
      '[aria-label*="Рейтинг"]',
      '[aria-label*="рейтинг"]',
    ];

    for (const selector of selectorsToScan) {
      document.querySelectorAll(selector).forEach((element) => {
        const text = [
          element.getAttribute('aria-label') || '',
          element.getAttribute('title') || '',
          element.textContent || '',
        ].join(' ');

        if (/рейтинг|rating/i.test(text)) {
          texts.push(text);
        }
      });
    }

    return texts;
  });

  for (const text of candidateTexts) {
    const rating = parseRating(text);

    if (rating !== null) {
      return rating;
    }
  }

  return null;
}

async function extractRatingCount(page) {
  const directSelectors = [
    '[class*="business-summary-rating-badge-view__rating-count"]',
    '[class*="business-rating-amount-view"]',
    '[class*="business-summary-rating"]',
  ];

  for (const selector of directSelectors) {
    const value = await getTextBySelector(page, selector);
    const count = parseRatingCountFromText(value);

    if (count !== null) {
      return count;
    }
  }

  const candidateTexts = await page.evaluate(() => {
    const texts = [];
    const selectorsToScan = [
      '[class*="business-summary-rating-badge-view__rating-count"]',
      '[class*="business-rating-amount-view"]',
      '[class*="business-summary-rating"]',
      '[class*="business-rating"]',
      '[class*="rating"]',
      '[aria-label*="оцен"]',
      '[aria-label*="Оцен"]',
      '[aria-label*="рейтинг"]',
      '[aria-label*="Рейтинг"]',
      'button',
      'a',
    ];

    for (const selector of selectorsToScan) {
      document.querySelectorAll(selector).forEach((element) => {
        const text = [
          element.getAttribute('aria-label') || '',
          element.getAttribute('title') || '',
          element.innerText || '',
        ].join(' ');

        if (
          selector.includes('rating-count') ||
          selector.includes('rating-amount') ||
          /оцен|рейтинг/i.test(text)
        ) {
          texts.push(text);
        }
      });
    }

    return texts;
  });

  for (const text of candidateTexts) {
    const count = parseRatingCountFromText(text);

    if (count !== null) {
      return count;
    }
  }

  return null;
}

function parseRatingCountFromText(text) {
  if (!text) {
    return null;
  }

  const lines = text
    .split(/\n/)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean);

  const patterns = [
    /(\d[\d\s]*)\s+оцен(?:ка|ки|ок)(?=\s|$)/i,
    /(\d[\d\s]*)\s+рейтинг(?:ов|а)?(?=\s|$)/i,
  ];

  for (const line of lines) {
    for (const pattern of patterns) {
      const match = line.match(pattern);

      if (match) {
        return Number(match[1].replace(/\s+/g, ''));
      }
    }
  }

  return null;
}

async function extractReviewCountFromReviewsPage(page) {
  const candidateTexts = await page.evaluate(() => {
    const selectors = [
      '[role="tab"]',
      'a[href*="reviews"]',
      '[class*="tabs"]',
      '[class*="business-card-title-view"]',
      '[class*="business-reviews-card-view__title"]',
      '[class*="business-reviews-card-view__header"]',
      '[class*="business-reviews-card__title"]',
      '[class*="reviews-card__title"]',
      '[class*="reviews-card__header"]',
    ];

    const texts = [];

    for (const selector of selectors) {
      document.querySelectorAll(selector).forEach((element) => {
        const text = [
          element.getAttribute('aria-label') || '',
          element.getAttribute('title') || '',
          element.innerText || '',
        ].join(' ');

        if (text && /отзыв/i.test(text)) {
          texts.push(text);
        }
      });
    }

    return texts;
  });

  for (const text of candidateTexts) {
    const count = parseReviewCountFromText(text);

    if (count !== null) {
      return count;
    }
  }

  return null;
}

function parseReviewCountFromText(text) {
  if (!text) {
    return null;
  }

  const lines = text
    .split(/\n/)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .filter((line) => /отзыв/i.test(line));

  const patterns = [
    /\bОтзывы\s+(\d[\d\s]*)\b/i,
    /^Отзывы\s+(\d[\d\s]*)$/i,
    /^Отзывы\s*\(?(\d[\d\s]*)\)?$/i,
    /^(\d[\d\s]*)\s+отзыв(?:ов|а)?$/i,
    /^(\d[\d\s]*)\s+отзыв(?:ов|а)?\s+пользовател/i,
    /\b(\d[\d\s]*)\s+отзыв(?:ов|а)?\b/i,
  ];

  for (const line of lines) {
    for (const pattern of patterns) {
      const match = line.match(pattern);

      if (match) {
        return Number(match[1].replace(/\s+/g, ''));
      }
    }
  }

  return null;
}

async function openReviewsTab(page, companyId, state) {
  const reviewTabCandidates = [
    page.locator('[role="tab"]').filter({ hasText: /Отзывы/i }).first(),
    page.locator('button').filter({ hasText: /Отзывы/i }).first(),
    page.locator('a[href*="reviews"]').first(),
    page.getByText(/Отзывы/i).first(),
  ];

  for (const candidate of reviewTabCandidates) {
    try {
      if (await candidate.isVisible({ timeout: 3000 })) {
        await candidate.click({ timeout: getActionTimeout(state) });
        await page.waitForTimeout(2500);

        if (await hasReviewsSurface(page)) {
          return;
        }
      }
    } catch {
      // пробуем следующий вариант
    }
  }

  const reviewUrl = buildReviewsUrl(page.url(), companyId);

  if (reviewUrl) {
    try {
      await page.goto(reviewUrl, {
        waitUntil: 'domcontentloaded',
        timeout: getActionTimeout(state),
      });
      await page.waitForTimeout(3000);

      if (await hasReviewsSurface(page)) {
        return;
      }
    } catch {
      // ниже бросаем структурированную ошибку
    }
  }

  throw new ParserError(
    'REVIEWS_TAB_NOT_FOUND',
    'Не удалось открыть вкладку с отзывами.',
    { url: page.url(), company_id: companyId }
  );
}

async function hasReviewsSurface(page) {
  return await page.evaluate(() => {
    const reviewNodes = document.querySelectorAll(
      '[class~="business-reviews-card-view__review"], [class*="business-reviews-card-view__review"], [class*="business-review-view"]'
    );
    const text = document.body?.innerText || '';

    return (
      /\/reviews(?:[/?#]|$)/i.test(window.location.href) ||
      reviewNodes.length > 0 ||
      /Показать полностью|Читать полностью|Ответить|Сначала новые|Сначала полезные|Отзывы пользователей|Нет отзывов/i.test(text)
    );
  }).catch(() => /\/reviews(?:[/?#]|$)/i.test(page.url()));
}

function buildReviewsUrl(currentUrl, companyId) {
  try {
    const url = new URL(currentUrl);

    if (url.pathname.includes('/maps/org/')) {
      if (!url.pathname.endsWith('/reviews')) {
        url.pathname = url.pathname.replace(/\/$/, '') + '/reviews';
      }

      return url.toString();
    }

    if (isValidCompanyId(companyId)) {
      return `${url.origin}/maps/org/${companyId}/reviews`;
    }

    return null;
  } catch {
    return null;
  }
}

async function collectReviews(page, maxReviews, state) {
  const scrollContainer = await findReviewsScrollContainer(page);

  if (!scrollContainer) {
    throw new ParserError(
      'REVIEWS_CONTAINER_NOT_FOUND',
      'Не удалось найти контейнер со списком отзывов.',
      { url: page.url() }
    );
  }

  const seenHashes = new Set();
  let reviews = [];
  let stableIterations = 0;
  let previousCount = 0;

  for (let iteration = 0; iteration < SCROLL_ITERATION_LIMIT; iteration += 1) {
    ensureNotTimedOut(state);
    await clickExpandReviewTexts(page);
    await clickLoadMoreReviews(page);

    const currentReviews = await extractVisibleReviews(page);

    for (const review of currentReviews) {
      const preparedReview = normalizeReview(review);

      if (!preparedReview) {
        continue;
      }

      const hash = createReviewHash(preparedReview);

      if (!seenHashes.has(hash)) {
        seenHashes.add(hash);
        reviews.push(preparedReview);
      }
    }

    if (reviews.length >= maxReviews) {
      reviews = reviews.slice(0, maxReviews);
      break;
    }

    if (reviews.length === previousCount) {
      stableIterations += 1;
    } else {
      stableIterations = 0;
    }

    previousCount = reviews.length;

    if (stableIterations >= 8) {
      break;
    }

    await scrollReviewsContainer(page, scrollContainer);
    await page.waitForTimeout(1200);
  }

  return reviews;
}

async function clickExpandReviewTexts(page) {
  await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll('button, span, div'));

    for (const button of buttons) {
      const text = button.innerText?.replace(/\s+/g, ' ').trim();

      if (/^(Ещё|Показать полностью|Читать полностью)$/i.test(text)) {
        try {
          button.click();
        } catch {
          // ignore
        }
      }
    }
  });

  await page.waitForTimeout(300);
}

async function clickLoadMoreReviews(page) {
  const clicked = await page.evaluate(() => {
    const elements = Array.from(document.querySelectorAll('button, a, span, div'));

    for (const element of elements) {
      const text = element.innerText?.replace(/\s+/g, ' ').trim();

      if (!text) {
        continue;
      }

      if (!/^(Посмотреть все \d[\d\s]* отзыв(?:ов|а)?|Показать ещё|Ещё отзывы)$/i.test(text)) {
        continue;
      }

      const clickable = element.closest('button, a, [role="button"]') || element;

      try {
        clickable.click();
        return true;
      } catch {
        return false;
      }
    }

    return false;
  });

  if (clicked) {
    await page.waitForTimeout(1500);
  }
}

async function findReviewsScrollContainer(page) {
  const selectors = [
    '[class*="business-reviews-card-view"]',
    '[class*="business-reviews-card"]',
    '[class*="reviews-card"]',
    '[class*="reviews"]',
    '[class*="scroll__container"]',
    '[class*="scrollable"]',
    '[class*="sidebar-view"]',
  ];

  for (const selector of selectors) {
    const locator = page.locator(selector).first();

    try {
      const isVisible = await locator.isVisible({ timeout: 3000 });

      if (!isVisible) {
        continue;
      }

      const text = await locator.innerText({ timeout: 3000 }).catch(() => '');

      if (isReviewsListText(text)) {
        return selector;
      }
    } catch {
      // пробуем следующий селектор
    }
  }

  const bodyText = await page.locator('body').innerText({ timeout: 3000 }).catch(() => '');

  if (isReviewsListText(bodyText)) {
    return 'body';
  }

  return null;
}

function isReviewsListText(text) {
  return /Показать полностью|Читать полностью|Ответить|Сначала новые|Сначала полезные|Отзывы пользователей|Нет отзывов|По умолчанию|Посмотреть все \d[\d\s]* отзыв|\b\d[\d\s]* отзыв(?:ов|а)?\b/i.test(text);
}

async function scrollReviewsContainer(page, selector) {
  await page.evaluate((containerSelector) => {
    const container = document.querySelector(containerSelector);

    if (container && container !== document.body) {
      container.scrollTop = container.scrollHeight;
      container.dispatchEvent(new Event('scroll', { bubbles: true }));
      return;
    }

    window.scrollTo(0, document.body.scrollHeight);
  }, selector);

  await page.mouse.wheel(0, 2200);
}

async function extractVisibleReviews(page) {
  return await page.evaluate(() => {
    const reviewNodes = findReviewNodes();

    return reviewNodes
      .map((node) => {
        const lines = getVisibleLines(node);

        const author = extractAuthor(node, lines);
        const date = extractDate(node, lines);
        const text = extractReviewText(node, lines, author, date);
        const rating = getRatingFromNode(node);
        const companyResponse = extractCompanyResponse(node);

        return {
          author,
          date,
          text,
          rating,
          company_response: companyResponse,
        };
      })
      .filter((review) => {
        return isUsefulReview(review);
      });

    function findReviewNodes() {
      const strictSelectors = [
        '[class~="business-reviews-card-view__review"]',
        '[class*="business-reviews-card-view__review"]',
      ];

      for (const selector of strictSelectors) {
        const nodes = Array.from(document.querySelectorAll(selector));

        if (nodes.length > 0) {
          return uniqueNodes(nodes);
        }
      }

      const fallbackNodes = Array.from(
        document.querySelectorAll('[class*="business-review-view"]')
      ).filter((node) => {
        const text = node.innerText || '';

        return (
          text.length > 40 &&
          hasDateLikeText(text) &&
          !isJustServiceText(text)
        );
      });

      return removeNestedNodes(uniqueNodes(fallbackNodes));
    }

    function extractAuthor(root, lines) {
      const selectors = [
        '[class*="business-review-view__author-name"]',
        '[class*="business-review-view__user-name"]',
        '[class*="review-view__author-name"]',
        '[class*="author-name"]',
        'a[href*="/user/"] span',
        'a[href*="/user/"]',
      ];

      for (const selector of selectors) {
        const value = getFirstText(root, [selector]);
        const cleaned = cleanAuthor(value);

        if (cleaned) {
          return cleaned;
        }
      }

      for (const line of lines) {
        const cleaned = cleanAuthor(line);

        if (
          cleaned &&
          !hasDateLikeText(cleaned) &&
          !isServiceLine(cleaned) &&
          cleaned.length <= 80
        ) {
          return cleaned;
        }
      }

      return null;
    }

    function extractDate(root, lines) {
      const selectors = [
        '[class*="business-review-view__date"]',
        '[class*="review-view__date"]',
        '[class*="date"]',
        'time',
      ];

      for (const selector of selectors) {
        const value = getFirstText(root, [selector]);
        const cleaned = cleanText(value);

        if (cleaned && hasDateLikeText(cleaned)) {
          return cleaned;
        }
      }

      return lines.find(hasDateLikeText) ?? null;
    }

    function extractReviewText(root, lines, author, date) {
      const selectors = [
        '[class*="business-review-view__body-text"]',
        '[class*="business-review-view__body"]',
        '[class*="review-view__body-text"]',
        '[itemprop="reviewBody"]',
        '[data-testid*="review-text"]',
      ];

      for (const selector of selectors) {
        const value = getFirstText(root, [selector]);
        const cleaned = cleanReviewText(value);

        if (cleaned) {
          return cleaned;
        }
      }

      const candidates = lines
        .map(cleanReviewText)
        .filter(Boolean)
        .filter((line) => line !== author)
        .filter((line) => line !== date)
        .filter((line) => !hasDateLikeText(line))
        .filter((line) => !isServiceLine(line))
        .filter((line) => !isProfileLevelLine(line))
        .filter((line) => !isRatingLine(line));

      if (candidates.length === 0) {
        return null;
      }

      candidates.sort((a, b) => b.length - a.length);

      return candidates[0];
    }

    function extractCompanyResponse(root) {
      const selectors = [
        '[class*="business-review-view__comment"]',
        '[class*="business-review-view__reply"]',
        '[class*="review-view__reply"]',
        '[class*="reply"]',
      ];

      for (const selector of selectors) {
        const value = getFirstText(root, [selector]);
        const cleaned = cleanReviewText(value);

        if (cleaned) {
          return cleaned;
        }
      }

      return null;
    }

    function getFirstText(root, selectors) {
      for (const selector of selectors) {
        const element = root.querySelector(selector);

        if (!element) {
          continue;
        }

        const ariaLabel = element.getAttribute('aria-label');
        const datetime = element.getAttribute('datetime');
        const innerText = element.innerText;

        if (datetime) {
          return datetime;
        }

        if (innerText) {
          return innerText;
        }

        if (ariaLabel) {
          return ariaLabel;
        }
      }

      return null;
    }

    function getVisibleLines(root) {
      return (root.innerText || '')
        .split('\n')
        .map(cleanText)
        .filter(Boolean);
    }

    function cleanAuthor(value) {
      if (!value) {
        return null;
      }

      let text = cleanText(value);

      text = text
        .replace(/\bПодписаться\b/gi, '')
        .replace(/\bВы подписаны\b/gi, '')
        .replace(/\bЗнаток города\s+\d+\s+уровня\b/gi, '')
        .replace(/\bДегустатор\s+\d+\s+уровня\b/gi, '')
        .replace(/\bНовичок\s+\d+\s+уровня\b/gi, '')
        .replace(/\bМастер\s+\d+\s+уровня\b/gi, '')
        .replace(/\s+/g, ' ')
        .trim();

      if (!text || isServiceLine(text) || hasDateLikeText(text)) {
        return null;
      }

      return text;
    }

    function cleanReviewText(value) {
      if (!value) {
        return null;
      }

      let text = cleanText(value);

      text = text
        .replace(/^Ещё$/i, '')
        .replace(/^Показать полностью$/i, '')
        .replace(/^Читать полностью$/i, '')
        .trim();

      if (!text) {
        return null;
      }

      if (isServiceLine(text)) {
        return null;
      }

      if (isProfileLevelLine(text)) {
        return null;
      }

      if (isRatingLine(text)) {
        return null;
      }

      return text;
    }

    function getRatingFromNode(root) {
      const ariaElements = Array.from(root.querySelectorAll('[aria-label]'));

      for (const element of ariaElements) {
        const ariaLabel = element.getAttribute('aria-label') || '';
        const rating = parseRatingFromString(ariaLabel);

        if (rating !== null) {
          return rating;
        }
      }

      const ratingElements = Array.from(
        root.querySelectorAll('[class*="rating"], [class*="star"]')
      );

      for (const element of ratingElements) {
        const text = [
          element.getAttribute('aria-label') || '',
          element.getAttribute('title') || '',
          element.innerText || '',
        ].join(' ');

        const rating = parseRatingFromString(text);

        if (rating !== null) {
          return rating;
        }
      }

      return null;
    }

    function parseRatingFromString(value) {
      if (!value) {
        return null;
      }

      const normalized = value.replace(',', '.');

      const patterns = [
        /(\d(?:\.\d)?)\s*из\s*5/i,
        /оценка\s*(\d(?:\.\d)?)/i,
        /(\d(?:\.\d)?)\s*зв/i,
      ];

      for (const pattern of patterns) {
        const match = normalized.match(pattern);

        if (match) {
          const rating = Number(match[1]);

          if (rating >= 1 && rating <= 5) {
            return rating;
          }
        }
      }

      return null;
    }

    function isUsefulReview(review) {
      if (!review) {
        return false;
      }

      if (!review.text) {
        return false;
      }

      if (isServiceLine(review.text)) {
        return false;
      }

      if (review.text.length < 2) {
        return false;
      }

      return true;
    }

    function isServiceLine(value) {
      if (!value) {
        return true;
      }

      const text = cleanText(value);

      return /^(Подписаться|Вы подписаны|Ещё|Показать полностью|Читать полностью|Нравится|Ответить|Пожаловаться|Поделиться)$/i.test(
        text
      );
    }

    function isProfileLevelLine(value) {
      if (!value) {
        return false;
      }

      return /(?:Знаток города|Дегустатор|Новичок|Мастер)\s+\d+\s+уровня/i.test(
        value
      );
    }

    function isRatingLine(value) {
      if (!value) {
        return false;
      }

      return /(?:оценка|рейтинг|звезд|звёзд)\s*\d|^\d\s*из\s*5/i.test(value);
    }

    function hasDateLikeText(value) {
      if (!value) {
        return false;
      }

      return /(?:\d{1,2}\s+(?:января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря)(?:\s+\d{4})?)|(?:\d{4}-\d{2}-\d{2})/i.test(
        value
      );
    }

    function isJustServiceText(value) {
      const text = cleanText(value);

      if (!text) {
        return true;
      }

      const serviceWords = [
        'Подписаться',
        'Ещё',
        'Показать полностью',
        'Читать полностью',
      ];

      return serviceWords.includes(text);
    }

    function removeNestedNodes(nodes) {
      return nodes.filter((node) => {
        return !nodes.some((other) => {
          return other !== node && other.contains(node);
        });
      });
    }

    function uniqueNodes(nodes) {
      return Array.from(new Set(nodes));
    }

    function cleanText(value) {
      if (!value) {
        return null;
      }

      return value.replace(/\s+/g, ' ').trim();
    }
  });
}

function buildResult({
  organization,
  reviews,
  sourceUrl,
  finalUrl,
  maxReviews,
  reviewCountFromPage,
  startedAt,
  warnings,
}) {
  const normalizedReviews = dedupeReviews(
    reviews
      .map(normalizeReview)
      .filter(Boolean)
  );

  const organizationResult = {
    yandex_company_id: organization.yandexCompanyId,
    name: normalizeText(organization.name),
    rating: normalizeNullableNumber(organization.rating),
    rating_count: normalizeNullableInteger(organization.ratingCount),
    review_count: normalizeNullableInteger(reviewCountFromPage),
  };

  if (organizationResult.rating === null) {
    warnings.push('RATING_NOT_FOUND');
  }

  if (organizationResult.rating_count === null) {
    warnings.push('RATING_COUNT_NOT_FOUND');
  }

  if (organizationResult.review_count === null) {
    warnings.push('REVIEW_COUNT_NOT_FOUND');
  }

  if (normalizedReviews.length === 0) {
    warnings.push('NO_TEXT_REVIEWS_FOUND');
  }

  if (
    organizationResult.review_count !== null &&
    normalizedReviews.length < organizationResult.review_count
  ) {
    warnings.push('ONLY_PARTIAL_REVIEWS_PARSED');
  }

  return {
    organization: organizationResult,
    reviews: normalizedReviews,
    meta: {
      source_url: sourceUrl,
      final_url: finalUrl,
      parsed_reviews_count: normalizedReviews.length,
      max_reviews: maxReviews,
      duration_ms: Date.now() - startedAt,
      parsed_at: new Date().toISOString(),
      warnings: uniqueStrings(warnings),
    },
  };
}

function validateResult(result) {
  const invalidReasons = [];
  const organization = result?.organization;

  if (!organization || typeof organization !== 'object') {
    invalidReasons.push('organization must be an object');
  } else {
    if (!isValidCompanyId(organization.yandex_company_id)) {
      invalidReasons.push('organization.yandex_company_id must be filled');
    }

    if (typeof organization.name !== 'string' || organization.name.trim() === '') {
      invalidReasons.push('organization.name must be filled');
    }

    if (!isNullableNumberInRange(organization.rating, 1, 5)) {
      invalidReasons.push('organization.rating must be null or number from 1 to 5');
    }

    if (!isNullableNonNegativeInteger(organization.rating_count)) {
      invalidReasons.push('organization.rating_count must be null or number >= 0');
    }

    if (!isNullableNonNegativeInteger(organization.review_count)) {
      invalidReasons.push('organization.review_count must be null or number >= 0');
    }
  }

  if (!Array.isArray(result?.reviews)) {
    invalidReasons.push('reviews must be an array');
  } else {
    result.reviews.forEach((review, index) => {
      if (!isValidReview(review)) {
        invalidReasons.push(`reviews[${index}] has invalid shape`);
      }
    });
  }

  if (!result?.meta || !Array.isArray(result.meta.warnings)) {
    invalidReasons.push('meta.warnings must be an array');
  }

  if (invalidReasons.length > 0) {
    throw new ParserError(
      'INVALID_RESULT',
      'Итоговый результат не прошёл валидацию.',
      { reasons: invalidReasons }
    );
  }
}

function isValidReview(review) {
  if (!review || typeof review !== 'object') {
    return false;
  }

  return (
    (typeof review.author === 'string' || review.author === null) &&
    (typeof review.date === 'string' || review.date === null) &&
    typeof review.text === 'string' &&
    review.text.trim() !== '' &&
    !isServiceText(review.text) &&
    isNullableNumberInRange(review.rating, 1, 5) &&
    (typeof review.company_response === 'string' || review.company_response === null)
  );
}

function normalizeReview(review) {
  if (!review || typeof review !== 'object') {
    return null;
  }

  const text = cleanReviewTextOutside(review.text);

  if (!text) {
    return null;
  }

  const normalized = {
    author: cleanAuthorOutside(review.author),
    date: normalizeNullableString(review.date),
    text,
    rating: normalizeNullableNumber(review.rating),
    company_response: cleanReviewTextOutside(review.company_response),
  };

  if (!isNullableNumberInRange(normalized.rating, 1, 5)) {
    normalized.rating = null;
  }

  return normalized;
}

function dedupeReviews(reviews) {
  const seenHashes = new Set();
  const result = [];

  for (const review of reviews) {
    const hash = createReviewHash(review);

    if (seenHashes.has(hash)) {
      continue;
    }

    seenHashes.add(hash);
    result.push(review);
  }

  return result;
}

function cleanAuthorOutside(value) {
  const text = normalizeNullableString(value);

  if (!text) {
    return null;
  }

  const cleaned = text
    .replace(/\bПодписаться\b/gi, '')
    .replace(/\bВы подписаны\b/gi, '')
    .replace(/\bЗнаток города\s+\d+\s+уровня\b/gi, '')
    .replace(/\bДегустатор\s+\d+\s+уровня\b/gi, '')
    .replace(/\bНовичок\s+\d+\s+уровня\b/gi, '')
    .replace(/\bМастер\s+\d+\s+уровня\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (!cleaned || isServiceText(cleaned)) {
    return null;
  }

  return cleaned;
}

function cleanReviewTextOutside(value) {
  const text = normalizeNullableString(value);

  if (!text || isServiceText(text) || isProfileLevelText(text)) {
    return null;
  }

  return text;
}

function isServiceText(value) {
  const text = normalizeText(value);
  return !text || SERVICE_TEXTS.some((serviceText) => serviceText.toLowerCase() === text.toLowerCase());
}

function isProfileLevelText(value) {
  return /(?:Знаток города|Дегустатор|Новичок|Мастер)\s+\d+\s+уровня/i.test(value);
}

async function assertNotYandexBlocked(page) {
  const evidence = await page.evaluate(() => {
    const bodyText = document.body?.innerText || '';
    const title = document.title || '';

    return `${title}\n${bodyText}`.slice(0, 50000);
  }).catch(() => '');

  const blockPatterns = [
    /captcha/i,
    /Введите символы/i,
    /Подтвердите,?\s+что вы не робот/i,
    /Доступ ограничен/i,
    /\brobot\b/i,
  ];

  for (const pattern of blockPatterns) {
    if (pattern.test(evidence)) {
      throw new ParserError(
        'YANDEX_BLOCKED',
        'Похоже, Яндекс показал капчу или антибот-страницу.',
        { matched: pattern.source, url: page.url() }
      );
    }
  }
}

async function getTextBySelector(page, selector) {
  try {
    const locator = page.locator(selector).first();

    if (await locator.isVisible({ timeout: 2000 })) {
      return await locator.innerText();
    }

    return null;
  } catch {
    return null;
  }
}

function normalizeText(value) {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized || null;
}

function normalizeNullableString(value) {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value !== 'string') {
    return null;
  }

  return normalizeText(value);
}

function normalizeNullableNumber(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const number = Number(value);

  if (!Number.isFinite(number)) {
    return null;
  }

  return number;
}

function normalizeNullableInteger(value) {
  const number = normalizeNullableNumber(value);

  if (number === null) {
    return null;
  }

  return Number.isInteger(number) ? number : null;
}

function parseRating(value) {
  if (!value) {
    return null;
  }

  const normalized = String(value).replace(',', '.');

  const patterns = [
    /рейтинг[^\d]{0,20}(\d(?:\.\d)?)/i,
    /(\d(?:\.\d)?)\s*из\s*5/i,
    /^(\d(?:\.\d)?)$/,
    /\b([1-5](?:\.\d)?)\b/,
  ];

  for (const pattern of patterns) {
    const match = normalized.match(pattern);

    if (!match) {
      continue;
    }

    const rating = Number(match[1]);

    if (rating >= 1 && rating <= 5) {
      return rating;
    }
  }

  return null;
}

function isNullableNumberInRange(value, min, max) {
  if (value === null) {
    return true;
  }

  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
}

function isNullableNonNegativeInteger(value) {
  if (value === null) {
    return true;
  }

  return Number.isInteger(value) && value >= 0;
}

function createReviewHash(review) {
  const source = [
    review.author ?? '',
    review.date ?? '',
    review.text ?? '',
    review.rating ?? '',
  ].join('|');

  return createHash('sha1').update(source).digest('hex');
}

function uniqueStrings(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

function getActionTimeout(state) {
  const remaining = state.deadlineAt - Date.now();

  if (remaining <= 0) {
    throw new ParserError(
      'PARSER_TIMEOUT',
      `Превышено общее время работы парсера: ${state.deadlineAt - state.startedAt} мс.`,
      { timeout_ms: state.deadlineAt - state.startedAt }
    );
  }

  return Math.max(1000, remaining);
}

function ensureNotTimedOut(state) {
  if (Date.now() >= state.deadlineAt) {
    throw new ParserError(
      'PARSER_TIMEOUT',
      `Превышено общее время работы парсера: ${state.deadlineAt - state.startedAt} мс.`,
      { timeout_ms: state.deadlineAt - state.startedAt }
    );
  }
}

function isPlaywrightTimeout(error) {
  return error instanceof playwrightErrors.TimeoutError;
}

async function closeBrowser(browser, debug) {
  if (!browser) {
    return;
  }

  try {
    await browser.close();
  } catch (error) {
    debugLog(debug, `Browser close failed: ${error.message}`);
  }
}

function getBootstrapDebugState(args) {
  const debug = {
    enabled: args.includes('--debug'),
    dir: path.resolve(DEFAULT_DEBUG_DIR),
  };

  const debugDirArg = args.find((arg) => arg.startsWith('--debug-dir='));

  if (debugDirArg) {
    const value = debugDirArg.slice('--debug-dir='.length).trim();

    if (value) {
      debug.dir = path.resolve(value);
    }
  }

  return debug;
}

async function prepareDebugDir(debug) {
  if (!debug.enabled) {
    return;
  }

  await fs.mkdir(debug.dir, { recursive: true });
}

function debugLog(debug, message) {
  if (!debug?.enabled) {
    return;
  }

  console.error(`[debug] ${new Date().toISOString()} ${message}`);
}

async function saveDebugPage(page, debug, basename) {
  if (!debug?.enabled) {
    return;
  }

  await prepareDebugDir(debug);

  const screenshotPath = path.join(debug.dir, `${basename}.png`);
  const htmlPath = path.join(debug.dir, `${basename}.html`);

  try {
    await page.screenshot({ path: screenshotPath, fullPage: true });
    debugLog(debug, `Saved ${screenshotPath}`);
  } catch (error) {
    debugLog(debug, `Failed to save screenshot ${screenshotPath}: ${error.message}`);
  }

  try {
    const html = await page.content();
    await fs.writeFile(htmlPath, html, 'utf8');
    debugLog(debug, `Saved ${htmlPath}`);
  } catch (error) {
    debugLog(debug, `Failed to save HTML ${htmlPath}: ${error.message}`);
  }
}

async function writeDebugJson(debug, filename, payload) {
  if (!debug?.enabled) {
    return;
  }

  try {
    await prepareDebugDir(debug);
    const filePath = path.join(debug.dir, filename);
    await fs.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
    debugLog(debug, `Saved ${filePath}`);
  } catch (error) {
    debugLog(debug, `Failed to save debug JSON ${filename}: ${error.message}`);
  }
}

function createErrorEnvelope(error) {
  if (error instanceof ParserError) {
    return {
      error: {
        code: ERROR_CODES.has(error.code) ? error.code : 'UNKNOWN_ERROR',
        message: error.message,
        details: error.details ?? {},
      },
    };
  }

  return {
    error: {
      code: 'UNKNOWN_ERROR',
      message: error?.message || 'Unexpected parser error.',
      details: {
        name: error?.name ?? 'Error',
      },
    },
  };
}

class ParserError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'ParserError';
    this.code = code;
    this.details = details;
  }
}

await bootstrap();

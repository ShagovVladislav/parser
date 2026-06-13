import { chromium } from 'playwright';

const DEFAULT_MAX_REVIEWS = 600;
const DEFAULT_TIMEOUT = 60000;

const inputUrl = process.argv[2];
const maxReviewsArg = Number(process.argv[3]);

const maxReviews = Number.isFinite(maxReviewsArg)
  ? maxReviewsArg
  : DEFAULT_MAX_REVIEWS;

if (!inputUrl) {
  printErrorAndExit('Usage: node yandex-parser.js <yandex-maps-url> [maxReviews]');
}

async function main() {
assertYandexMapsUrl(inputUrl);

let companyId = tryExtractCompanyIdFromUrl(inputUrl);

const browser = await chromium.launch({
  headless: true,
  args: [
    '--no-sandbox',
    '--disable-dev-shm-usage',
    '--disable-setuid-sandbox',
  ],
});
  try {
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

    page.setDefaultTimeout(DEFAULT_TIMEOUT);

await page.goto(inputUrl, {
  waitUntil: 'domcontentloaded',
  timeout: DEFAULT_TIMEOUT,
});

await page.waitForTimeout(2500);

if (!companyId) {
  companyId = tryExtractCompanyIdFromUrl(page.url());
}

if (!companyId) {
  companyId = await tryExtractCompanyIdFromPage(page);
}

if (!companyId) {
  throw new ParserError(
    'COMPANY_ID_NOT_FOUND',
    'Не удалось определить ID организации из ссылки или открытой страницы.'
  );
}

await waitForMapCard(page);

const organization = await parseOrganizationInfo(page, companyId);

await openReviewsTab(page);

const reviewCountFromPage = await extractReviewCountFromReviewsPage(page);

const reviews = await collectReviews(page, maxReviews);

const result = {
  organization: {
    yandex_company_id: companyId,
    name: organization.name,
    rating: organization.rating,
    rating_count: organization.ratingCount,
    review_count: reviewCountFromPage ?? reviews.length,
    },
  reviews,
  meta: {
      source_url: inputUrl,
      parsed_reviews_count: reviews.length,
      max_reviews: maxReviews,
      parsed_at: new Date().toISOString(),
  },
};

    console.log(JSON.stringify(result, null, 2));
  } finally {
    await browser.close();
  }
}

function assertYandexMapsUrl(url) {
  let parsedUrl;

  try {
    parsedUrl = new URL(url);
  } catch {
    throw new ParserError('INVALID_URL', 'Передана некорректная ссылка.');
  }

  const allowedHosts = [
    'yandex.ru',
    'www.yandex.ru',
    'yandex.com',
    'www.yandex.com',
  ];

  if (!allowedHosts.includes(parsedUrl.hostname)) {
    throw new ParserError(
      'INVALID_HOST',
      'Ссылка должна вести на yandex.ru/maps или yandex.com/maps.'
    );
  }

  if (!parsedUrl.pathname.includes('/maps/')) {
    throw new ParserError(
      'INVALID_MAPS_URL',
      'Ссылка должна вести на карточку организации в Яндекс.Картах.'
    );
  }
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
    'Не удалось дождаться загрузки карточки организации.'
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
  ];

  for (const selector of selectors) {
    const value = await getTextBySelector(page, selector);
    const rating = parseRating(value);

    if (rating !== null) {
      return rating;
    }
  }

  const bodyText = await page.locator('body').innerText().catch(() => '');
  return parseRating(bodyText);
}

async function extractRatingCount(page) {
  const bodyText = await page.locator('body').innerText().catch(() => '');

  const patterns = [
    /(\d[\d\s]*)\s+оцен(?:ка|ки|ок)/i,
    /(\d[\d\s]*)\s+рейтинг/i,
  ];

  return parseNumberByPatterns(bodyText, patterns);
}

async function extractReviewCountFromReviewsPage(page) {
  const candidateTexts = await page.evaluate(() => {
    const selectors = [
      'button',
      'a',
      '[role="tab"]',
      '[class*="tabs"]',
      '[class*="business-card-title-view"]',
      '[class*="business-reviews-card"]',
    ];

    const texts = [];

    for (const selector of selectors) {
      document.querySelectorAll(selector).forEach((element) => {
        const text = element.innerText;

        if (text && /отзыв/i.test(text)) {
          texts.push(text);
        }
      });
    }

    const bodyText = document.body?.innerText;

    if (bodyText) {
      texts.push(bodyText);
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
    .filter(Boolean);

  const patterns = [
    /^Отзывы\s+(\d[\d\s]*)$/i,
    /^(\d[\d\s]*)\s+отзыв(?:ов|а)?$/i,
    /^(\d[\d\s]*)\s+отзыв(?:ов|а)?\s+пользовател/i,
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

async function openReviewsTab(page) {
  const reviewTabCandidates = [
    page.getByText(/Отзывы/i).first(),
    page.locator('a[href*="reviews"]').first(),
    page.locator('button').filter({ hasText: /Отзывы/i }).first(),
    page.locator('[role="tab"]').filter({ hasText: /Отзывы/i }).first(),
  ];

  for (const candidate of reviewTabCandidates) {
    try {
      if (await candidate.isVisible({ timeout: 3000 })) {
        await candidate.click({ timeout: 10000 });
        await page.waitForTimeout(2000);
        return;
      }
    } catch {
      // пробуем следующий вариант
    }
  }

  const reviewUrl = buildReviewsUrl(page.url());

  if (reviewUrl) {
    await page.goto(reviewUrl, {
      waitUntil: 'domcontentloaded',
      timeout: DEFAULT_TIMEOUT,
    });

    await page.waitForTimeout(3000);
    return;
  }

  throw new ParserError(
    'REVIEWS_TAB_NOT_FOUND',
    'Не удалось открыть вкладку с отзывами.'
  );
}

function buildReviewsUrl(currentUrl) {
  try {
    const url = new URL(currentUrl);

    if (!url.pathname.endsWith('/reviews')) {
      url.pathname = url.pathname.replace(/\/$/, '') + '/reviews';
    }

    return url.toString();
  } catch {
    return null;
  }
}

async function collectReviews(page, maxReviews) {
  const scrollContainer = await findReviewsScrollContainer(page);

  if (!scrollContainer) {
    throw new ParserError(
      'REVIEWS_CONTAINER_NOT_FOUND',
      'Не удалось найти контейнер со списком отзывов.'
    );
  }

  const seenHashes = new Set();
  let reviews = [];
  let stableIterations = 0;
  let previousCount = 0;

  for (let iteration = 0; iteration < 120; iteration += 1) {
    await clickExpandReviewTexts(page);

    const currentReviews = await extractVisibleReviews(page);

    for (const review of currentReviews) {
      const hash = createReviewHash(review);

      if (!seenHashes.has(hash)) {
        seenHashes.add(hash);
        reviews.push(review);
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

async function findReviewsScrollContainer(page) {
  const selectors = [
    '[class*="scroll__container"]',
    '[class*="scrollable"]',
    '[class*="reviews"]',
    '[class*="business-card"]',
    'body',
  ];

  for (const selector of selectors) {
    const locator = page.locator(selector).first();

    try {
      const isVisible = await locator.isVisible({ timeout: 3000 });

      if (isVisible) {
        return selector;
      }
    } catch {
      // пробуем следующий селектор
    }
  }

  return null;
}

async function scrollReviewsContainer(page, selector) {
  await page.evaluate((containerSelector) => {
    const container = document.querySelector(containerSelector);

    if (container) {
      container.scrollTop = container.scrollHeight;
      container.dispatchEvent(new Event('scroll', { bubbles: true }));
      return;
    }

    window.scrollTo(0, document.body.scrollHeight);
  }, selector);

  await page.mouse.wheel(0, 2000);
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
  if (!value) {
    return null;
  }

  return value.replace(/\s+/g, ' ').trim();
}

function parseRating(value) {
  if (!value) {
    return null;
  }

  const normalized = value.replace(',', '.');

  const match = normalized.match(/(\d(?:\.\d)?)/);

  if (!match) {
    return null;
  }

  const rating = Number(match[1]);

  if (rating < 1 || rating > 5) {
    return null;
  }

  return rating;
}

function parseNumberByPatterns(text, patterns) {
  if (!text) {
    return null;
  }

  for (const pattern of patterns) {
    const match = text.match(pattern);

    if (match) {
      return Number(match[1].replace(/\s+/g, ''));
    }
  }

  return null;
}

function createReviewHash(review) {
  return [
    review.author ?? '',
    review.date ?? '',
    review.text ?? '',
    review.rating ?? '',
  ].join('|');
}

function printErrorAndExit(message) {
  console.error(
    JSON.stringify(
      {
        error: {
          code: 'INVALID_USAGE',
          message,
        },
      },
      null,
      2
    )
  );

  process.exit(1);
}

class ParserError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ParserError';
    this.code = code;
  }
}

main().catch((error) => {
  const code = error instanceof ParserError ? error.code : 'UNKNOWN_ERROR';

  console.error(
    JSON.stringify(
      {
        error: {
          code,
          message: error.message,
        },
      },
      null,
      2
    )
  );

  process.exit(1);
});
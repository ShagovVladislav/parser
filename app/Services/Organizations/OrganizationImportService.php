<?php

namespace App\Services\Organizations;

use App\Exceptions\YandexParserException;
use App\Models\Organization;
use App\Models\User;
use App\Services\Yandex\YandexParserService;
use Illuminate\Database\Eloquent\ModelNotFoundException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

class OrganizationImportService
{
    /**
     * @var list<string>
     */
    private const SERVICE_TEXTS = [
        'Подписаться',
        'Ещё',
        'Показать полностью',
        'Читать полностью',
        'Нравится',
        'Ответить',
        'Пожаловаться',
        'Поделиться',
    ];

    public function __construct(
        private readonly YandexParserService $parser,
    ) {}

    public function importForUser(User $user, string $url): Organization
    {
        $organization = $this->markAsProcessing($user, $url);

        try {
            $data = $this->parser->parse($url);
        } catch (YandexParserException $exception) {
            $this->markAsFailed($organization, $exception);

            throw $exception;
        }

        return $this->persistParserResult($organization, $url, $data);
    }

    public function refreshForUser(User $user): Organization
    {
        $organization = $user->currentOrganization()->first();

        if (! $organization) {
            throw (new ModelNotFoundException)->setModel(Organization::class);
        }

        $organization->forceFill([
            'parse_status' => Organization::STATUS_PROCESSING,
            'parse_error' => null,
        ])->save();

        try {
            $data = $this->parser->parse($organization->yandex_url);
        } catch (YandexParserException $exception) {
            $this->markAsFailed($organization, $exception);

            throw $exception;
        }

        return $this->persistParserResult($organization, $organization->yandex_url, $data);
    }

    private function markAsProcessing(User $user, string $url): Organization
    {
        $organization = $user->currentOrganization()->first();

        $attributes = [
            'yandex_url' => $url,
            'parse_status' => Organization::STATUS_PROCESSING,
            'parse_error' => null,
        ];

        if ($organization) {
            $organization->forceFill($attributes)->save();

            return $organization;
        }

        return $user->organizations()->create($attributes);
    }

    private function markAsFailed(Organization $organization, YandexParserException $exception): void
    {
        $organization->forceFill([
            'parse_status' => Organization::STATUS_FAILED,
            'parse_error' => $exception->parserMessage,
        ])->save();
    }

    /**
     * @param  array{organization: array<string, mixed>, reviews: array<int, array<string, mixed>>, meta: array<string, mixed>}  $data
     */
    private function persistParserResult(Organization $organization, string $url, array $data): Organization
    {
        return DB::transaction(function () use ($organization, $url, $data): Organization {
            $parsedOrganization = $data['organization'];
            $meta = $data['meta'];
            $newCompanyId = (string) $parsedOrganization['yandex_company_id'];
            $oldCompanyId = $organization->yandex_company_id;

            $organization->forceFill([
                'yandex_company_id' => $newCompanyId,
                'yandex_url' => $url,
                'final_url' => $meta['final_url'] ?? null,
                'name' => $parsedOrganization['name'] ?? null,
                'rating' => $parsedOrganization['rating'] ?? null,
                'rating_count' => $parsedOrganization['rating_count'] ?? null,
                'review_count' => $parsedOrganization['review_count'] ?? null,
                'parse_status' => Organization::STATUS_SUCCESS,
                'parse_error' => null,
                'last_parsed_at' => now(),
            ])->save();

            if ($oldCompanyId !== null && $oldCompanyId !== $newCompanyId) {
                $organization->reviews()->delete();
            }

            $this->storeReviews($organization, $data['reviews']);
            $this->logWarnings($organization, $meta);

            return $organization->refresh();
        });
    }

    /**
     * @param  array<int, array<string, mixed>>  $reviews
     */
    private function storeReviews(Organization $organization, array $reviews): void
    {
        foreach ($reviews as $review) {
            $text = trim((string) ($review['text'] ?? ''));

            if ($text === '' || $this->isServiceText($text)) {
                continue;
            }

            $externalHash = hash('sha256', implode('|', [
                $review['author'] ?? '',
                $review['date'] ?? '',
                $text,
                $review['rating'] ?? '',
            ]));

            $organization->reviews()->updateOrCreate(
                ['external_hash' => $externalHash],
                [
                    'author_name' => $review['author'] ?? null,
                    'review_date_text' => $review['date'] ?? null,
                    'text' => $text,
                    'rating' => $review['rating'] ?? null,
                ],
            );
        }
    }

    private function isServiceText(string $text): bool
    {
        return in_array($text, self::SERVICE_TEXTS, true);
    }

    /**
     * @param  array<string, mixed>  $meta
     */
    private function logWarnings(Organization $organization, array $meta): void
    {
        $warnings = $meta['warnings'] ?? [];

        if (! is_array($warnings) || $warnings === []) {
            return;
        }

        Log::warning('Yandex parser returned warnings.', [
            'organization_id' => $organization->id,
            'warnings' => $warnings,
        ]);
    }
}

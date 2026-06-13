<?php

namespace Tests\Feature;

use App\Exceptions\YandexParserException;
use App\Models\Organization;
use App\Models\User;
use App\Services\Yandex\YandexParserService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Mockery\MockInterface;
use Tests\TestCase;

class OrganizationImportApiTest extends TestCase
{
    use RefreshDatabase;

    public function test_store_imports_organization_and_reviews_for_authenticated_user(): void
    {
        $user = User::factory()->create();
        Sanctum::actingAs($user);

        $this->mock(YandexParserService::class, function (MockInterface $mock): void {
            $mock->shouldReceive('parse')
                ->once()
                ->with('https://yandex.ru/maps/org/test/1054173545')
                ->andReturn($this->parserPayload());
        });

        $response = $this->postJson('/api/organization', [
            'url' => 'https://yandex.ru/maps/org/test/1054173545',
        ]);

        $response
            ->assertCreated()
            ->assertJsonPath('data.yandex_company_id', '1054173545')
            ->assertJsonPath('data.parse_status', Organization::STATUS_SUCCESS);

        $organization = $user->organizations()->firstOrFail();

        $this->assertSame('Nha Trang City', $organization->name);
        $this->assertSame(1, $organization->reviews()->count());
        $this->assertDatabaseHas('reviews', [
            'organization_id' => $organization->id,
            'author_name' => 'Demo Author',
            'text' => 'Good place.',
            'rating' => 5,
        ]);
    }

    public function test_store_marks_organization_failed_when_parser_fails(): void
    {
        $user = User::factory()->create();
        Sanctum::actingAs($user);

        $this->mock(YandexParserService::class, function (MockInterface $mock): void {
            $mock->shouldReceive('parse')
                ->once()
                ->andThrow(new YandexParserException(
                    'YANDEX_BLOCKED',
                    'Captcha detected.',
                    ['reason' => 'captcha'],
                ));
        });

        $response = $this->postJson('/api/organization', [
            'url' => 'https://yandex.ru/maps/org/test/1054173545',
        ]);

        $response
            ->assertStatus(502)
            ->assertJsonPath('parser_error.code', 'YANDEX_BLOCKED');

        $this->assertDatabaseHas('organizations', [
            'user_id' => $user->id,
            'parse_status' => Organization::STATUS_FAILED,
            'parse_error' => 'Captcha detected.',
        ]);
    }

    public function test_store_requires_authentication(): void
    {
        $this->postJson('/api/organization', [
            'url' => 'https://yandex.ru/maps/org/test/1054173545',
        ])->assertUnauthorized();
    }

    public function test_reviews_index_requires_authentication(): void
    {
        $this->getJson('/api/organization/reviews?page=1')->assertUnauthorized();
    }

    /**
     * @return array{organization: array<string, mixed>, reviews: list<array<string, mixed>>, meta: array<string, mixed>}
     */
    private function parserPayload(): array
    {
        return [
            'organization' => [
                'yandex_company_id' => '1054173545',
                'name' => 'Nha Trang City',
                'rating' => 4.7,
                'rating_count' => 123,
                'review_count' => 45,
            ],
            'reviews' => [
                [
                    'author' => 'Demo Author',
                    'date' => '12 июня',
                    'text' => 'Good place.',
                    'rating' => 5,
                    'company_response' => null,
                ],
            ],
            'meta' => [
                'final_url' => 'https://yandex.ru/maps/org/test/1054173545',
                'warnings' => [],
            ],
        ];
    }
}

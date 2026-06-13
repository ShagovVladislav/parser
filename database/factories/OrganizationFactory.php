<?php

namespace Database\Factories;

use App\Models\Organization;
use App\Models\User;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<Organization>
 */
class OrganizationFactory extends Factory
{
    /**
     * The name of the factory's corresponding model.
     *
     * @var class-string<Organization>
     */
    protected $model = Organization::class;

    /**
     * Define the model's default state.
     *
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        $companyId = (string) fake()->unique()->numberBetween(1_000_000, 999_999_999);

        return [
            'user_id' => User::factory(),
            'yandex_company_id' => $companyId,
            'yandex_url' => "https://yandex.ru/maps/org/test/{$companyId}",
            'final_url' => "https://yandex.ru/maps/org/test/{$companyId}/reviews",
            'name' => fake()->company(),
            'rating' => fake()->randomFloat(2, 1, 5),
            'rating_count' => fake()->numberBetween(0, 10000),
            'review_count' => fake()->numberBetween(0, 1000),
            'parse_status' => Organization::STATUS_SUCCESS,
            'parse_error' => null,
            'last_parsed_at' => now(),
        ];
    }
}

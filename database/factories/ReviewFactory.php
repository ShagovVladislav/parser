<?php

namespace Database\Factories;

use App\Models\Organization;
use App\Models\Review;
use Illuminate\Database\Eloquent\Factories\Factory;
use Illuminate\Support\Str;

/**
 * @extends Factory<Review>
 */
class ReviewFactory extends Factory
{
    /**
     * The name of the factory's corresponding model.
     *
     * @var class-string<Review>
     */
    protected $model = Review::class;

    /**
     * Define the model's default state.
     *
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'organization_id' => Organization::factory(),
            'external_hash' => hash('sha256', Str::uuid()->toString()),
            'author_name' => fake()->name(),
            'review_date_text' => fake()->date(),
            'text' => fake()->paragraph(),
            'rating' => fake()->numberBetween(1, 5),
        ];
    }
}

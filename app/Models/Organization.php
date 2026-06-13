<?php

namespace App\Models;

use Database\Factories\OrganizationFactory;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * @property int $id
 * @property int $user_id
 * @property string $yandex_company_id
 * @property string $yandex_url
 * @property string|null $final_url
 * @property string|null $name
 * @property float|null $rating
 * @property int|null $rating_count
 * @property int|null $review_count
 * @property string $parse_status
 * @property string|null $parse_error
 */
class Organization extends Model
{
    /** @use HasFactory<OrganizationFactory> */
    use HasFactory;

    public const STATUS_PENDING = 'pending';
    public const STATUS_PROCESSING = 'processing';
    public const STATUS_SUCCESS = 'success';
    public const STATUS_FAILED = 'failed';

    /**
     * @var list<string>
     */
    protected $fillable = [
        'user_id',
        'yandex_company_id',
        'yandex_url',
        'final_url',
        'name',
        'rating',
        'rating_count',
        'review_count',
        'parse_status',
        'parse_error',
        'last_parsed_at',
    ];

    /**
     * @return BelongsTo<User, $this>
     */
    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    /**
     * @return HasMany<Review, $this>
     */
    public function reviews(): HasMany
    {
        return $this->hasMany(Review::class);
    }

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'rating' => 'float',
            'rating_count' => 'integer',
            'review_count' => 'integer',
            'last_parsed_at' => 'datetime',
        ];
    }
}

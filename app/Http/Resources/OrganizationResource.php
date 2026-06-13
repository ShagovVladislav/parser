<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class OrganizationResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'yandex_company_id' => $this->yandex_company_id,
            'yandex_url' => $this->yandex_url,
            'final_url' => $this->final_url,
            'name' => $this->name,
            'rating' => $this->rating,
            'rating_count' => $this->rating_count,
            'review_count' => $this->review_count,
            'parse_status' => $this->parse_status,
            'parse_error' => $this->parse_error,
            'last_parsed_at' => $this->last_parsed_at,
            'created_at' => $this->created_at,
            'updated_at' => $this->updated_at,
        ];
    }
}

<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class ReviewResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'author_name' => $this->author_name,
            'review_date_text' => $this->review_date_text,
            'text' => $this->text,
            'rating' => $this->rating,
            'company_response' => $this->company_response,
            'created_at' => $this->created_at,
            'updated_at' => $this->updated_at,
        ];
    }
}

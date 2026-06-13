<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Resources\ReviewResource;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;

class ReviewController extends Controller
{
    public function index(Request $request): AnonymousResourceCollection|JsonResponse
    {
        $organization = $request->user()
            ->organizations()
            ->oldest('id')
            ->first();

        if (! $organization) {
            return response()->json([
                'data' => [],
                'meta' => [
                    'current_page' => 1,
                    'per_page' => 50,
                    'total' => 0,
                ],
            ]);
        }

        $reviews = $organization->reviews()
            ->latest('id')
            ->paginate(50);

        return ReviewResource::collection($reviews);
    }
}

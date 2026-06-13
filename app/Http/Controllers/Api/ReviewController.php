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
        $perPage = min(max($request->integer('per_page', 50), 1), 100);

        $organization = $request->user()
            ->organizations()
            ->oldest('id')
            ->first();

        if (! $organization) {
            return response()->json([
                'data' => [],
                'meta' => [
                    'current_page' => 1,
                    'last_page' => 1,
                    'per_page' => $perPage,
                    'total' => 0,
                ],
            ]);
        }

        $reviews = $organization->reviews()
            ->latest('id')
            ->paginate($perPage)
            ->withQueryString();

        return ReviewResource::collection($reviews);
    }
}

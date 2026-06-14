<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Resources\ReviewResource;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;

class ReviewController extends Controller
{
    private const DEFAULT_PER_PAGE = 50;

    private const MIN_PER_PAGE = 1;

    private const MAX_PER_PAGE = 100;

    public function index(Request $request): AnonymousResourceCollection|JsonResponse
    {
        $perPage = $this->resolvePerPage($request);

        $organization = $request->user()->currentOrganization()->first();

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

    private function resolvePerPage(Request $request): int
    {
        return min(
            max($request->integer('per_page', self::DEFAULT_PER_PAGE), self::MIN_PER_PAGE),
            self::MAX_PER_PAGE,
        );
    }
}

<?php

namespace App\Http\Controllers\Api;

use App\Exceptions\YandexParserException;
use App\Http\Controllers\Controller;
use App\Http\Requests\Organization\StoreOrganizationRequest;
use App\Http\Resources\OrganizationResource;
use App\Services\Organizations\OrganizationImportService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class OrganizationController extends Controller
{
    public function __construct(
        private readonly OrganizationImportService $organizationImportService,
    ) {
    }

    public function show(Request $request): OrganizationResource|JsonResponse
    {
        $organization = $request->user()
            ->organizations()
            ->oldest('id')
            ->first();

        if (! $organization) {
            return response()->json(['data' => null]);
        }

        return new OrganizationResource($organization);
    }

    public function store(StoreOrganizationRequest $request): OrganizationResource|JsonResponse
    {
        try {
            $organization = $this->organizationImportService->importForUser(
                $request->user(),
                $request->validated('url'),
            );

            return new OrganizationResource($organization);
        } catch (YandexParserException $exception) {
            return $this->parserErrorResponse($exception);
        }
    }

    public function refresh(Request $request): OrganizationResource|JsonResponse
    {
        try {
            return new OrganizationResource(
                $this->organizationImportService->refreshForUser($request->user()),
            );
        } catch (YandexParserException $exception) {
            return $this->parserErrorResponse($exception);
        }
    }

    private function parserErrorResponse(YandexParserException $exception): JsonResponse
    {
        return response()->json([
            'message' => 'Не удалось получить данные из Яндекс.Карт.',
            'parser_error' => $exception->toArray(),
        ], $this->parserErrorStatus($exception));
    }

    private function parserErrorStatus(YandexParserException $exception): int
    {
        return match ($exception->parserCode) {
            'INVALID_USAGE',
            'INVALID_URL',
            'INVALID_HOST',
            'INVALID_MAPS_URL',
            'COMPANY_ID_NOT_FOUND' => 422,
            'PARSER_SCRIPT_NOT_FOUND',
            'INVALID_PARSER_OUTPUT' => 500,
            default => 502,
        };
    }
}

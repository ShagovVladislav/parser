<?php

namespace App\Services\Yandex;

use App\Exceptions\YandexParserException;
use Illuminate\Process\Exceptions\ProcessTimedOutException;
use Illuminate\Support\Facades\Process;

class YandexParserService
{
    /**
     * @return array{organization: array<string, mixed>, reviews: array<int, array<string, mixed>>, meta: array<string, mixed>}
     */
    public function parse(string $url, ?int $maxReviews = null): array
    {
        $config = config('yandex_parser');
        $scriptPath = $this->resolvePath((string) $config['script_path']);

        if (! is_file($scriptPath)) {
            throw new YandexParserException(
                'PARSER_SCRIPT_NOT_FOUND',
                'Yandex parser script was not found.',
                ['script_path' => $scriptPath],
            );
        }

        $timeoutSeconds = (int) $config['timeout'];
        $command = $this->buildCommand($config, $scriptPath, $url, $maxReviews);

        try {
            $result = Process::timeout($timeoutSeconds)->run($command);
        } catch (ProcessTimedOutException $exception) {
            throw new YandexParserException(
                'PARSER_TIMEOUT',
                'Parser process exceeded configured timeout.',
                [
                    'timeout_seconds' => $timeoutSeconds,
                ],
                previous: $exception,
            );
        }

        if ($result->failed()) {
            throw $this->exceptionFromErrorOutput($result->errorOutput(), [
                'exit_code' => $result->exitCode(),
            ]);
        }

        $decoded = json_decode($result->output(), true);

        if (! is_array($decoded)) {
            throw new YandexParserException(
                'INVALID_PARSER_OUTPUT',
                'Parser returned invalid JSON in stdout.',
                [
                    'json_error' => json_last_error_msg(),
                ],
            );
        }

        if (
            ! array_key_exists('organization', $decoded) ||
            ! is_array($decoded['organization']) ||
            ! array_key_exists('reviews', $decoded) ||
            ! is_array($decoded['reviews']) ||
            ! array_key_exists('meta', $decoded) ||
            ! is_array($decoded['meta'])
        ) {
            throw new YandexParserException(
                'INVALID_PARSER_OUTPUT',
                'Parser JSON does not contain required organization, reviews and meta keys.',
            );
        }

        return $decoded;
    }

    /**
     * @param  array<string, mixed>  $fallbackDetails
     */
    private function exceptionFromErrorOutput(string $errorOutput, array $fallbackDetails): YandexParserException
    {
        $decoded = $this->decodeErrorOutput($errorOutput);

        if (is_array($decoded) && isset($decoded['error']) && is_array($decoded['error'])) {
            $error = $decoded['error'];

            return new YandexParserException(
                (string) ($error['code'] ?? 'PARSER_FAILED'),
                (string) ($error['message'] ?? 'Parser failed.'),
                is_array($error['details'] ?? null) ? $error['details'] : [],
            );
        }

        return new YandexParserException(
            'PARSER_PROCESS_FAILED',
            'Parser process failed.',
            $fallbackDetails + ['stderr' => $errorOutput],
        );
    }

    /**
     * @param  array<string, mixed>  $config
     * @return list<string>
     */
    private function buildCommand(array $config, string $scriptPath, string $url, ?int $maxReviews): array
    {
        $timeoutMilliseconds = (int) $config['timeout'] * 1000;
        $command = [
            (string) $config['node_binary'],
            $scriptPath,
            $url,
            (string) ($maxReviews ?? (int) $config['max_reviews']),
            "--timeout={$timeoutMilliseconds}",
        ];

        if (! (bool) $config['debug']) {
            return $command;
        }

        $command[] = '--debug';

        if (! empty($config['debug_dir'])) {
            $command[] = '--debug-dir='.$this->resolvePath((string) $config['debug_dir']);
        }

        return $command;
    }

    /**
     * Parser debug mode may write progress lines to stderr before the JSON error envelope.
     *
     * @return array<string, mixed>|null
     */
    private function decodeErrorOutput(string $errorOutput): ?array
    {
        $decoded = json_decode($errorOutput, true);

        if (is_array($decoded)) {
            return $decoded;
        }

        $errorKeyPosition = strrpos($errorOutput, '"error"');

        if ($errorKeyPosition === false) {
            return null;
        }

        $candidateStart = strrpos(substr($errorOutput, 0, $errorKeyPosition), '{');

        if ($candidateStart === false) {
            return null;
        }

        $decoded = json_decode(substr($errorOutput, $candidateStart), true);

        return is_array($decoded) ? $decoded : null;
    }

    private function resolvePath(string $path): string
    {
        if ($this->isAbsolutePath($path)) {
            return $path;
        }

        return base_path($path);
    }

    private function isAbsolutePath(string $path): bool
    {
        return str_starts_with($path, '/') || (bool) preg_match('/^[A-Za-z]:[\\\\\\/]/', $path);
    }
}

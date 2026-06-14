<?php

namespace Tests\Unit;

use App\Exceptions\YandexParserException;
use App\Services\Yandex\YandexParserService;
use Illuminate\Process\PendingProcess;
use Illuminate\Support\Facades\Process;
use Tests\TestCase;

class YandexParserServiceTest extends TestCase
{
    public function test_it_runs_parser_and_returns_decoded_payload(): void
    {
        $payload = [
            'organization' => [
                'yandex_company_id' => '1054173545',
                'name' => 'Test Organization',
                'rating' => 4.7,
                'rating_count' => 123,
                'review_count' => 10,
            ],
            'reviews' => [],
            'meta' => [
                'final_url' => 'https://yandex.ru/maps/org/test/1054173545',
                'warnings' => [],
            ],
        ];

        config([
            'yandex_parser.node_binary' => 'node-test',
            'yandex_parser.script_path' => base_path('yandex-parser.js'),
            'yandex_parser.max_reviews' => 700,
            'yandex_parser.timeout' => 12,
            'yandex_parser.debug' => true,
            'yandex_parser.debug_dir' => 'storage/app/parser-debug-test',
        ]);

        Process::fake([
            '*' => Process::result(json_encode($payload, JSON_THROW_ON_ERROR)),
        ]);

        $result = app(YandexParserService::class)->parse('https://yandex.ru/maps/org/test/1054173545', 25);

        $this->assertSame($payload, $result);

        Process::assertRan(function (PendingProcess $process): bool {
            $command = $process->command;

            return is_array($command)
                && $command[0] === 'node-test'
                && $command[1] === base_path('yandex-parser.js')
                && $command[2] === 'https://yandex.ru/maps/org/test/1054173545'
                && $command[3] === '25'
                && in_array('--timeout=12000', $command, true)
                && in_array('--debug', $command, true)
                && in_array('--debug-dir='.base_path('storage/app/parser-debug-test'), $command, true)
                && $process->timeout === 12;
        });
    }

    public function test_it_throws_structured_exception_from_parser_stderr(): void
    {
        config([
            'yandex_parser.script_path' => base_path('yandex-parser.js'),
            'yandex_parser.timeout' => 12,
        ]);

        Process::fake([
            '*' => Process::result(
                output: '',
                errorOutput: json_encode([
                    'error' => [
                        'code' => 'YANDEX_BLOCKED',
                        'message' => 'Captcha detected.',
                        'details' => ['reason' => 'captcha'],
                    ],
                ], JSON_THROW_ON_ERROR),
                exitCode: 1,
            ),
        ]);

        try {
            app(YandexParserService::class)->parse('https://yandex.ru/maps/org/test/1054173545');
        } catch (YandexParserException $exception) {
            $this->assertSame('YANDEX_BLOCKED', $exception->parserCode);
            $this->assertSame('Captcha detected.', $exception->parserMessage);
            $this->assertSame(['reason' => 'captcha'], $exception->parserDetails);

            return;
        }

        $this->fail('Expected YandexParserException was not thrown.');
    }

    public function test_it_reads_structured_exception_from_debug_stderr(): void
    {
        config([
            'yandex_parser.script_path' => base_path('yandex-parser.js'),
            'yandex_parser.timeout' => 12,
        ]);

        Process::fake([
            '*' => Process::result(
                output: '',
                errorOutput: "[debug] Parser started\n".json_encode([
                    'error' => [
                        'code' => 'COMPANY_ID_NOT_FOUND',
                        'message' => 'Company ID was not found.',
                        'details' => ['source_url' => 'https://yandex.ru/maps/-/test'],
                    ],
                ], JSON_THROW_ON_ERROR),
                exitCode: 1,
            ),
        ]);

        try {
            app(YandexParserService::class)->parse('https://yandex.ru/maps/-/test');
        } catch (YandexParserException $exception) {
            $this->assertSame('COMPANY_ID_NOT_FOUND', $exception->parserCode);
            $this->assertSame('Company ID was not found.', $exception->parserMessage);
            $this->assertSame(
                ['source_url' => 'https://yandex.ru/maps/-/test'],
                $exception->parserDetails,
            );

            return;
        }

        $this->fail('Expected YandexParserException was not thrown.');
    }

    public function test_it_rejects_invalid_success_stdout(): void
    {
        config([
            'yandex_parser.script_path' => base_path('yandex-parser.js'),
            'yandex_parser.timeout' => 12,
        ]);

        Process::fake([
            '*' => Process::result('not-json'),
        ]);

        $this->expectException(YandexParserException::class);
        $this->expectExceptionMessage('Parser returned invalid JSON in stdout.');

        app(YandexParserService::class)->parse('https://yandex.ru/maps/org/test/1054173545');
    }
}

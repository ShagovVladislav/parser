<?php

namespace App\Exceptions;

use RuntimeException;
use Throwable;

class YandexParserException extends RuntimeException
{
    /**
     * @param array<string, mixed> $parserDetails
     */
    public function __construct(
        public readonly string $parserCode,
        public readonly string $parserMessage,
        public readonly array $parserDetails = [],
        int $code = 0,
        ?Throwable $previous = null,
    ) {
        parent::__construct($parserMessage, $code, $previous);
    }

    /**
     * @return array{code: string, message: string, details: array<string, mixed>}
     */
    public function toArray(): array
    {
        return [
            'code' => $this->parserCode,
            'message' => $this->parserMessage,
            'details' => $this->parserDetails,
        ];
    }
}

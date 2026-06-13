<?php

return [
    'node_binary' => env('YANDEX_PARSER_NODE_BINARY', 'node'),
    'script_path' => env('YANDEX_PARSER_SCRIPT_PATH', base_path('../parser/yandex-parser.js')),
    'max_reviews' => (int) env('YANDEX_PARSER_MAX_REVIEWS', 700),
    'timeout' => (int) env('YANDEX_PARSER_TIMEOUT', 300),
    'debug' => (bool) env('YANDEX_PARSER_DEBUG', false),
    'debug_dir' => env('YANDEX_PARSER_DEBUG_DIR', storage_path('app/parser-debug')),
];

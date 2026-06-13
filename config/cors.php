<?php

$frontendOrigins = array_values(array_filter(array_map(
    'trim',
    explode(',', env('FRONTEND_URLS', env('FRONTEND_URL', 'http://localhost:5173')))
)));

return [
    'paths' => ['api/*', 'sanctum/csrf-cookie'],

    'allowed_methods' => ['*'],

    'allowed_origins' => $frontendOrigins,

    'allowed_origins_patterns' => [],

    'allowed_headers' => ['*'],

    'exposed_headers' => [],

    'max_age' => 0,

    'supports_credentials' => true,
];

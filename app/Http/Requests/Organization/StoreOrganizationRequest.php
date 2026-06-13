<?php

namespace App\Http\Requests\Organization;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Validator;

class StoreOrganizationRequest extends FormRequest
{
    /**
     * @var list<string>
     */
    private const ALLOWED_HOSTS = [
        'yandex.ru',
        'www.yandex.ru',
        'yandex.com',
        'www.yandex.com',
    ];

    public function authorize(): bool
    {
        return true;
    }

    /**
     * @return array<string, list<string>>
     */
    public function rules(): array
    {
        return [
            'url' => ['required', 'url', 'max:2048'],
        ];
    }

    public function withValidator(Validator $validator): void
    {
        $validator->after(function (Validator $validator): void {
            $url = $this->string('url')->toString();
            $host = strtolower((string) parse_url($url, PHP_URL_HOST));
            $path = (string) parse_url($url, PHP_URL_PATH);

            if (! in_array($host, self::ALLOWED_HOSTS, true) || ! str_contains($path, '/maps/')) {
                $validator->errors()->add('url', 'The url must be a valid Yandex Maps URL.');
            }
        });
    }
}

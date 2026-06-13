<?php

namespace Tests\Feature;

use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class ApiAuthTest extends TestCase
{
    use RefreshDatabase;

    public function test_login_with_valid_credentials_returns_user(): void
    {
        $this->seed();

        $response = $this->fromFrontend()->postJson('/api/login', [
            'email' => 'demo@example.com',
            'password' => 'password',
        ]);

        $response
            ->assertOk()
            ->assertJsonPath('data.name', 'Demo User')
            ->assertJsonPath('data.email', 'demo@example.com')
            ->assertJsonMissingPath('data.password');
    }

    public function test_login_with_invalid_credentials_returns_validation_error(): void
    {
        $this->seed();

        $response = $this->fromFrontend()->postJson('/api/login', [
            'email' => 'demo@example.com',
            'password' => 'wrong-password',
        ]);

        $response
            ->assertUnprocessable()
            ->assertJsonValidationErrors('email');
    }

    public function test_me_without_authentication_returns_unauthorized(): void
    {
        $this->getJson('/api/me')->assertUnauthorized();
    }

    public function test_me_after_login_returns_authenticated_user(): void
    {
        $this->seed();

        $this->fromFrontend()->postJson('/api/login', [
            'email' => 'demo@example.com',
            'password' => 'password',
        ])->assertOk();

        $this->fromFrontend()
            ->getJson('/api/me')
            ->assertOk()
            ->assertJsonPath('data.email', 'demo@example.com');
    }

    public function test_organization_without_authentication_returns_unauthorized(): void
    {
        $this->getJson('/api/organization')->assertUnauthorized();
    }

    private function fromFrontend(): static
    {
        return $this->withHeader('Referer', 'http://localhost:5173');
    }
}

<?php

use App\Models\Organization;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     */
    public function up(): void
    {
        Schema::create('organizations', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->string('yandex_company_id')->nullable();
            $table->text('yandex_url');
            $table->text('final_url')->nullable();
            $table->string('name')->nullable();
            $table->decimal('rating', 3, 2)->nullable();
            $table->unsignedInteger('rating_count')->nullable();
            $table->unsignedInteger('review_count')->nullable();
            $table->string('parse_status')->default(Organization::STATUS_PENDING);
            $table->text('parse_error')->nullable();
            $table->timestamp('last_parsed_at')->nullable();
            $table->timestamps();

            $table->index('user_id');
            $table->unique(['user_id', 'yandex_company_id']);
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('organizations');
    }
};

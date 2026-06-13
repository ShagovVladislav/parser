<?php

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
        Schema::create('reviews', function (Blueprint $table) {
            $table->id();
            $table->foreignId('organization_id')->constrained()->cascadeOnDelete();
            $table->string('external_hash', 64);
            $table->string('author_name')->nullable();
            $table->string('review_date_text')->nullable();
            $table->longText('text');
            $table->unsignedTinyInteger('rating')->nullable();
            $table->timestamps();

            $table->index('organization_id');
            $table->unique(['organization_id', 'external_hash']);
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('reviews');
    }
};

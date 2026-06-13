<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('reviews', function (Blueprint $table): void {
            if (Schema::hasColumn('reviews', 'company_response')) {
                $table->dropColumn('company_response');
            }
        });
    }

    public function down(): void
    {
        Schema::table('reviews', function (Blueprint $table): void {
            if (! Schema::hasColumn('reviews', 'company_response')) {
                $table->longText('company_response')->nullable()->after('rating');
            }
        });
    }
};

<?php

namespace Database\Seeders;

use Illuminate\Database\Console\Seeds\WithoutModelEvents;
use Illuminate\Database\Seeder;

class DatabaseSeeder extends Seeder
{
    use WithoutModelEvents;

    /**
     * Seed the application's database.
     */
    public function run(): void
    {
        // Catalog seeders (platforms, regions, products, sellers, offers, keys,
        // homepage blocks) are added with the catalog increment. They load a
        // curated, version-controlled dataset so every environment gets the
        // same data. See docs/ARCHITECTURE.md, "Seed data and images".
    }
}

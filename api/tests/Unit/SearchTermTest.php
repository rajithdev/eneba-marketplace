<?php

namespace Tests\Unit;

use App\Support\SearchTerm;
use PHPUnit\Framework\TestCase;

class SearchTermTest extends TestCase
{
    public function test_it_trims_lowercases_and_folds_whitespace(): void
    {
        $term = SearchTerm::from("  Elden \t  RING\n");

        $this->assertSame('elden ring', $term->text);
        $this->assertSame(['elden', 'ring'], $term->words);
    }

    public function test_nothing_to_search_for_is_null(): void
    {
        foreach ([null, '', '   ', "\t\n", "\u{0000}", "\u{200B}"] as $empty) {
            $this->assertNull(SearchTerm::from($empty), json_encode($empty));
        }
    }

    public function test_control_characters_are_removed(): void
    {
        $this->assertSame('elden ring', SearchTerm::from("elden\u{0000}ring")->text);
    }

    public function test_repeated_words_count_once_and_the_number_of_words_is_capped(): void
    {
        $this->assertSame(['ring'], SearchTerm::from('ring ring RING')->words);
        $this->assertCount(SearchTerm::MAX_WORDS, SearchTerm::from('a b c d e f g h i j')->words);
    }

    public function test_it_handles_text_that_is_not_plain_latin(): void
    {
        $term = SearchTerm::from('Pokémon ポケモン 🎮');

        $this->assertSame('pokémon ポケモン 🎮', $term->text);
        $this->assertCount(3, $term->words);
    }

    public function test_like_wildcards_are_escaped_so_they_match_only_themselves(): void
    {
        $this->assertSame('100\\%', SearchTerm::likePattern('100%'));
        $this->assertSame('a\\_b', SearchTerm::likePattern('a_b'));
        $this->assertSame('back\\\\slash', SearchTerm::likePattern('back\\slash'));
    }
}

<?php

namespace App\Enums;

/** What kind of thing a catalog title is. */
enum GameType: string
{
    case Game = 'game';
    case Dlc = 'dlc';
    case GiftCard = 'gift_card';
    case Subscription = 'subscription';

    /** Name shown in the store's filter list. */
    public function label(): string
    {
        return match ($this) {
            self::Game => 'Games',
            self::Dlc => 'DLC',
            self::GiftCard => 'Gift cards',
            self::Subscription => 'Subscriptions',
        };
    }
}

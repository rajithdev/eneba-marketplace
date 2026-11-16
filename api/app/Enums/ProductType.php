<?php

namespace App\Enums;

enum ProductType: string
{
    case Game = 'game';
    case Dlc = 'dlc';
    case GiftCard = 'gift_card';
    case Subscription = 'subscription';
}

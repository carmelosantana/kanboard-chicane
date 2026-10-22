<?php
require_once 'tests/units/Base.php';

use KanboardTests\units\Base;
use Kanboard\Plugin\Chicane\Model\RaceGate;

class RaceAccessTest extends Base
{
    public static function gateMatrix(): array
    {
        // [visibility, isMember, viaToken, expected]
        return [
            'off member direct' => ['off', true, false, null],
            'off member token' => ['off', true, true, null],
            'off guest direct' => ['off', false, false, null],
            'off guest token' => ['off', false, true, null],
            'members member direct' => ['members', true, false, 'full'],
            'members member token' => ['members', true, true, null],
            'members guest direct' => ['members', false, false, null],
            'members guest token' => ['members', false, true, null],
            'public member direct' => ['public', true, false, 'full'],
            'public member token' => ['public', true, true, 'full'],
            'public guest direct' => ['public', false, false, null],
            'public guest token' => ['public', false, true, 'full'],
            'map_only member direct' => ['map_only', true, false, 'full'],
            'map_only member token' => ['map_only', true, true, 'map_only'],
            'map_only guest direct' => ['map_only', false, false, null],
            'map_only guest token' => ['map_only', false, true, 'map_only'],
            'unknown member direct' => [null, true, false, null],
            'unknown guest token' => [null, false, true, null],
        ];
    }

    /** @dataProvider gateMatrix */
    public function testGateMatrix(?string $visibility, bool $isMember, bool $viaToken, ?string $expected): void
    {
        $this->assertSame($expected, RaceGate::decide($visibility, $isMember, $viaToken));
    }
}

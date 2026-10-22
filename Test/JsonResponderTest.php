<?php
require_once 'tests/units/Base.php';

use KanboardTests\units\Base;
use Kanboard\Plugin\Chicane\Controller\JsonResponder;

class JsonResponderTest extends Base
{
    public static function ifNoneMatch(): array
    {
        return [
            'exact' => ['"abc"', true],
            'weak' => ['W/"abc"', true],
            'in list' => ['"zzz", "abc"', true],
            'any' => ['*', true],
            'other' => ['"zzz"', false],
            'empty' => ['', false],
            'unquoted prefix' => ['"ab"', false],
        ];
    }

    /** @dataProvider ifNoneMatch */
    public function testEtagMatches(string $header, bool $expected): void
    {
        $probe = new class {
            use JsonResponder;
            public function probe(string $header, string $etag): bool { return self::etagMatches($header, $etag); }
        };
        $this->assertSame($expected, $probe->probe($header, 'abc'));
    }
}

<?php
require_once 'tests/units/Base.php';

use KanboardTests\units\Base;
use Kanboard\Plugin\Chicane\Controller\JsonResponder;
use Kanboard\Plugin\Chicane\Model\Json;

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

    // progress_pct is documented as a number with one decimal: 80.0 stays 80.0, not 80.
    public function testFloatsKeepTheirDecimal(): void
    {
        $this->assertSame('{"progress_pct":80.0,"n":3}', Json::encode(['progress_pct' => 80.0, 'n' => 3]));
    }
}

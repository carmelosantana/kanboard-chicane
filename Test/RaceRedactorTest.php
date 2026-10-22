<?php
require_once 'tests/units/Base.php';

use KanboardTests\units\Base;
use Kanboard\Plugin\Chicane\Model\RaceRedactor;

class RaceRedactorTest extends Base
{
    private function fixture(): array
    {
        return json_decode(file_get_contents(__DIR__.'/fixtures/state-small.json'), true);
    }

    public function testMapOnlyLeaksNothing(): void
    {
        $json = json_encode(RaceRedactor::mapOnly($this->fixture()));

        foreach (['Carmelo', 'Santana', 'Codex', 'onerror'] as $leak) {
            $this->assertStringNotContainsStringIgnoringCase($leak, $json);
        }
        $this->assertStringContainsString('Lane 1', $json);
    }

    public function testMapOnlyKeepsShape(): void
    {
        $fixture = $this->fixture();
        $redacted = RaceRedactor::mapOnly($fixture);

        $this->assertSame(array_keys($fixture), array_keys($redacted));
        $this->assertSame(['Lane 1', 'Lane 2'], array_column($redacted['swimlanes'], 'name'));
        $this->assertSame(array_column($fixture['swimlanes'], 'id'), array_column($redacted['swimlanes'], 'id'));
        $this->assertSame(['CS', 'CO'], array_column($redacted['users'], 'name'));
        $this->assertSame(['', ''], array_column($redacted['users'], 'username'));
        $this->assertSame(['', '', '', ''], array_column($redacted['tasks'], 'title'));
        $this->assertSame($fixture['columns'], $redacted['columns']);
        $this->assertSame($fixture['tasks'][1]['subtasks'], $redacted['tasks'][1]['subtasks']);
    }

    public function testWontfixSurvivesAsFlag(): void
    {
        $tasks = RaceRedactor::mapOnly($this->fixture())['tasks'];

        $this->assertSame([], $tasks[2]['tags']);
        $this->assertTrue($tasks[2]['wontfix']);
        $this->assertSame([], $tasks[3]['tags']);
        $this->assertFalse($tasks[3]['wontfix']);
    }

    public function testBlockedTagsSurviveAsFlag(): void
    {
        $fixture = $this->fixture();
        $fixture['tasks'][0]['tags'] = ['blocked'];
        $fixture['tasks'][1]['tags'] = ['carmelo', 'needs-info'];
        $tasks = RaceRedactor::mapOnly($fixture)['tasks'];

        $this->assertSame([true, true, false, false], array_column($tasks, 'blocked'));
        $this->assertSame([[], [], [], []], array_column($tasks, 'tags'));
    }

    public static function names(): array
    {
        return [
            'two words' => ['Claude 2', 'C2'],
            'one word' => ['Carmelo', 'CA'],
            'one word again' => ['Codex', 'CO'],
            'three words' => ['ada b lovelace', 'AB'],
            'extra spaces' => ['  Carmelo   Santana ', 'CS'],
            'multibyte' => ['élodie', 'ÉL'],
            'empty' => ['', '?'],
            'blank' => ['   ', '?'],
        ];
    }

    /** @dataProvider names */
    public function testInitials(string $name, string $expected): void
    {
        $this->assertSame($expected, RaceRedactor::initials($name));
    }
}

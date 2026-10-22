<?php
require_once 'tests/units/Base.php';

use KanboardTests\units\Base;
use Kanboard\Plugin\Chicane\Model\RaceSummary;

class RaceSummaryTest extends Base
{
    private function fixture(): array
    {
        return json_decode(file_get_contents(__DIR__.'/fixtures/state-small.json'), true);
    }

    public function testTotals(): void
    {
        $summary = RaceSummary::build($this->fixture(), 'full', 'subtask');

        $this->assertSame(42.9, $summary['progress_pct']);
        $this->assertSame(4, $summary['distance_to_finish']);
        $this->assertSame(25, $summary['project_id']);
        $this->assertSame(1761100000, $summary['updated_at']);
    }

    public function testEmptyBoard(): void
    {
        $state = ['tasks' => [], 'columns' => [], 'users' => []] + $this->fixture();

        $summary = RaceSummary::build($state, 'full', 'subtask');

        $this->assertSame(0.0, $summary['progress_pct']);
        $this->assertSame(0, $summary['distance_to_finish']);
        $this->assertSame([], $summary['cars']);
    }

    public function testMapOnlySummary(): void
    {
        $this->assertSame([['user' => 'CS', 'task_id' => null]], RaceSummary::build($this->fixture(), 'map_only', 'subtask')['cars']);
        $this->assertSame([['user' => 'Carmelo Santana', 'task_id' => 102]], RaceSummary::build($this->fixture(), 'full', 'subtask')['cars']);
    }

    public function testExactKeys(): void
    {
        $this->assertSame(
            ['project_id', 'progress_pct', 'distance_to_finish', 'cars', 'updated_at'],
            array_keys(RaceSummary::build($this->fixture(), 'map_only', 'subtask'))
        );
    }

    // Mirrors track.js orderTasks. complexity: n = max(1, score, subtasks); with subtasks, done is
    // floor(n * done subtasks / subtasks), open or closed; with none, n when closed, else 0.
    public function testUnitsFollowTheProjectSetting(): void
    {
        $state = ['tasks' => [
            ['id' => 1, 'open' => false, 'column_id' => 3, 'owner_id' => 1, 'score' => 5, 'subtasks' => [['status' => 0, 'position' => 1]]],
            ['id' => 2, 'open' => true, 'column_id' => 2, 'owner_id' => 1, 'score' => 4, 'subtasks' => [['status' => 2, 'position' => 1], ['status' => 0, 'position' => 2]]],
        ], 'columns' => [], 'users' => []] + $this->fixture();

        $subtask = RaceSummary::build($state, 'full', 'subtask');
        $this->assertSame(2, $subtask['distance_to_finish']);
        $this->assertSame(33.3, $subtask['progress_pct']);

        // 5 units, 0 done + 4 units, floor(4 * 1/2) = 2 done: 9 units, 2 done.
        $complexity = RaceSummary::build($state, 'full', 'complexity');
        $this->assertSame(7, $complexity['distance_to_finish']);
        $this->assertSame(22.2, $complexity['progress_pct']);
    }

    public function testComplexityOnTheFixture(): void
    {
        // 1 (closed) + 3 with 2 of 3 subtasks done -> 2 + 1 open + 2 with 0 of 2 done: 7 units, 3 done.
        $summary = RaceSummary::build($this->fixture(), 'full', 'complexity');
        $this->assertSame(4, $summary['distance_to_finish']);
        $this->assertSame(42.9, $summary['progress_pct']);
    }

    // The same two cases are pinned in Test/js/track.test.mjs.
    public static function complexityParity(): array
    {
        $subtasks = fn (int $done, int $all) => array_map(fn ($i) => ['status' => $i < $done ? 2 : 0, 'position' => $i + 1], range(0, $all - 1));
        return [
            'open, score 5, 1 of 3 subtasks done' => [true, $subtasks(1, 3), 4, 20.0],
            'closed, score 5, 1 of 2 subtasks done' => [false, $subtasks(1, 2), 3, 40.0],
        ];
    }

    /** @dataProvider complexityParity */
    public function testComplexityParity(bool $open, array $subtasks, int $undone, float $pct): void
    {
        $state = ['tasks' => [
            ['id' => 1, 'open' => $open, 'column_id' => 1, 'owner_id' => 1, 'score' => 5, 'subtasks' => $subtasks],
        ], 'columns' => [], 'users' => []] + $this->fixture();

        $summary = RaceSummary::build($state, 'full', 'complexity');
        $this->assertSame($undone, $summary['distance_to_finish']);
        $this->assertSame($pct, $summary['progress_pct']);
    }
}

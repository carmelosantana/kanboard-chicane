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

    // Mirrors track.js orderTasks: complexity is max(1, score, subtasks) units per task; an open task leaves
    // its open subtasks (or 1, with none) undone, and a closed task counts every unit done.
    public function testUnitsFollowTheProjectSetting(): void
    {
        $state = ['tasks' => [
            ['id' => 1, 'open' => false, 'column_id' => 3, 'owner_id' => 1, 'score' => 5, 'subtasks' => [['status' => 0, 'position' => 1]]],
            ['id' => 2, 'open' => true, 'column_id' => 2, 'owner_id' => 1, 'score' => 4, 'subtasks' => [['status' => 2, 'position' => 1], ['status' => 0, 'position' => 2]]],
        ], 'columns' => [], 'users' => []] + $this->fixture();

        $subtask = RaceSummary::build($state, 'full', 'subtask');
        $this->assertSame(2, $subtask['distance_to_finish']);
        $this->assertSame(33.3, $subtask['progress_pct']);

        $complexity = RaceSummary::build($state, 'full', 'complexity');
        $this->assertSame(1, $complexity['distance_to_finish']);
        $this->assertSame(88.9, $complexity['progress_pct']);
    }

    public function testComplexityOnTheFixture(): void
    {
        $summary = RaceSummary::build($this->fixture(), 'full', 'complexity');
        $this->assertSame(2, $summary['distance_to_finish']);
        $this->assertSame(71.4, $summary['progress_pct']);
    }
}

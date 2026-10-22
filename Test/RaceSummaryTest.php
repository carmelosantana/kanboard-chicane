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
        $summary = RaceSummary::build($this->fixture(), 'full');

        $this->assertSame(42.9, $summary['progress_pct']);
        $this->assertSame(4, $summary['distance_to_finish']);
        $this->assertSame(25, $summary['project_id']);
        $this->assertSame(1761100000, $summary['updated_at']);
    }

    public function testEmptyBoard(): void
    {
        $state = ['tasks' => [], 'columns' => [], 'users' => []] + $this->fixture();

        $summary = RaceSummary::build($state, 'full');

        $this->assertSame(0.0, $summary['progress_pct']);
        $this->assertSame(0, $summary['distance_to_finish']);
        $this->assertSame([], $summary['cars']);
    }

    public function testMapOnlySummary(): void
    {
        $this->assertSame([['user' => 'CS', 'task_id' => null]], RaceSummary::build($this->fixture(), 'map_only')['cars']);
        $this->assertSame([['user' => 'Carmelo Santana', 'task_id' => 102]], RaceSummary::build($this->fixture(), 'full')['cars']);
    }

    public function testExactKeys(): void
    {
        $this->assertSame(
            ['project_id', 'progress_pct', 'distance_to_finish', 'cars', 'updated_at'],
            array_keys(RaceSummary::build($this->fixture(), 'map_only'))
        );
    }
}

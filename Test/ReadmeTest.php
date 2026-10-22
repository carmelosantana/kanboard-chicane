<?php
require_once 'tests/units/Base.php';

use KanboardTests\units\Base;
use Kanboard\Plugin\Chicane\Model\RaceSettings;

// The README is the public contract for share links and the Chat summary: it names every route and frozen key.
class ReadmeTest extends Base
{
    public function testDocumentsRoutesAndSummaryKeys(): void
    {
        $readme = file_get_contents(__DIR__.'/../README.md');

        foreach (['/race/{token}', '/race/{token}/summary.json'] as $route) {
            $this->assertStringContainsString($route, $readme);
        }
        foreach (['project_id', 'progress_pct', 'distance_to_finish', 'cars', 'updated_at'] as $key) {
            $this->assertStringContainsString('`'.$key.'`', $readme, $key);
        }
        foreach (RaceSettings::VISIBILITY as $visibility) {
            $this->assertStringContainsString('`'.$visibility.'`', $readme, $visibility);
        }
    }
}

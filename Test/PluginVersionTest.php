<?php
require_once 'tests/units/Base.php';

use KanboardTests\units\Base;
use Kanboard\Plugin\Chicane\Plugin;

// Tag == plugin.json == getPluginVersion(): drift across the three is the most common release defect.
class PluginVersionTest extends Base
{
    public function testVersionIsAlignedAt100(): void
    {
        $json = json_decode(file_get_contents(__DIR__.'/../plugin.json'), true);
        $this->assertSame('1.0.0', $json['version']);
        $this->assertSame($json['version'], (new Plugin($this->container))->getPluginVersion());
        $this->assertSame([], $json['requires']);
        // array_column() is [] for the silently-dropped object-map form.
        $this->assertSame(['Presence', 'Agents', 'TimeReport', 'DependencyPlugin'], array_column($json['recommends'], 'plugin'));
        foreach ($json['recommends'] as $dep) {
            $this->assertMatchesRegularExpression('/^\d+\.\d+\.\d+$/', $dep['min_version']);
            $this->assertNotEmpty($dep['reason']);
        }
    }

    // The listing copy matches the README: people drive the cars, tasks are corners.
    public function testListingCopyMatchesTheReadme(): void
    {
        $json = json_decode(file_get_contents(__DIR__.'/../plugin.json'), true);
        $reasons = array_column($json['recommends'], 'reason', 'plugin');

        $this->assertStringContainsString('each task is a corner', $json['description']);
        $this->assertStringContainsString('cars are the people', $json['description']);
        $this->assertStringNotContainsString('tasks are cars', $json['description']);
        $this->assertStringContainsString('level and XP plate', $reasons['TimeReport']);
        $this->assertStringContainsString('"is blocked by" links', $reasons['DependencyPlugin']);
    }
}

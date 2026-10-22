<?php
require_once 'tests/units/Base.php';

use KanboardTests\units\Base;
use Kanboard\Model\ProjectModel;
use Kanboard\Plugin\Chicane\Model\RaceSettings;

class RaceSettingsTest extends Base
{
    private int $pid;
    private RaceSettings $settings;

    protected function setUp(): void
    {
        parent::setUp();
        $this->pid = (new ProjectModel($this->container))->create(['name' => 'Track']);
        $this->settings = new RaceSettings($this->container);
    }

    public function testDefaultsAreOffSubtask30(): void
    {
        $s = $this->settings->get($this->pid);
        $this->assertSame('off', $s['visibility']);
        $this->assertSame('subtask', $s['units']);
        $this->assertSame(30, $s['window_days']);
        $this->assertMatchesRegularExpression('/^[0-9a-f]{64}$/', $s['token']);
        // Lazily created once, then stable.
        $this->assertSame($s['token'], $this->settings->get($this->pid)['token']);
    }

    public function testSaveRejectsUnknownVisibility(): void
    {
        $this->assertFalse($this->settings->save($this->pid, ['visibility' => 'everyone']));
        $this->assertSame('off', $this->settings->get($this->pid)['visibility']);
    }

    public function testWindowClamped(): void
    {
        $this->assertTrue($this->settings->save($this->pid, ['window_days' => 0]));
        $this->assertSame(1, $this->settings->get($this->pid)['window_days']);
        $this->assertTrue($this->settings->save($this->pid, ['window_days' => 9999]));
        $this->assertSame(365, $this->settings->get($this->pid)['window_days']);
    }

    public function testShareModeMatrix(): void
    {
        $token = $this->settings->get($this->pid)['token'];
        $expected = ['off' => null, 'members' => null, 'public' => 'full', 'map_only' => 'map_only'];
        foreach ($expected as $visibility => $mode) {
            $this->assertTrue($this->settings->save($this->pid, ['visibility' => $visibility]));
            $this->assertSame($mode, $this->settings->shareMode($token), $visibility);
        }
        $this->assertNull($this->settings->shareMode(str_repeat('0', 64)));
        $this->assertNull($this->settings->shareMode(''));
    }

    public function testRotateInvalidatesOldToken(): void
    {
        $old = $this->settings->get($this->pid)['token'];
        $new = $this->settings->rotateToken($this->pid);
        $this->assertNotSame($old, $new);
        $this->assertNull($this->settings->projectIdForToken($old));
        $this->assertSame($this->pid, $this->settings->projectIdForToken($new));
        $this->assertNull($this->settings->projectIdForToken(''));
    }

    // A failed write must not be reported as a rotated (or lazily created) token.
    public function testFailedTokenWriteThrowsOnRotate(): void
    {
        $this->expectException(\RuntimeException::class);
        $this->failingSettings()->rotateToken($this->pid);
    }

    public function testFailedTokenWriteThrowsOnLazyCreate(): void
    {
        $this->expectException(\RuntimeException::class);
        $this->failingSettings()->get($this->pid);
    }

    private function failingSettings(): RaceSettings
    {
        $this->container['projectMetadataModel'] = new class($this->container) extends \Kanboard\Model\ProjectMetadataModel {
            public function save($entity_id, array $values) { return false; }
        };
        return new RaceSettings($this->container);
    }
}

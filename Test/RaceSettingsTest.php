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

    public function testPageConfigCarriesTheProjectsUnits(): void
    {
        $this->assertSame(
            ['stateUrl' => '/s.json', 'mapOnly' => false, 'pollMs' => 20000, 'units' => 'subtask'],
            $this->settings->pageConfig($this->pid, '/s.json', false)
        );
        $this->assertTrue($this->settings->save($this->pid, ['units' => 'complexity']));
        $config = $this->settings->pageConfig($this->pid, '/race/t/state.json', true);
        $this->assertSame('complexity', $config['units']);
        $this->assertTrue($config['mapOnly']);
        $this->assertSame('/race/t/state.json', $config['stateUrl']);
    }

    public function testTokenLookupNeedsSixtyFourLowercaseHexCharacters(): void
    {
        foreach (['abc', str_repeat('A', 64), str_repeat('g', 64), str_repeat('a', 63), str_repeat('a', 65), str_repeat('a', 64)."\n"] as $bad) {
            $this->container['projectMetadataModel']->save($this->pid, [RaceSettings::META_TOKEN => $bad]);
            $this->assertNull($this->settings->projectIdForToken($bad), var_export($bad, true));
        }
    }

    public function testTokenHeldByTwoProjectsResolvesToNeither(): void
    {
        $token = $this->settings->get($this->pid)['token'];
        $other = (new ProjectModel($this->container))->create(['name' => 'Other']);
        $this->container['projectMetadataModel']->save($other, [RaceSettings::META_TOKEN => $token]);

        $this->assertNull($this->settings->projectIdForToken($token));
    }

    // Duplicating a project with its metadata copies chicane.token; the clone must not share the link.
    public function testDuplicatedProjectGetsItsOwnToken(): void
    {
        $token = $this->settings->get($this->pid)['token'];
        $this->assertTrue($this->settings->save($this->pid, ['visibility' => 'public']));
        $clone = (int) $this->container['projectDuplicationModel']->duplicate($this->pid, ['projectMetadataModel']);
        $this->assertGreaterThan($this->pid, $clone);
        $this->assertSame($token, $this->container['projectMetadataModel']->get($clone, RaceSettings::META_TOKEN), 'core copies the token');

        $cloneToken = $this->settings->get($clone)['token'];

        $this->assertMatchesRegularExpression('/^[0-9a-f]{64}$/', $cloneToken);
        $this->assertNotSame($token, $cloneToken);
        $this->assertSame($this->pid, $this->settings->projectIdForToken($token));
        $this->assertSame('full', $this->settings->shareMode($token));
        $this->assertSame($clone, $this->settings->projectIdForToken($cloneToken));
        $this->assertSame($token, $this->settings->get($this->pid)['token'], 'the original keeps its link');
        $this->assertSame($cloneToken, $this->settings->get($clone)['token'], 'the new token is stable');
    }

    private function failingSettings(): RaceSettings
    {
        $this->container['projectMetadataModel'] = new class($this->container) extends \Kanboard\Model\ProjectMetadataModel {
            public function save($entity_id, array $values) { return false; }
        };
        return new RaceSettings($this->container);
    }
}

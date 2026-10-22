<?php
require_once 'tests/units/Base.php';

use KanboardTests\units\Base;
use Kanboard\Core\Security\Role;
use Kanboard\Plugin\Agents\Model\AgentTable;
use Kanboard\Plugin\Chicane\Model\RaceFeeds;
use Kanboard\Plugin\Chicane\Model\RaceStateModel;
use Kanboard\Plugin\Presence\Model\PresenceModel;
use Kanboard\Plugin\TimeReport\Model\SubtaskCompletionStamp;
use Kanboard\Plugin\TimeReport\Model\XpModel;

class RaceFeedsTest extends Base
{
    private const NOW = 1_800_000_000;

    private int $projectId;
    private int $alice;
    private int $bob;

    protected function setUp(): void
    {
        parent::setUp();
        $c = $this->container;
        // The sibling plugins' tables, as their own migrations would create them. Whether a feed is
        // read is decided by the injected loader check, not by the tables existing.
        $pdo = $c['db']->getConnection();
        require_once dirname(__DIR__, 2).'/Presence/Schema/Sqlite.php';
        require_once dirname(__DIR__, 2).'/Agents/Schema/Sqlite.php';
        require_once dirname(__DIR__, 2).'/TimeReport/Schema/Sqlite.php';
        \Kanboard\Plugin\Presence\Schema\version_1($pdo);
        \Kanboard\Plugin\Agents\Schema\version_1($pdo);
        \Kanboard\Plugin\TimeReport\Schema\version_1($pdo);
        \Kanboard\Plugin\TimeReport\Schema\version_2($pdo);

        $this->projectId = (int) $c['projectModel']->create(['name' => 'Race']);
        $this->alice = (int) $c['userModel']->create(['username' => 'alice', 'name' => 'Alice A']);
        $this->bob = (int) $c['userModel']->create(['username' => 'bob', 'name' => 'Bob B']);
        $c['projectUserRoleModel']->addUser($this->projectId, $this->alice, Role::PROJECT_MEMBER);
        $c['projectUserRoleModel']->addUser($this->projectId, $this->bob, Role::PROJECT_MEMBER);
    }

    private function state(): array
    {
        $user = fn (int $id) => ['id' => $id, 'name' => '', 'username' => '', 'online' => null, 'xp' => null, 'level' => null];
        return [
            'window_days' => 14,
            'users' => [$user($this->alice), $user($this->bob)],
            'agent_uids' => [],
        ];
    }

    private function apply(callable $isLoaded): array
    {
        return (new RaceFeeds($this->container, $isLoaded))->apply($this->state(), $this->projectId, 0, self::NOW);
    }

    /** @return array<int, array> users keyed by id */
    private function users(array $state): array
    {
        return array_column($state['users'], null, 'id');
    }

    public function testAllAbsentLeavesNulls(): void
    {
        (new PresenceModel($this->container))->touch($this->alice, 'web', true, self::NOW);
        (new AgentTable($this->container))->insert($this->alice, $this->bob, 'claude');

        $state = $this->apply(fn () => false);

        foreach ($state['users'] as $user) {
            $this->assertNull($user['online']);
            $this->assertNull($user['xp']);
            $this->assertNull($user['level']);
        }
        $this->assertSame([], $state['agent_uids']);
    }

    public function testPresenceOnlineMapsTrue(): void
    {
        $this->assertTrue((new PresenceModel($this->container))->touch($this->alice, 'web', true, self::NOW));

        $users = $this->users($this->apply(fn (string $plugin) => $plugin === 'Presence'));

        $this->assertTrue($users[$this->alice]['online']);
        $this->assertFalse($users[$this->bob]['online']);
        $this->assertNull($users[$this->alice]['xp']);
    }

    public function testTimeReportLevel(): void
    {
        $taskId = (int) $this->container['taskCreationModel']->create(['project_id' => $this->projectId, 'title' => 'T']);
        $subtaskId = (int) $this->container['subtaskModel']->create(['task_id' => $taskId, 'title' => 'S', 'user_id' => $this->alice, 'status' => 2]);
        (new SubtaskCompletionStamp($this->container))->sync($subtaskId, 2, $this->alice, self::NOW - 3600);

        $users = $this->users($this->apply(fn (string $plugin) => $plugin === 'TimeReport'));

        $this->assertGreaterThan(0, $users[$this->alice]['xp']);
        $this->assertSame(XpModel::levelFor($users[$this->alice]['xp']), $users[$this->alice]['level']);
        $this->assertSame(0, $users[$this->bob]['xp']);
        $this->assertSame(1, $users[$this->bob]['level']);
        $this->assertNull($users[$this->alice]['online']);
    }

    public function testTimeReportCountsOnlyTheWindow(): void
    {
        $taskId = (int) $this->container['taskCreationModel']->create(['project_id' => $this->projectId, 'title' => 'T']);
        $subtaskId = (int) $this->container['subtaskModel']->create(['task_id' => $taskId, 'title' => 'S', 'user_id' => $this->alice, 'status' => 2]);
        (new SubtaskCompletionStamp($this->container))->sync($subtaskId, 2, $this->alice, self::NOW - 15 * 86400);

        $users = $this->users($this->apply(fn (string $plugin) => $plugin === 'TimeReport'));

        $this->assertSame(0, $users[$this->alice]['xp']);
    }

    public function testAgentsIds(): void
    {
        (new AgentTable($this->container))->insert($this->alice, $this->bob, 'claude');

        $state = $this->apply(fn (string $plugin) => $plugin === 'Agents');

        $this->assertSame([$this->bob], $state['agent_uids']);
    }

    // The default check asks Kanboard's plugin loader; a plugin whose class autoloads but that the
    // loader did not load (disabled or incompatible) counts as absent. build() applies the feeds.
    public function testBuildAppliesFeedsForLoadedPluginsOnly(): void
    {
        (new PresenceModel($this->container))->touch($this->alice, 'web', true, self::NOW);
        $taskId = (int) $this->container['taskCreationModel']->create(['project_id' => $this->projectId, 'title' => 'T']);
        $subtaskId = (int) $this->container['subtaskModel']->create(['task_id' => $taskId, 'title' => 'S', 'user_id' => $this->alice, 'status' => 2]);
        (new SubtaskCompletionStamp($this->container))->sync($subtaskId, 2, $this->alice, self::NOW - 3600);
        $this->container['pluginLoader'] = new class {
            public function getPlugins(): array { return ['TimeReport' => true]; }
        };

        $users = $this->users((new RaceStateModel($this->container))->build($this->projectId, 14, self::NOW));

        $this->assertSame(10, $users[$this->alice]['xp']);
        $this->assertNull($users[$this->alice]['online']);
    }
}

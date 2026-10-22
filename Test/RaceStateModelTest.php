<?php
require_once 'tests/units/Base.php';

use KanboardTests\units\Base;
use Kanboard\Core\Security\Role;
use Kanboard\Plugin\Chicane\Model\Json;
use Kanboard\Plugin\Chicane\Model\RaceStateModel;

class RaceStateModelTest extends Base
{
    private int $projectId;
    private int $laneA;
    private int $laneB;
    /** @var int[] */
    private array $columns;
    private int $alice;
    private int $bob;

    protected function setUp(): void
    {
        parent::setUp();
        $c = $this->container;
        $this->projectId = (int) $c['projectModel']->create(['name' => 'Race']);
        $this->columns = array_map('intval', array_keys($c['columnModel']->getList($this->projectId)));
        $c['columnModel']->remove(array_pop($this->columns));

        $this->laneA = (int) $c['swimlaneModel']->getFirstActiveSwimlaneId($this->projectId);
        $this->laneB = (int) $c['swimlaneModel']->create($this->projectId, 'Second lane');

        $this->alice = (int) $c['userModel']->create(['username' => 'alice', 'name' => 'Alice A']);
        $this->bob = (int) $c['userModel']->create(['username' => 'bob', 'name' => 'Bob B']);
        $c['projectUserRoleModel']->addUser($this->projectId, $this->alice, Role::PROJECT_MEMBER);
        $c['projectUserRoleModel']->addUser($this->projectId, $this->bob, Role::PROJECT_MEMBER);
    }

    private function model(): RaceStateModel
    {
        return new RaceStateModel($this->container);
    }

    private function task(string $title, array $extra = []): int
    {
        return (int) $this->container['taskCreationModel']->create($extra + [
            'project_id' => $this->projectId,
            'title' => $title,
            'column_id' => $this->columns[0],
            'swimlane_id' => $this->laneA,
        ]);
    }

    private function closeDaysAgo(int $taskId, int $days): void
    {
        $this->container['taskStatusModel']->close($taskId);
        $this->container['db']->table('tasks')->eq('id', $taskId)->update(['date_completed' => time() - $days * 86400]);
    }

    private function ids(array $state): array
    {
        return array_column($state['tasks'], 'id');
    }

    private function byId(array $state, int $id): array
    {
        foreach ($state['tasks'] as $task) {
            if ($task['id'] === $id) {
                return $task;
            }
        }
        $this->fail('task '.$id.' not in state');
    }

    public function testWindowIncludesOpenAndRecentClosedOnly(): void
    {
        $open = $this->task('open');
        $recent = $this->task('closed 10 days ago');
        $old = $this->task('closed 40 days ago');
        $this->closeDaysAgo($recent, 10);
        $this->closeDaysAgo($old, 40);

        $ids = $this->ids($this->model()->build($this->projectId, 30));

        $this->assertContains($open, $ids);
        $this->assertContains($recent, $ids);
        $this->assertNotContains($old, $ids);
    }

    public function testShapeAndIntTypes(): void
    {
        $taskId = $this->task('shape', ['owner_id' => $this->alice, 'tags' => ['wontfix']]);
        $this->container['subtaskModel']->create(['task_id' => $taskId, 'title' => 's', 'user_id' => $this->bob]);
        $this->container['commentModel']->create(['task_id' => $taskId, 'user_id' => $this->alice, 'comment' => 'hi']);

        $state = $this->model()->build($this->projectId, 30, 1700000000);

        $this->assertSame(
            ['generated', 'window_days', 'project_id', 'swimlanes', 'columns', 'users', 'agent_uids', 'reopened', 'tasks'],
            array_keys($state)
        );
        $this->assertSame(1700000000, $state['generated']);
        $this->assertSame(30, $state['window_days']);
        $this->assertSame($this->projectId, $state['project_id']);
        $this->assertSame([], $state['agent_uids']);
        $this->assertSame(['id', 'name', 'position'], array_keys($state['swimlanes'][0]));
        $this->assertSame(['id', 'title', 'position', 'role'], array_keys($state['columns'][0]));
        $this->assertCount(3, $state['columns']);
        $this->assertSame([$this->laneA, $this->laneB], array_column($state['swimlanes'], 'id'));
        $this->assertSame(
            ['id' => $this->alice, 'name' => 'Alice A', 'username' => 'alice', 'online' => null, 'xp' => null, 'level' => null],
            $state['users'][0]
        );

        $task = $state['tasks'][0];
        $this->assertSame(
            ['id', 'title', 'open', 'column_id', 'swimlane_id', 'owner_id', 'position', 'score', 'date_moved', 'date_completed', 'tags', 'blocked_by', 'subtasks', 'comments'],
            array_keys($task)
        );
        $this->assertIsInt($task['id']);
        $this->assertTrue($task['open']);
        $this->assertSame($this->columns[0], $task['column_id']);
        $this->assertSame($this->laneA, $task['swimlane_id']);
        $this->assertSame($this->alice, $task['owner_id']);
        $this->assertIsInt($task['position']);
        $this->assertIsInt($task['score']);
        $this->assertIsInt($task['date_moved']);
        $this->assertNull($task['date_completed']);
        $this->assertSame(['wontfix'], $task['tags']);
        $this->assertSame([['status' => 0, 'position' => 1, 'user_id' => $this->bob]], $task['subtasks']);
        $this->assertSame($this->alice, $task['comments'][0]['user_id']);
        $this->assertIsInt($task['comments'][0]['date']);
    }

    private function rolesOf(array $titles): array
    {
        $projectId = (int) $this->container['projectModel']->create(['name' => 'Roles']);
        $ids = array_map('intval', array_keys($this->container['columnModel']->getList($projectId)));
        // Column titles are unique per project: drop the spare defaults, park the rest, then rename.
        foreach (array_slice($ids, count($titles)) as $id) {
            $this->container['columnModel']->remove($id);
        }
        $ids = array_slice($ids, 0, count($titles));
        foreach ($ids as $i => $id) {
            $this->container['columnModel']->update($id, 'tmp '.$i);
        }
        foreach ($ids as $i => $id) {
            $this->container['columnModel']->update($id, $titles[$i]);
        }
        for ($i = count($ids); $i < count($titles); $i++) {
            $this->container['columnModel']->create($projectId, $titles[$i]);
        }
        $columns = $this->model()->build($projectId, 30)['columns'];
        return array_combine(array_column($columns, 'title'), array_column($columns, 'role'));
    }

    // Kanboard's default board: Backlog, Ready, Work in progress, Done.
    public function testDefaultColumnsGetRoles(): void
    {
        $projectId = (int) $this->container['projectModel']->create(['name' => 'Default']);

        $columns = $this->model()->build($projectId, 30)['columns'];

        $this->assertSame(['Backlog', 'Ready', 'Work in progress', 'Done'], array_column($columns, 'title'));
        $this->assertSame([null, null, 'in_progress', 'done'], array_column($columns, 'role'));
    }

    public function testRolesMatchAliasesIgnoringCase(): void
    {
        $this->assertSame(['Ideas' => null, 'IN PROGRESS' => 'in_progress', 'done' => 'done'], $this->rolesOf(['Ideas', 'IN PROGRESS', 'done']));
        $this->assertSame(['Todo' => null, 'Doing' => 'in_progress', 'WIP' => 'in_progress', 'Done' => 'done'], $this->rolesOf(['Todo', 'Doing', 'WIP', 'Done']));
    }

    // No alias matches: the last column is done and the one before it is in progress.
    public function testRenamedColumnsFallBackByPosition(): void
    {
        $this->assertSame(['Todo' => null, 'Building' => 'in_progress', 'Shipped' => 'done'], $this->rolesOf(['Todo', 'Building', 'Shipped']));
        // Each role falls back on its own (in progress sits just before done), never onto a column that has one.
        $this->assertSame(['Todo' => null, 'Doing' => 'in_progress', 'Shipped' => 'done'], $this->rolesOf(['Todo', 'Doing', 'Shipped']));
        $this->assertSame(['Todo' => null, 'Building' => 'in_progress', 'Done' => 'done'], $this->rolesOf(['Todo', 'Building', 'Done']));
        $this->assertSame(['Todo' => null, 'Building' => 'in_progress', 'Done' => 'done', 'Archive' => null], $this->rolesOf(['Todo', 'Building', 'Done', 'Archive']));
        $this->assertSame(['Todo' => null, 'Work in progress' => 'in_progress'], $this->rolesOf(['Todo', 'Work in progress']));
        $this->assertSame(['Only' => 'done'], $this->rolesOf(['Only']));
    }

    public function testDefaultBoardPutsCarsInTheSummary(): void
    {
        $projectId = (int) $this->container['projectModel']->create(['name' => 'Default']);
        $this->container['projectUserRoleModel']->addUser($projectId, $this->alice, Role::PROJECT_MEMBER);
        $wip = (int) $this->container['columnModel']->getColumnIdByTitle($projectId, 'Work in progress');
        $taskId = (int) $this->container['taskCreationModel']->create(['project_id' => $projectId, 'title' => 'w', 'column_id' => $wip, 'owner_id' => $this->alice]);

        $summary = \Kanboard\Plugin\Chicane\Model\RaceSummary::build($this->model()->build($projectId, 30), 'full', 'subtask');

        $this->assertSame([['user' => 'Alice A', 'task_id' => $taskId]], $summary['cars']);
    }

    public function testBlockedByComesFromLinks(): void
    {
        $a = $this->task('A');
        $b = $this->task('B');
        $blockedBy = (int) $this->container['linkModel']->getByLabel('is blocked by')['id'];
        $this->container['taskLinkModel']->create($a, $b, $blockedBy);

        $state = $this->model()->build($this->projectId, 30);

        $this->assertSame([$b], $this->byId($state, $a)['blocked_by']);
        $this->assertSame([], $this->byId($state, $b)['blocked_by']);
    }

    public function testReopenedFromActivity(): void
    {
        $taskId = $this->task('reopened');
        $other = $this->task('never closed');
        $this->container['taskStatusModel']->close($taskId);
        $this->container['taskStatusModel']->open($taskId);
        // Ruling 3: the unit-test container wires no activity subscriber, so write the event core would.
        $this->container['projectActivityModel']->createEvent($this->projectId, $taskId, $this->alice, 'task.open', []);

        $state = $this->model()->build($this->projectId, 30);

        $this->assertSame([$taskId], $state['reopened']);
        $this->assertNotContains($other, $state['reopened']);
    }

    public function testReopenedOutsideWindowIsIgnored(): void
    {
        $taskId = $this->task('reopened long ago');
        $this->container['projectActivityModel']->createEvent($this->projectId, $taskId, $this->alice, 'task.open', []);

        $state = $this->model()->build($this->projectId, 30, time() + 31 * 86400);

        $this->assertSame([], $state['reopened']);
    }

    public function testOrphanOwnerAndInactiveSwimlane(): void
    {
        $orphan = $this->task('orphan', ['owner_id' => $this->bob]);
        $this->container['projectUserRoleModel']->removeUser($this->projectId, $this->bob);
        $hidden = $this->task('hidden lane', ['swimlane_id' => $this->laneB]);
        $this->container['swimlaneModel']->disable($this->projectId, $this->laneB);

        $state = $this->model()->build($this->projectId, 30);

        $this->assertSame($this->bob, $this->byId($state, $orphan)['owner_id']);
        $this->assertNotContains($this->bob, array_column($state['users'], 'id'));
        $this->assertSame($this->laneB, $this->byId($state, $hidden)['swimlane_id']);
    }

    public function testUserWithoutANameIsListedByUsername(): void
    {
        $nameless = (int) $this->container['userModel']->create(['username' => 'zed']);
        $this->container['projectUserRoleModel']->addUser($this->projectId, $nameless, Role::PROJECT_MEMBER);

        $users = array_column($this->model()->build($this->projectId, 30)['users'], 'name', 'id');

        $this->assertSame('zed', $users[$nameless]);
        $this->assertSame('Alice A', $users[$this->alice]);
    }

    public function testInactiveUserIsNotListed(): void
    {
        $this->container['userModel']->disable($this->bob);

        $state = $this->model()->build($this->projectId, 30);

        $this->assertSame([$this->alice], array_column($state['users'], 'id'));
    }

    public function testEtagStableAcrossGenerated(): void
    {
        $this->task('steady');
        $now = time();
        $model = $this->model();

        $first = $model->build($this->projectId, 30, $now);
        $second = $model->build($this->projectId, 30, $now + 5);

        $this->assertNotSame($first['generated'], $second['generated']);
        $this->assertSame($model->etag($first), $model->etag($second));
        $this->assertSame(40, strlen($model->etag($first)));
    }

    public function testCommentsCarryNoText(): void
    {
        $taskId = $this->task('chatty');
        $this->container['commentModel']->create(['task_id' => $taskId, 'user_id' => $this->alice, 'comment' => 'secret words']);

        $state = $this->model()->build($this->projectId, 30);

        $this->assertSame(['user_id', 'date'], array_keys($this->byId($state, $taskId)['comments'][0]));
        $this->assertStringNotContainsString('secret words', json_encode($state));
    }

    public function testInvalidUtf8TitleStillEncodes(): void
    {
        $this->task("broken \xB1 title");
        $model = $this->model();

        $state = $model->build($this->projectId, 30);
        $body = Json::encode((object) $state);
        $withoutGenerated = $state;
        unset($withoutGenerated['generated']);

        $this->assertSame("broken \u{FFFD} title", json_decode($body, true)['tasks'][0]['title']);
        $this->assertNotSame(sha1(''), $model->etag($state));
        $this->assertSame(sha1(Json::encode($withoutGenerated)), $model->etag($state));
    }
}

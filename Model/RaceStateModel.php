<?php
namespace Kanboard\Plugin\Chicane\Model;

use Kanboard\Core\Base;

// The race state for one project: open tasks plus tasks closed within the window, with the subtasks,
// comments (author and date only), tags and blockers the track needs. One query per table, grouped in PHP.
class RaceStateModel extends Base
{
    private const BLOCKED_BY = 'is blocked by';
    private const REOPEN_EVENT = 'task.open';

    public function build(int $projectId, int $windowDays, ?int $now = null): array
    {
        $now ??= time();
        $since = $now - $windowDays * 86400;
        $tasks = $this->tasks($projectId, $since);
        $taskIds = array_column($tasks, 'id');

        $subtasks = $this->groupByTask($taskIds, $this->db->table('subtasks')
            ->columns('task_id', 'status', 'position', 'user_id'), ['status', 'position', 'user_id'], 'position');
        $comments = $this->groupByTask($taskIds, $this->db->table('comments')
            ->columns('task_id', 'user_id', 'date_creation AS date'), ['user_id', 'date'], 'date_creation');
        $tags = $this->tags($taskIds);
        $blockers = $this->blockers($taskIds);

        foreach ($tasks as &$task) {
            $id = $task['id'];
            $task['tags'] = $tags[$id] ?? [];
            $task['blocked_by'] = $blockers[$id] ?? [];
            $task['subtasks'] = $subtasks[$id] ?? [];
            $task['comments'] = $comments[$id] ?? [];
        }
        unset($task);

        $state = [
            'generated' => $now,
            'window_days' => $windowDays,
            'project_id' => $projectId,
            'swimlanes' => $this->swimlanes($projectId),
            'columns' => $this->columns($projectId),
            'users' => $this->users($projectId),
            'agent_uids' => [],
            'reopened' => $this->reopened($projectId, $since),
            'tasks' => $tasks,
        ];

        // The viewer only marks is_self in Presence's lineup; the public share route has none (0).
        return (new RaceFeeds($this->container))->apply($state, $projectId, (int) $this->userSession->getId(), $now);
    }

    // Ignores `generated`, so an unchanged board keeps its ETag between polls.
    public function etag(array $state): string
    {
        unset($state['generated']);
        return sha1(Json::encode($state));
    }

    private function tasks(int $projectId, int $since): array
    {
        $rows = $this->db->table('tasks')
            ->columns('id', 'title', 'is_active', 'column_id', 'swimlane_id', 'owner_id', 'position', 'score', 'date_moved', 'date_completed')
            ->eq('project_id', $projectId)
            ->beginOr()
                ->eq('is_active', 1)
                ->gte('date_completed', $since)
            ->closeOr()
            ->asc('id')
            ->findAll();

        return array_map(fn (array $row) => [
            'id' => (int) $row['id'],
            'title' => (string) $row['title'],
            'open' => (int) $row['is_active'] === 1,
            'column_id' => (int) $row['column_id'],
            'swimlane_id' => (int) $row['swimlane_id'],
            'owner_id' => (int) $row['owner_id'],
            'position' => (int) $row['position'],
            'score' => (int) $row['score'],
            'date_moved' => (int) $row['date_moved'],
            'date_completed' => $row['date_completed'] ? (int) $row['date_completed'] : null,
        ], $rows);
    }

    /** @return array<int, list<array<string,int>>> rows keyed by task id, each reduced to $fields as ints */
    private function groupByTask(array $taskIds, $query, array $fields, string $order): array
    {
        if ($taskIds === []) {
            return [];
        }
        $grouped = [];
        foreach ($query->in('task_id', $taskIds)->asc($order)->asc('id')->findAll() as $row) {
            $item = [];
            foreach ($fields as $field) {
                $item[$field] = (int) $row[$field];
            }
            $grouped[(int) $row['task_id']][] = $item;
        }
        return $grouped;
    }

    private function tags(array $taskIds): array
    {
        if ($taskIds === []) {
            return [];
        }
        $grouped = [];
        $rows = $this->db->table('task_has_tags')
            ->columns('task_has_tags.task_id', 'tags.name')
            ->join('tags', 'id', 'tag_id')
            ->in('task_has_tags.task_id', $taskIds)
            ->asc('tags.name')
            ->findAll();
        foreach ($rows as $row) {
            $grouped[(int) $row['task_id']][] = (string) $row['name'];
        }
        return $grouped;
    }

    private function blockers(array $taskIds): array
    {
        if ($taskIds === []) {
            return [];
        }
        $grouped = [];
        $rows = $this->db->table('task_has_links')
            ->columns('task_has_links.task_id', 'task_has_links.opposite_task_id')
            ->join('links', 'id', 'link_id')
            ->eq('links.label', self::BLOCKED_BY)
            ->in('task_has_links.task_id', $taskIds)
            ->asc('task_has_links.opposite_task_id')
            ->findAll();
        foreach ($rows as $row) {
            $grouped[(int) $row['task_id']][] = (int) $row['opposite_task_id'];
        }
        return $grouped;
    }

    // Active swimlanes only: a task in a disabled lane keeps its swimlane_id and the track places it in lane 0.
    private function swimlanes(int $projectId): array
    {
        $rows = $this->db->table('swimlanes')
            ->columns('id', 'name', 'position')
            ->eq('project_id', $projectId)
            ->eq('is_active', 1)
            ->asc('position')
            ->asc('id')
            ->findAll();

        return array_map(fn (array $row) => [
            'id' => (int) $row['id'],
            'name' => (string) $row['name'],
            'position' => (int) $row['position'],
        ], $rows);
    }

    private function columns(int $projectId): array
    {
        $rows = $this->db->table('columns')
            ->columns('id', 'title', 'position')
            ->eq('project_id', $projectId)
            ->asc('position')
            ->findAll();

        return array_map(fn (array $row) => [
            'id' => (int) $row['id'],
            'title' => (string) $row['title'],
            'position' => (int) $row['position'],
        ], $rows);
    }

    // Active users who are members directly or through a group; one entry each, ordered by id.
    private function users(int $projectId): array
    {
        $direct = $this->db->table('project_has_users')
            ->columns('users.id', 'users.name', 'users.username')
            ->join('users', 'id', 'user_id')
            ->eq('project_has_users.project_id', $projectId)
            ->eq('users.is_active', 1)
            ->findAll();
        $viaGroup = $this->db->table('project_has_groups')
            ->columns('users.id', 'users.name', 'users.username')
            ->join('group_has_users', 'group_id', 'group_id', 'project_has_groups')
            ->join('users', 'id', 'user_id', 'group_has_users')
            ->eq('project_has_groups.project_id', $projectId)
            ->eq('users.is_active', 1)
            ->findAll();

        $users = [];
        foreach (array_merge($direct, $viaGroup) as $row) {
            $users[(int) $row['id']] = [
                'id' => (int) $row['id'],
                'name' => (string) $row['name'],
                'username' => (string) $row['username'],
                'online' => null,
                'xp' => null,
                'level' => null,
            ];
        }
        ksort($users);
        return array_values($users);
    }

    // Read from project_activities directly: the API's activity feed stops at the last 50 events.
    private function reopened(int $projectId, int $since): array
    {
        $ids = $this->db->table('project_activities')
            ->eq('project_id', $projectId)
            ->eq('event_name', self::REOPEN_EVENT)
            ->gte('date_creation', $since)
            ->asc('task_id')
            ->findAllByColumn('task_id');

        return array_values(array_unique(array_map('intval', $ids)));
    }
}

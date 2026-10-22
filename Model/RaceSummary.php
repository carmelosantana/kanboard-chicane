<?php
namespace Kanboard\Plugin\Chicane\Model;

// The Chat summary of a race state, counting units exactly as track.js orderTasks does for the project's
// chicane.units. subtask: each subtask is 1, a task with none is 1; done is a subtask with status 2, or a
// closed task with none (a closed task's open subtasks stay undone). complexity: n = max(1, score, subtasks)
// per task; with subtasks, floor(n * done subtasks / subtasks) are done, open or closed; with none, n when
// closed, else 0.
final class RaceSummary
{
    private const IN_PROGRESS = 'in_progress';
    private const SUBTASK_DONE = 2;

    public static function build(array $state, string $mode, string $units): array
    {
        $total = 0;
        $done = 0;
        foreach ($state['tasks'] as $task) {
            [$taskTotal, $taskDone] = self::units($task, $units);
            $total += $taskTotal;
            $done += $taskDone;
        }

        return [
            'project_id' => $state['project_id'],
            'progress_pct' => $total === 0 ? 0.0 : round($done / $total * 100, 1),
            'distance_to_finish' => $total - $done,
            'cars' => self::cars($state, $mode === 'map_only', $units),
            'updated_at' => $state['generated'],
        ];
    }

    // Ignores updated_at (it moves on every build), so an unchanged board keeps its ETag and can answer 304.
    public static function etag(array $summary): string
    {
        unset($summary['updated_at']);
        return sha1(Json::encode($summary));
    }

    /** @return array{int, int} [units, done units] */
    private static function units(array $task, string $units): array
    {
        return $units === 'complexity' ? self::complexityUnits($task) : self::subtaskUnits($task);
    }

    /** @return array{int, int} [units, done units] */
    private static function subtaskUnits(array $task): array
    {
        if ($task['subtasks'] === []) {
            return [1, $task['open'] ? 0 : 1];
        }
        return [count($task['subtasks']), self::doneSubtasks($task)];
    }

    /** @return array{int, int} [units, done units] */
    private static function complexityUnits(array $task): array
    {
        $subtasks = count($task['subtasks']);
        $units = max(1, (int) ($task['score'] ?? 0), $subtasks);
        if ($subtasks > 0) {
            return [$units, intdiv($units * self::doneSubtasks($task), $subtasks)];
        }
        return [$units, $task['open'] ? 0 : $units];
    }

    private static function doneSubtasks(array $task): int
    {
        return count(array_filter($task['subtasks'], fn (array $s) => (int) $s['status'] === self::SUBTASK_DONE));
    }

    // One car per listed user with an open task in an in-progress column (by role). Of several, the car takes
    // the most-progressed (done units / units in the project's units mode), then the earliest on the track:
    // lane (swimlane order, 0 when unlisted), position, id. The same rule as track.js build().
    private static function cars(array $state, bool $mapOnly, string $units): array
    {
        $inProgress = [];
        foreach ($state['columns'] as $column) {
            if (($column['role'] ?? null) === self::IN_PROGRESS) {
                $inProgress[$column['id']] = true;
            }
        }
        $lanes = array_flip(array_column($state['swimlanes'] ?? [], 'id'));

        $best = [];
        foreach ($state['tasks'] as $task) {
            if (! $task['open'] || ! isset($inProgress[$task['column_id']])) {
                continue;
            }
            [$taskUnits, $taskDone] = self::units($task, $units);
            $key = [-$taskDone / $taskUnits, $lanes[$task['swimlane_id'] ?? 0] ?? 0, $task['position'] ?? 0, $task['id']];
            $owner = $task['owner_id'];
            if (! isset($best[$owner]) || $key < $best[$owner]['key']) {
                $best[$owner] = ['key' => $key, 'id' => $task['id']];
            }
        }
        $taskByOwner = array_map(fn (array $b) => $b['id'], $best);

        $cars = [];
        foreach ($state['users'] as $user) {
            if (isset($taskByOwner[$user['id']])) {
                $cars[] = $mapOnly
                    ? ['user' => RaceRedactor::initials($user['name']), 'task_id' => null]
                    : ['user' => $user['name'], 'task_id' => $taskByOwner[$user['id']]];
            }
        }
        return $cars;
    }
}

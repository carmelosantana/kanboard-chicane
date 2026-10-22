<?php
namespace Kanboard\Plugin\Chicane\Model;

// The Chat summary of a race state, counting units exactly as track.js orderTasks does for the project's
// chicane.units. subtask: each subtask is 1, a task with none is 1; done is a subtask with status 2, or a
// closed task with none (a closed task's open subtasks stay undone). complexity: max(1, score, subtasks)
// per task; a closed task is all done, an open one leaves its open subtasks (1 if it has none) undone.
final class RaceSummary
{
    private const IN_PROGRESS = 'In progress';
    private const SUBTASK_DONE = 2;

    public static function build(array $state, string $mode, string $units): array
    {
        $total = 0;
        $done = 0;
        foreach ($state['tasks'] as $task) {
            [$taskTotal, $taskDone] = $units === 'complexity' ? self::complexityUnits($task) : self::subtaskUnits($task);
            $total += $taskTotal;
            $done += $taskDone;
        }

        return [
            'project_id' => $state['project_id'],
            'progress_pct' => $total === 0 ? 0.0 : round($done / $total * 100, 1),
            'distance_to_finish' => $total - $done,
            'cars' => self::cars($state, $mode === 'map_only'),
            'updated_at' => $state['generated'],
        ];
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
        $open = ! $task['open'] ? 0 : ($subtasks > 0 ? $subtasks - self::doneSubtasks($task) : 1);
        return [$units, $units - $open];
    }

    private static function doneSubtasks(array $task): int
    {
        return count(array_filter($task['subtasks'], fn (array $s) => (int) $s['status'] === self::SUBTASK_DONE));
    }

    // One car per listed user with an open task in the In progress column, on their first such task.
    private static function cars(array $state, bool $mapOnly): array
    {
        $inProgress = [];
        foreach ($state['columns'] as $column) {
            if ($column['title'] === self::IN_PROGRESS) {
                $inProgress[$column['id']] = true;
            }
        }

        $taskByOwner = [];
        foreach ($state['tasks'] as $task) {
            if ($task['open'] && isset($inProgress[$task['column_id']])) {
                $taskByOwner[$task['owner_id']] ??= $task['id'];
            }
        }

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

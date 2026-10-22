<?php
namespace Kanboard\Plugin\Chicane\Model;

// The Chat summary of a race state. Units: each subtask is 1, a task with no subtasks is 1. Done: a
// subtask with status 2, or a closed task with no subtasks (a closed task's open subtasks stay undone).
final class RaceSummary
{
    private const IN_PROGRESS = 'In progress';
    private const SUBTASK_DONE = 2;

    public static function build(array $state, string $mode): array
    {
        $total = 0;
        $done = 0;
        foreach ($state['tasks'] as $task) {
            if ($task['subtasks'] === []) {
                $total++;
                $done += $task['open'] ? 0 : 1;
                continue;
            }
            foreach ($task['subtasks'] as $subtask) {
                $total++;
                $done += (int) $subtask['status'] === self::SUBTASK_DONE ? 1 : 0;
            }
        }

        return [
            'project_id' => $state['project_id'],
            'progress_pct' => $total === 0 ? 0.0 : round($done / $total * 100, 1),
            'distance_to_finish' => $total - $done,
            'cars' => self::cars($state, $mode === 'map_only'),
            'updated_at' => $state['generated'],
        ];
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

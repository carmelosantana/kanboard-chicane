<?php
namespace Kanboard\Plugin\Chicane\Model;

// Map-only view of a race state: same shape, with every name-bearing string removed on the server.
// Task titles go blank, users become initials, swimlanes become "Lane N", columns "Column N" (the track
// reads their role, never the title), and tags are dropped (the track only needs `wontfix` and `blocked`,
// kept as booleans).
final class RaceRedactor
{
    private const WONTFIX = 'wontfix';
    private const BLOCKED = ['blocked', 'needs-info'];

    public static function mapOnly(array $state): array
    {
        foreach ($state['swimlanes'] as $index => &$lane) {
            $lane['name'] = 'Lane '.($index + 1);
        }
        unset($lane);

        foreach ($state['columns'] as $index => &$column) {
            $column['title'] = 'Column '.($index + 1);
        }
        unset($column);

        foreach ($state['users'] as &$user) {
            $user['name'] = self::initials($user['name']);
            $user['username'] = '';
        }
        unset($user);

        foreach ($state['tasks'] as &$task) {
            $task['title'] = '';
            $task['wontfix'] = in_array(self::WONTFIX, $task['tags'], true);
            $task['blocked'] = array_intersect(self::BLOCKED, $task['tags']) !== [];
            $task['tags'] = [];
        }
        unset($task);

        return $state;
    }

    // First letters of the first two words, or the first two letters of a single word; '?' when blank.
    // Words are runs of letters and digits, so punctuation ("Bob (QA)", "site.com") never becomes an initial.
    public static function initials(string $name): string
    {
        $words = preg_split('/[^\p{L}\p{N}]+/u', $name, -1, PREG_SPLIT_NO_EMPTY) ?: [];
        if ($words === []) {
            return '?';
        }
        $initials = count($words) > 1
            ? mb_substr($words[0], 0, 1).mb_substr($words[1], 0, 1)
            : mb_substr($words[0], 0, 2);
        return mb_strtoupper($initials);
    }
}

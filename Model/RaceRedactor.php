<?php
namespace Kanboard\Plugin\Chicane\Model;

// Map-only view of a race state: same shape, with every name-bearing string removed on the server.
// Task titles go blank, users become initials, swimlanes become "Lane N", and tags are dropped
// (the track only needs `wontfix`, kept as a boolean).
final class RaceRedactor
{
    private const WONTFIX = 'wontfix';

    public static function mapOnly(array $state): array
    {
        foreach ($state['swimlanes'] as $index => &$lane) {
            $lane['name'] = 'Lane '.($index + 1);
        }
        unset($lane);

        foreach ($state['users'] as &$user) {
            $user['name'] = self::initials($user['name']);
            $user['username'] = '';
        }
        unset($user);

        foreach ($state['tasks'] as &$task) {
            $task['title'] = '';
            $task['wontfix'] = in_array(self::WONTFIX, $task['tags'], true);
            $task['tags'] = [];
        }
        unset($task);

        return $state;
    }

    // First letters of the first two words, or the first two letters of a single word; '?' when blank.
    public static function initials(string $name): string
    {
        $words = preg_split('/\s+/u', trim($name), -1, PREG_SPLIT_NO_EMPTY) ?: [];
        if ($words === []) {
            return '?';
        }
        $initials = count($words) > 1
            ? mb_substr($words[0], 0, 1).mb_substr($words[1], 0, 1)
            : mb_substr($words[0], 0, 2);
        return mb_strtoupper($initials);
    }
}

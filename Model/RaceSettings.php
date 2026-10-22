<?php
namespace Kanboard\Plugin\Chicane\Model;

use Kanboard\Core\Base;

// Per-project race settings in project_has_metadata (no schema). Defaults are private: visibility off.
class RaceSettings extends Base
{
    public const VISIBILITY = ['off', 'members', 'public', 'map_only'];
    public const UNITS = ['subtask', 'complexity'];
    public const POLL_MS = 20000;
    public const META_VISIBILITY = 'chicane.visibility';
    public const META_TOKEN = 'chicane.token';
    public const META_WINDOW = 'chicane.window_days';
    public const META_UNITS = 'chicane.units';

    private const DEFAULT_WINDOW = 30;
    private const MIN_WINDOW = 1;
    private const MAX_WINDOW = 365;

    /** @return array{visibility:string, token:string, window_days:int, units:string} */
    public function get(int $projectId): array
    {
        $meta = $this->projectMetadataModel->getAll($projectId);
        $token = (string) ($meta[self::META_TOKEN] ?? '');
        if ($token === '') {
            $token = $this->rotateToken($projectId);
        }

        return [
            'visibility' => $this->visibility($meta[self::META_VISIBILITY] ?? null),
            'token' => $token,
            'window_days' => isset($meta[self::META_WINDOW]) ? $this->clampWindow((int) $meta[self::META_WINDOW]) : self::DEFAULT_WINDOW,
            'units' => in_array($meta[self::META_UNITS] ?? null, self::UNITS, true) ? $meta[self::META_UNITS] : self::UNITS[0],
        ];
    }

    // The race page's chicane-config JSON, the same for the members and share routes.
    /** @return array{stateUrl:string, mapOnly:bool, pollMs:int, units:string} */
    public function pageConfig(int $projectId, string $stateUrl, bool $mapOnly): array
    {
        return ['stateUrl' => $stateUrl, 'mapOnly' => $mapOnly, 'pollMs' => self::POLL_MS, 'units' => $this->get($projectId)['units']];
    }

    // Saves only the keys present; any invalid value rejects the whole save.
    public function save(int $projectId, array $values): bool
    {
        $meta = [];
        if (array_key_exists('visibility', $values)) {
            if (! in_array($values['visibility'], self::VISIBILITY, true)) {
                return false;
            }
            $meta[self::META_VISIBILITY] = $values['visibility'];
        }
        if (array_key_exists('window_days', $values)) {
            if (! is_numeric($values['window_days'])) {
                return false;
            }
            $meta[self::META_WINDOW] = (string) $this->clampWindow((int) $values['window_days']);
        }
        if (array_key_exists('units', $values)) {
            if (! in_array($values['units'], self::UNITS, true)) {
                return false;
            }
            $meta[self::META_UNITS] = $values['units'];
        }

        return $meta === [] || $this->projectMetadataModel->save($projectId, $meta);
    }

    // Throws when the write fails: the token gates public access, so an unpersisted one is never returned.
    public function rotateToken(int $projectId): string
    {
        $token = bin2hex(random_bytes(32));
        if (! $this->projectMetadataModel->save($projectId, [self::META_TOKEN => $token])) {
            throw new \RuntimeException('Unable to save the Chicane share token for project '.$projectId);
        }
        return $token;
    }

    public function projectIdForToken(string $token): ?int
    {
        if ($token === '') {
            return null;
        }
        $id = $this->db->table('project_has_metadata')
            ->eq('name', self::META_TOKEN)
            ->eq('value', $token)
            ->findOneColumn('project_id');

        return $id ? (int) $id : null;
    }

    // Public share mode for a token: 'full' (public), 'map_only', or null (no public access).
    public function shareMode(string $token): ?string
    {
        $projectId = $this->projectIdForToken($token);
        return $projectId === null ? null : $this->shareModeOf($projectId);
    }

    // Public share mode for a project whose token is already resolved.
    public function shareModeOf(int $projectId): ?string
    {
        return RaceGate::decide($this->visibilityOf($projectId), false, true);
    }

    // Read-only visibility lookup (no lazy token write), for per-render checks such as the project dropdown.
    public function visibilityOf(int $projectId): string
    {
        return $this->visibility($this->projectMetadataModel->get($projectId, self::META_VISIBILITY, null));
    }

    private function visibility(mixed $value): string
    {
        return in_array($value, self::VISIBILITY, true) ? $value : self::VISIBILITY[0];
    }

    private function clampWindow(int $days): int
    {
        return max(self::MIN_WINDOW, min(self::MAX_WINDOW, $days));
    }
}

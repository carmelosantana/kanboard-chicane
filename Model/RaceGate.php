<?php
namespace Kanboard\Plugin\Chicane\Model;

// Who sees what: 'full', 'map_only', or null (404). Members on the direct route always get full detail;
// a share token never authorises the members-only view, whoever holds it.
final class RaceGate
{
    public static function decide(?string $visibility, bool $isMember, bool $viaToken): ?string
    {
        if ($viaToken) {
            return match ($visibility) {
                'public' => 'full',
                'map_only' => 'map_only',
                default => null,
            };
        }

        return $isMember && in_array($visibility, ['members', 'public', 'map_only'], true) ? 'full' : null;
    }
}

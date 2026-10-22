<?php
namespace Kanboard\Plugin\Chicane\Model;

use Kanboard\Core\Base;

// Optional data from sibling plugins: Presence (online), Agents (agent_uids) and TimeReport (xp, level).
// A plugin counts only when Kanboard's loader loaded it and its class autoloads; otherwise its fields keep
// their "absent" values (null, or [] for agent_uids). A feed that throws anything (SQL, or a TypeError from a
// mismatched plugin version) is logged and left absent.
class RaceFeeds extends Base
{
    private const PRESENCE = 'Kanboard\\Plugin\\Presence\\Model\\PresenceModel';
    private const AGENTS = 'Kanboard\\Plugin\\Agents\\Model\\AgentTable';
    private const XP = 'Kanboard\\Plugin\\TimeReport\\Model\\XpModel';

    /** @var callable(string): bool */
    private $isLoaded;

    public function __construct($container, ?callable $isLoaded = null)
    {
        parent::__construct($container);
        $this->isLoaded = $isLoaded ?? fn (string $plugin): bool => isset($this->container['pluginLoader'])
            && array_key_exists($plugin, $this->container['pluginLoader']->getPlugins());
    }

    public function apply(array $state, int $projectId, int $viewerId, ?int $now = null): array
    {
        $now ??= time();
        $userIds = array_column($state['users'], 'id');

        $online = $this->feed('Presence', self::PRESENCE, function (string $class) use ($projectId, $viewerId, $now) {
            $lineup = (new $class($this->container))->lineup($projectId, $viewerId, $now);
            return array_column($lineup, 'state', 'user_id');
        });
        $agents = $this->feed('Agents', self::AGENTS, fn (string $class) => (new $class($this->container))->agentIds($userIds));
        $xp = $this->feed('TimeReport', self::XP, fn (string $class) => (new $class($this->container))
            ->byUser($projectId, $now - (int) $state['window_days'] * 86400, $now));

        $xpModel = self::XP;
        foreach ($state['users'] as &$user) {
            $id = $user['id'];
            if ($online !== null) {
                $user['online'] = ($online[$id] ?? null) === 'online';
            }
            if ($xp !== null) {
                $user['xp'] = (int) ($xp[$id] ?? 0);
                $user['level'] = $xpModel::levelFor($user['xp']);
            }
        }
        unset($user);

        if ($agents !== null) {
            sort($agents);
            $state['agent_uids'] = $agents;
        }
        return $state;
    }

    /** @return mixed|null the reader's result, or null when the plugin is absent or its reader throws */
    private function feed(string $plugin, string $class, callable $read)
    {
        if (! ($this->isLoaded)($plugin) || ! class_exists($class, true)) {
            return null;
        }
        try {
            return $read($class);
        } catch (\Throwable $e) {
            $this->logger->error('Chicane: '.$plugin.' feed failed: '.$e->getMessage());
            return null;
        }
    }
}

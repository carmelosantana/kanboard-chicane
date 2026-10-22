<?php
namespace Kanboard\Plugin\Chicane;

use Kanboard\Core\Plugin\Base;
use Kanboard\Core\Security\Role;
use Kanboard\Plugin\Chicane\Model\RaceSettings;

class Plugin extends Base
{
    public function initialize(): void
    {
        $this->projectAccessMap->add('RaceSettingsController', '*', Role::PROJECT_MANAGER);

        $this->route->addRoute('chicane/settings/save', 'RaceSettingsController', 'save', 'Chicane');
        $this->route->addRoute('chicane/settings/rotate', 'RaceSettingsController', 'rotate', 'Chicane');
        $this->route->addRoute('chicane/settings/:project_id', 'RaceSettingsController', 'show', 'Chicane');

        $container = $this->container;
        $this->hook->on('template:project:sidebar', ['template' => 'Chicane:project/sidebar']);
        $this->hook->on('template:project:dropdown', [
            'template' => 'Chicane:project/dropdown',
            'callable' => function (array $project = []) use ($container) {
                $on = ! empty($project['id']) && (new RaceSettings($container))->visibilityOf((int) $project['id']) !== 'off';
                return ['race_enabled' => $on];
            },
        ]);
    }

    public function getPluginName(): string        { return 'Chicane'; }
    public function getPluginDescription(): string { return t('Watch a project as a race track.'); }
    public function getPluginAuthor(): string      { return 'Carmelo Santana'; }
    public function getPluginVersion(): string     { return '1.0.0'; }
    public function getPluginHomepage(): string    { return 'https://github.com/carmelosantana/kanboard-chicane'; }
    public function getCompatibleVersion(): string { return '>=1.2.47'; }
}

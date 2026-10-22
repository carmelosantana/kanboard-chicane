<?php if ($this->user->hasProjectAccess('RaceSettingsController', 'show', $project['id'])): ?>
    <li <?= $this->app->checkMenuSelection('RaceSettingsController') ?>>
        <?= $this->url->link(t('Race track'), 'RaceSettingsController', 'show', ['plugin' => 'Chicane', 'project_id' => $project['id']]) ?>
    </li>
<?php endif ?>

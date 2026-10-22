<?php if ($race_enabled): ?>
    <li>
        <?= $this->url->icon('flag-checkered', t('Race'), 'RaceController', 'show', ['plugin' => 'Chicane', 'project_id' => $project['id']]) ?>
    </li>
<?php endif ?>

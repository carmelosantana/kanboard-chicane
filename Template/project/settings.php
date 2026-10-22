<?php
$labels = [
    'off' => t('Off — no race view'),
    'members' => t('Members — project members only'),
    'public' => t('Public — anyone with the share link'),
    'map_only' => t('Map only — share link shows the track without task details'),
];
$unitLabels = [
    'subtask' => t('Subtasks — each subtask is one unit, a task without subtasks is one'),
    'complexity' => t('Complexity — the larger of the task score and its subtask count'),
];
$shared = in_array($settings['visibility'], ['public', 'map_only'], true);
// The same route helpers RaceShareController uses, made absolute for copying.
$shareParams = ['plugin' => 'Chicane', 'token' => $settings['token']];
$shareUrl = $this->url->to('RaceShareController', 'show', $shareParams, '', true);
$summaryUrl = $this->url->to('RaceShareController', 'summary', $shareParams, '', true);
?>
<div class="page-header">
    <h2><?= t('Race track') ?></h2>
</div>

<form method="post" action="<?= $this->url->href('RaceSettingsController', 'save', ['plugin' => 'Chicane', 'project_id' => $project['id']]) ?>" autocomplete="off">
    <?= $this->form->csrf() ?>

    <fieldset>
        <legend><?= t('Visibility') ?></legend>
        <?php foreach ($visibilities as $v): ?>
            <label>
                <input type="radio" name="visibility" value="<?= $this->text->e($v) ?>" <?= $settings['visibility'] === $v ? 'checked' : '' ?>>
                <?= $this->text->e($labels[$v]) ?>
            </label>
        <?php endforeach ?>
    </fieldset>

    <?= $this->form->label(t('Window (days)'), 'window_days') ?>
    <?= $this->form->number('window_days', ['window_days' => $settings['window_days']], [], ['min="1"', 'max="365"', 'required']) ?>
    <p class="form-help"><?= t('How far back finished laps and activity are shown (1–365).') ?></p>

    <?= $this->form->label(t('Units'), 'units') ?>
    <?= $this->form->select('units', array_combine($units, array_map(fn ($u) => $unitLabels[$u], $units)), ['units' => $settings['units']]) ?>
    <p class="form-help"><?= t('How the track and the summary measure distance.') ?></p>

    <div class="form-actions">
        <button type="submit" class="btn btn-blue"><?= t('Save') ?></button>
    </div>
</form>

<h3><?= t('Share link') ?></h3>
<?php if ($shared): ?>
    <p class="alert alert-info"><?= t('Anyone with this link can watch the race.') ?></p>
    <input type="text" class="chicane-share-url auto-select" readonly value="<?= $this->text->e($shareUrl) ?>" aria-label="<?= t('Share link') ?>">
    <?= $this->form->label(t('Summary JSON'), 'summary_url') ?>
    <input type="text" id="form-summary_url" class="chicane-share-url auto-select" readonly value="<?= $this->text->e($summaryUrl) ?>">
    <p class="form-help"><?= t('Progress, distance to the finish and cars, for Chat or a script.') ?></p>
<?php else: ?>
    <p class="alert"><?= t('The links appear when visibility is Public or Map only.') ?></p>
<?php endif ?>

<form method="post" action="<?= $this->url->href('RaceSettingsController', 'rotate', ['plugin' => 'Chicane', 'project_id' => $project['id']]) ?>">
    <?= $this->form->csrf() ?>
    <div class="form-actions">
        <button type="submit" class="btn btn-red"><?= t('Replace share link') ?></button>
    </div>
</form>

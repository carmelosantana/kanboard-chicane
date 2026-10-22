<?php
$labels = [
    'off' => t('Off — no race view'),
    'members' => t('Members — project members only'),
    'public' => t('Public — anyone with the share link'),
    'map_only' => t('Map only — share link shows the track without task details'),
];
// RaceShareController arrives with the race/:token route; the URL builder emits the clean form once it is registered.
$shareUrl = $this->url->to('RaceShareController', 'show', ['plugin' => 'Chicane', 'token' => $settings['token']], '', true);
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

    <div class="form-actions">
        <button type="submit" class="btn btn-blue"><?= t('Save') ?></button>
    </div>
</form>

<h3><?= t('Share link') ?></h3>
<?php if (in_array($settings['visibility'], ['public', 'map_only'], true)): ?>
    <p class="alert alert-info"><?= t('Anyone with this link can watch the race.') ?></p>
<?php else: ?>
    <p class="alert"><?= t('The link works only when visibility is Public or Map only.') ?></p>
<?php endif ?>
<input type="text" class="chicane-share-url" readonly value="<?= $this->text->e($shareUrl) ?>" aria-label="<?= t('Share link') ?>">

<form method="post" action="<?= $this->url->href('RaceSettingsController', 'rotate', ['plugin' => 'Chicane', 'project_id' => $project['id']]) ?>">
    <?= $this->form->csrf() ?>
    <div class="form-actions">
        <button type="submit" class="btn btn-red"><?= t('Replace share link') ?></button>
    </div>
</form>

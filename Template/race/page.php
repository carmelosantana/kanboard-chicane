<!DOCTYPE html>
<html lang="<?= $this->app->jsLang() ?>">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="robots" content="noindex,nofollow">
    <title><?= $this->text->e($title) ?></title>
    <?= $this->asset->css('plugins/Chicane/Assets/css/race.css') ?>
</head>
<body>
    <div id="stage"></div>
    <div id="hud"></div>
    <script type="application/json" id="chicane-config"><?= str_replace('</', '<\/', json_encode($config, JSON_UNESCAPED_SLASHES | JSON_HEX_AMP)) ?></script>
    <?= $this->asset->js('plugins/Chicane/Assets/vendor/pixi-8.22.0.min.js') ?>
    <?= $this->asset->js('plugins/Chicane/Assets/vendor/pixi-unsafe-eval-8.22.0.min.js') ?>
    <?= $this->asset->js('plugins/Chicane/Assets/vendor/gsap-3.15.0.min.js') ?>
    <?= $this->asset->js('plugins/Chicane/Assets/vendor/gsap-motionpath-3.15.0.min.js') ?>
    <?= $this->asset->js('plugins/Chicane/Assets/js/track.js') ?>
    <?= $this->asset->js('plugins/Chicane/Assets/js/race.js') ?>
    <?= $this->asset->js('plugins/Chicane/Assets/js/live.js') ?>
    <?= $this->asset->js('plugins/Chicane/Assets/js/hud.js') ?>
</body>
</html>

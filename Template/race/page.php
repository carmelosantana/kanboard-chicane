<!DOCTYPE html>
<html lang="<?= $this->app->jsLang() ?>">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="robots" content="noindex,nofollow">
    <title><?= $this->text->e($title) ?></title>
</head>
<body>
    <div id="stage"></div>
    <script type="application/json" id="chicane-config"><?= str_replace('</', '<\/', json_encode($config, JSON_UNESCAPED_SLASHES | JSON_HEX_AMP)) ?></script>
</body>
</html>

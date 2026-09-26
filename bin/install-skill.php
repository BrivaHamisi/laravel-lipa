<?php

/**
 * Install a skill's stubs into a Laravel app, the way an AI agent following its SKILL.md would.
 *
 * Usage: php bin/install-skill.php skills/<name> /path/to/laravel-app
 *
 * - Copies every file under stubs/ into the app, dropping the ".stub" suffix.
 * - Reads shipkit.json: "routes" files are required from routes/web.php, "providers" are
 *   added to bootstrap/providers.php, "composer_scripts" are merged into composer.json and
 *   "executable" files are made executable and "delete" files are removed (e.g. a static
 *   public/robots.txt that would shadow a dynamic route).
 */
[$script, $skillDir, $app] = $argv + [null, null, null];

if (! $skillDir || ! $app || ! is_dir($skillDir) || ! is_dir($app)) {
    fwrite(STDERR, "Usage: php bin/install-skill.php skills/<name> /path/to/laravel-app\n");
    exit(1);
}

$stubs = rtrim($skillDir, '/').'/stubs';
$files = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($stubs, FilesystemIterator::SKIP_DOTS));

foreach ($files as $file) {
    $relative = substr($file->getPathname(), strlen($stubs) + 1);
    $target = $app.'/'.preg_replace('/\.stub$/', '', $relative);

    @mkdir(dirname($target), 0777, true);
    copy($file->getPathname(), $target);
    echo "  + {$relative}\n";
}

$manifestPath = rtrim($skillDir, '/').'/shipkit.json';
$manifest = is_file($manifestPath) ? json_decode(file_get_contents($manifestPath), true, flags: JSON_THROW_ON_ERROR) : [];

foreach ($manifest['routes'] ?? [] as $routeFile) {
    $line = "\nrequire __DIR__.'/".basename($routeFile)."';\n";
    $web = file_get_contents("{$app}/routes/web.php");

    if (! str_contains($web, trim($line))) {
        file_put_contents("{$app}/routes/web.php", $web.$line);
    }
}

foreach ($manifest['providers'] ?? [] as $provider) {
    $path = "{$app}/bootstrap/providers.php";
    $providers = file_get_contents($path);

    if (! str_contains($providers, $provider)) {
        file_put_contents($path, preg_replace('/\];\s*$/', "    {$provider}::class,\n];\n", $providers));
    }
}

if ($scripts = $manifest['composer_scripts'] ?? []) {
    $composer = json_decode(file_get_contents("{$app}/composer.json"), true, flags: JSON_THROW_ON_ERROR);
    $composer['scripts'] = [...($composer['scripts'] ?? []), ...$scripts];
    file_put_contents("{$app}/composer.json", json_encode($composer, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES)."\n");
}

foreach ($manifest['executable'] ?? [] as $file) {
    chmod("{$app}/{$file}", 0755);
}

foreach ($manifest['delete'] ?? [] as $file) {
    @unlink("{$app}/{$file}");
}

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { addSkills, listSkills } from '../cli/index.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(root, 'cli', 'index.mjs');
const skills = listSkills().map((skill) => skill.name);

/** A minimal Laravel app: just the files the installer reads or edits. */
function fakeLaravelApp() {
    const app = mkdtempSync(join(tmpdir(), 'lipa-app-'));
    mkdirSync(join(app, 'routes'));
    mkdirSync(join(app, 'bootstrap'));
    writeFileSync(join(app, 'artisan'), '#!/usr/bin/env php\n');
    writeFileSync(join(app, 'routes', 'web.php'), "<?php\n\nRoute::get('/', fn () => view('welcome'));\n");
    writeFileSync(join(app, 'bootstrap', 'providers.php'), '<?php\n\nreturn [\n    App\\Providers\\AppServiceProvider::class,\n];\n');
    writeFileSync(join(app, 'composer.json'), JSON.stringify({ name: 'laravel/laravel', scripts: { test: ['@php artisan test'] } }, null, 4));

    return app;
}

function run(args, cwd) {
    return execFileSync(process.execPath, [cli, ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

test('lists every skill with a one-line description', () => {
    const output = run(['list'], root);

    assert.ok(skills.length > 0);
    for (const name of skills) {
        assert.match(output, new RegExp(`^${name}\\s+\\S`, 'm'));
    }
});

test('installing every skill copies the code without .stub and wires it up once', () => {
    const app = fakeLaravelApp();

    const first = addSkills(['all'], { app });
    const second = addSkills(['all'], { app });

    assert.ok(first.created.length > 0);
    assert.ok(first.created.every((path) => !path.endsWith('.stub')));
    assert.ok(first.created.every((path) => existsSync(join(app, path))));
    assert.deepEqual(second.created, []);
    assert.deepEqual(second.edited, []);
    assert.equal(second.unchanged.length, first.created.length + first.unchanged.length);

    const web = readFileSync(join(app, 'routes', 'web.php'), 'utf8');
    for (const line of web.split('\n').filter((l) => l.startsWith('require '))) {
        assert.equal(web.split(line).length - 1, 1, `${line} appears once`);
    }
});

test('files you changed are kept unless you pass --force', () => {
    const app = fakeLaravelApp();
    const report = addSkills([skills[0]], { app });
    const edited = report.created.find((path) => path.endsWith('.php'));
    writeFileSync(join(app, edited), '<?php // my changes');

    const kept = addSkills([skills[0]], { app });
    assert.ok(kept.skipped.includes(edited));
    assert.equal(readFileSync(join(app, edited), 'utf8'), '<?php // my changes');

    const forced = addSkills([skills[0]], { app, force: true });
    assert.ok(forced.overwritten.includes(edited));
    assert.notEqual(readFileSync(join(app, edited), 'utf8'), '<?php // my changes');
});

test('a dry run changes nothing', () => {
    const app = fakeLaravelApp();
    const before = readFileSync(join(app, 'routes', 'web.php'), 'utf8');

    const report = addSkills(['all'], { app, dryRun: true });

    assert.ok(report.created.length > 0);
    assert.ok(report.created.every((path) => !existsSync(join(app, path))));
    assert.equal(readFileSync(join(app, 'routes', 'web.php'), 'utf8'), before);
});

test('providers and composer scripts from a skill manifest are added once', () => {
    const app = fakeLaravelApp();
    const withProvider = skills.find((name) => (JSON.parse(readFileSync(join(root, 'skills', name, 'shipkit.json'), 'utf8')).providers ?? []).length > 0);
    const withScripts = skills.find((name) => Object.keys(JSON.parse(readFileSync(join(root, 'skills', name, 'shipkit.json'), 'utf8')).composer_scripts ?? {}).length > 0);

    if (withProvider) {
        addSkills([withProvider], { app });
        addSkills([withProvider], { app });
        const providers = readFileSync(join(app, 'bootstrap', 'providers.php'), 'utf8');
        const provider = JSON.parse(readFileSync(join(root, 'skills', withProvider, 'shipkit.json'), 'utf8')).providers[0];
        assert.equal(providers.split(provider).length - 1, 1);
        assert.match(providers, /\];\n$/);
    }

    if (withScripts) {
        addSkills([withScripts], { app });
        const composer = JSON.parse(readFileSync(join(app, 'composer.json'), 'utf8'));
        assert.deepEqual(composer.scripts.test, ['@php artisan test']);
        for (const key of Object.keys(JSON.parse(readFileSync(join(root, 'skills', withScripts, 'shipkit.json'), 'utf8')).composer_scripts)) {
            assert.ok(key in composer.scripts);
        }
    }
});

test('executable files, like git hooks, are made executable', () => {
    const app = fakeLaravelApp();

    for (const name of skills) {
        const executables = JSON.parse(readFileSync(join(root, 'skills', name, 'shipkit.json'), 'utf8')).executable ?? [];

        if (executables.length > 0) {
            addSkills([name], { app });
            for (const file of executables) {
                assert.ok(statSync(join(app, file)).mode & 0o111, `${file} is executable`);
            }
        }
    }
});

test('it refuses folders that are not Laravel apps, and unknown skills', () => {
    const notLaravel = mkdtempSync(join(tmpdir(), 'not-laravel-'));

    assert.throws(() => addSkills(['all'], { app: notLaravel }), /not a Laravel app/);
    assert.throws(() => addSkills(['no-such-skill'], { app: fakeLaravelApp() }), /Unknown skill: no-such-skill/);
    assert.throws(() => addSkills([], { app: fakeLaravelApp() }), /at least one skill/);
});

test('the command works through --path and exits non-zero on errors', () => {
    const app = fakeLaravelApp();

    const output = run(['add', skills[0], '--path', app], tmpdir());
    assert.match(output, /Created/);
    assert.match(output, /Next/);

    assert.throws(() => run(['add', 'nope', '--path', app], tmpdir()), (error) => error.status === 1 && /Unknown skill/.test(error.stderr));
});

test('the published package holds only the command, skills, README and licence', () => {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

    assert.deepEqual(pkg.files, ['cli/', 'skills/', 'README.md', 'LICENSE']);
    assert.equal(pkg.scripts.postinstall, undefined);
    assert.equal(pkg.scripts.preinstall, undefined);
    assert.equal(pkg.dependencies, undefined);
});

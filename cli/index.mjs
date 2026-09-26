#!/usr/bin/env node
/**
 * Installs this package's skills straight into a Laravel app, without an AI agent.
 *
 *   npx <package> list
 *   npx <package> add <skill...|all> [--path <laravel-app>] [--force] [--dry-run]
 *
 * For each skill it copies the files in skills/<name>/stubs into the app (dropping the
 * ".stub" suffix), then applies skills/<name>/shipkit.json: route files are required
 * from routes/web.php, providers added to bootstrap/providers.php, composer scripts
 * merged into composer.json. Existing files are never overwritten without --force.
 * No dependencies, no network access, no install scripts.
 */
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const skillsDir = join(root, 'skills');
const repoUrl = String(pkg.homepage ?? '').replace(/#.*$/, '');

export function listSkills() {
    return readdirSync(skillsDir)
        .filter((name) => existsSync(join(skillsDir, name, 'SKILL.md')))
        .sort()
        .map((name) => ({ name, description: describe(name) }));
}

function describe(name) {
    const frontmatter = readFileSync(join(skillsDir, name, 'SKILL.md'), 'utf8').match(/^---\n([\s\S]*?)\n---/);
    const description = frontmatter?.[1].match(/^description:\s*"?(.*?)"?$/m)?.[1] ?? '';

    const summary = description.split(/(?<=\.)\s|:\s/)[0];

    return summary.length > 100 ? `${summary.slice(0, 97)}...` : summary;
}

function walk(directory) {
    return readdirSync(directory).flatMap((entry) => {
        const path = join(directory, entry);

        return statSync(path).isDirectory() ? walk(path) : [path];
    });
}

/**
 * Install skills into a Laravel app. Returns what happened, for printing and for tests.
 */
export function addSkills(names, { app, force = false, dryRun = false } = {}) {
    if (!existsSync(join(app, 'artisan'))) {
        throw new Error(`${app} is not a Laravel app (no artisan file). Run this in your project, or pass --path.`);
    }

    const available = listSkills().map((skill) => skill.name);
    const wanted = names.includes('all') ? available : names;
    const unknown = wanted.filter((name) => !available.includes(name));

    if (wanted.length === 0) {
        throw new Error('Name at least one skill, or "all". See: list');
    }

    if (unknown.length > 0) {
        throw new Error(`Unknown skill: ${unknown.join(', ')}. Available: ${available.join(', ')}`);
    }

    const report = { created: [], unchanged: [], skipped: [], overwritten: [], edited: [], todo: [] };
    const write = (path, contents) => {
        if (!dryRun) {
            mkdirSync(dirname(path), { recursive: true });
            writeFileSync(path, contents);
        }
    };

    for (const name of wanted) {
        const stubs = join(skillsDir, name, 'stubs');

        for (const source of walk(stubs)) {
            const target = relative(stubs, source).replace(/\.stub$/, '');
            const destination = join(app, target);
            const contents = readFileSync(source);

            if (!existsSync(destination)) {
                write(destination, contents);
                report.created.push(target);
            } else if (readFileSync(destination).equals(contents)) {
                report.unchanged.push(target);
            } else if (force) {
                write(destination, contents);
                report.overwritten.push(target);
            } else {
                report.skipped.push(target);
            }
        }

        applyManifest(name, app, { dryRun, report, write });
        const copied = [...report.created, ...report.overwritten, ...report.unchanged, ...report.skipped];

        if (copied.some((path) => path.startsWith('database/migrations/')) && !report.todo.includes('php artisan migrate')) {
            report.todo.push('php artisan migrate');
        }

        for (const config of copied.filter((path) => /^config\/[^/]+\.php$/.test(path))) {
            const note = `Add the env() keys from ${config} to .env with your own values (never commit them).`;

            if (!report.todo.includes(note)) {
                report.todo.push(note);
            }
        }

        report.todo.push(`Read ${repoUrl ? `${repoUrl}/blob/main/skills/${name}/SKILL.md` : `skills/${name}/SKILL.md`} for setup, going live and gotchas.`);
    }

    return report;
}

function applyManifest(name, app, { dryRun, report, write }) {
    const manifestPath = join(skillsDir, name, 'shipkit.json');
    const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : {};

    for (const routeFile of manifest.routes ?? []) {
        const web = join(app, 'routes', 'web.php');
        const line = `require __DIR__.'/${routeFile.split('/').pop()}';`;
        const current = existsSync(web) ? readFileSync(web, 'utf8') : "<?php\n";

        if (!current.includes(line)) {
            write(web, `${current.replace(/\s*$/, '')}\n\n${line}\n`);
            report.edited.push(`routes/web.php (added ${line})`);
        }
    }

    for (const provider of manifest.providers ?? []) {
        const path = join(app, 'bootstrap', 'providers.php');

        if (!existsSync(path)) {
            report.todo.push(`Register ${provider} in your service providers.`);
            continue;
        }

        const current = readFileSync(path, 'utf8');

        if (!current.includes(provider)) {
            write(path, current.replace(/\];\s*$/, `    ${provider}::class,\n];\n`));
            report.edited.push(`bootstrap/providers.php (added ${provider})`);
        }
    }

    const scripts = manifest.composer_scripts ?? {};

    if (Object.keys(scripts).length > 0) {
        const path = join(app, 'composer.json');
        const composer = JSON.parse(readFileSync(path, 'utf8'));
        const missing = Object.keys(scripts).filter((key) => !(key in (composer.scripts ?? {})));

        if (missing.length > 0) {
            composer.scripts = { ...(composer.scripts ?? {}), ...Object.fromEntries(missing.map((key) => [key, scripts[key]])) };
            write(path, `${JSON.stringify(composer, null, 4)}\n`);
            report.edited.push(`composer.json (added scripts: ${missing.join(', ')})`);
        }
    }

    for (const file of manifest.executable ?? []) {
        if (!dryRun && existsSync(join(app, file))) {
            chmodSync(join(app, file), 0o755);
        }
    }

    for (const packageName of manifest.composer ?? []) {
        report.todo.push(`composer require ${packageName}`);
    }

    // Deleting files in someone's project is left to them.
    for (const file of manifest.delete ?? []) {
        if (existsSync(join(app, file))) {
            report.todo.push(`Delete ${file}: it would shadow the route this skill adds.`);
        }
    }
}

function parse(argv) {
    const options = { names: [], app: process.cwd(), force: false, dryRun: false };

    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];

        if (arg === '--force') options.force = true;
        else if (arg === '--dry-run') options.dryRun = true;
        else if (arg === '--path') options.app = resolve(argv[++i] ?? '.');
        else if (arg.startsWith('--path=')) options.app = resolve(arg.slice('--path='.length));
        else options.names.push(arg);
    }

    return options;
}

function help() {
    const bin = Object.keys(pkg.bin ?? {})[0] ?? pkg.name;

    return `${pkg.name} ${pkg.version}: ${pkg.description}

Usage:
  npx ${bin} list                          Show the skills
  npx ${bin} add <skill...|all> [options]  Copy skills into this Laravel app

Options:
  --path <dir>   The Laravel app (default: current folder)
  --force        Overwrite files that differ (commit your work first)
  --dry-run      Show what would change, change nothing

With an AI agent instead:
  php artisan boost:add-skill ${repoUrl.replace('https://github.com/', '')}
`;
}

function print(report, dryRun) {
    const section = (title, items, mark) => {
        if (items.length > 0) {
            console.log(`\n${title}`);
            items.forEach((item) => console.log(`  ${mark} ${item}`));
        }
    };

    section(dryRun ? 'Would create' : 'Created', report.created, '+');
    section(dryRun ? 'Would overwrite' : 'Overwritten', report.overwritten, '!');
    section('Skipped (your file differs; re-run with --force to replace it)', report.skipped, '-');
    section(dryRun ? 'Would edit' : 'Edited', report.edited, '~');
    console.log(`\n${report.unchanged.length} file(s) already up to date.`);
    section('Next', [...report.todo, 'php artisan test'], '→');
}

function main(argv) {
    const [command, ...rest] = argv;

    if (!command || command === 'help' || command === '--help' || command === '-h') {
        console.log(help());

        return 0;
    }

    if (command === '--version' || command === '-v') {
        console.log(pkg.version);

        return 0;
    }

    if (command === 'list') {
        for (const skill of listSkills()) {
            console.log(`${skill.name.padEnd(28)} ${skill.description}`);
        }

        return 0;
    }

    if (command === 'add') {
        const options = parse(rest);

        try {
            print(addSkills(options.names, options), options.dryRun);
        } catch (error) {
            console.error(`Error: ${error.message}`);

            return 1;
        }

        return 0;
    }

    console.error(`Unknown command "${command}".\n`);
    console.log(help());

    return 1;
}

// Run when called as a command (npx goes through a symlink, so compare real paths), not when imported by tests.
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
    process.exitCode = main(process.argv.slice(2));
}

export { main };

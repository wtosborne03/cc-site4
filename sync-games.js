#!/usr/bin/env node

/**
 * Couch Cup — Game & Box Art Sync Script
 * 
 * Automatically synchronizes active minigames from f2-lobby-host:
 * 1. Scans f2-lobby-host/src/games for gameConfig.ts
 * 2. Filters out disabled games (disabled: true) and non-games
 * 3. Copies latest box art assets into cc-site4/boxArt/
 * 4. Updates GAMES database and game counts in cc-site4/index.html
 * 5. Emits cc-site4/games.json
 */

const fs = require('fs');
const path = require('path');

// Determine directories
const siteDir = __dirname;
const defaultHostDir = path.resolve(siteDir, '../f2-lobby-host');
const hostDir = process.env.COUCHCUP_HOST_DIR || process.argv[2] || defaultHostDir;

const gamesSrcDir = path.join(hostDir, 'src/games');
const boxArtSrcDir = path.join(hostDir, 'public/static/boxArt');
const boxArtDestDir = path.join(siteDir, 'boxArt');
const htmlFile = path.join(siteDir, 'index.html');
const jsonFile = path.join(siteDir, 'games.json');

console.log('--------------------------------------------------');
console.log('🔄 Couch Cup: Synchronizing Games & Box Art');
console.log(`📁 Source: ${hostDir}`);
console.log(`📁 Target: ${siteDir}`);
console.log('--------------------------------------------------');

if (!fs.existsSync(gamesSrcDir)) {
    console.error(`❌ Error: Games directory not found at ${gamesSrcDir}`);
    process.exit(1);
}

if (!fs.existsSync(boxArtDestDir)) {
    fs.mkdirSync(boxArtDestDir, { recursive: true });
}

// 1. Scan and parse all game configs
const gameFolders = fs.readdirSync(gamesSrcDir, { withFileTypes: true })
    .filter(dirent => dirent.isDirectory())
    .map(dirent => dirent.name);

const activeGames = [];
const skippedGames = [];

for (const folder of gameFolders) {
    const configPath = path.join(gamesSrcDir, folder, 'gameConfig.ts');
    if (!fs.existsSync(configPath)) continue;

    const content = fs.readFileSync(configPath, 'utf8');

    // Extract disabled
    const disabledMatch = content.match(/\bdisabled\s*:\s*(true|false)/);
    const isDisabled = disabledMatch ? disabledMatch[1] === 'true' : false;

    // Extract type
    const typeMatch = content.match(/\btype\s*:\s*GameType\.(\w+)/);
    const gameType = typeMatch ? typeMatch[1] : 'Game';

    // Extract name (id)
    const nameMatch = content.match(/\bname\s*:\s*(["'`])(.*?)\1/);
    const id = nameMatch ? nameMatch[2].trim() : folder.toLowerCase();

    // Extract fullName (title)
    const fullNameMatch = content.match(/\bfullName\s*:\s*(["'`])(.*?)\1/);
    const title = fullNameMatch ? fullNameMatch[2].trim() : folder;

    // Extract description (handles multi-line or inner quotes)
    const descMatch = content.match(/\bdescription\s*:\s*(["'`])([\s\S]*?)\1/);
    const desc = descMatch ? descMatch[2].trim().replace(/\s+/g, ' ') : '';

    // Extract boxImage
    const boxMatch = content.match(/\bboxImage\s*:\s*(["'`])(.*?)\1/);
    let boxImage = boxMatch ? boxMatch[2].trim() : `${id}.webp`;
    boxImage = path.basename(boxImage); // strip any leading path

    if (isDisabled) {
        skippedGames.push({ title, reason: 'disabled: true' });
        continue;
    }

    if (gameType !== 'Game') {
        skippedGames.push({ title, reason: `type is ${gameType}` });
        continue;
    }

    activeGames.push({
        id,
        title,
        desc,
        box: `boxArt/${boxImage}`,
        rawBox: boxImage,
        folder
    });
}

// Sort games alphabetically by title for a clean order
activeGames.sort((a, b) => a.title.localeCompare(b.title));

console.log(`\n✅ Found ${activeGames.length} active games (${skippedGames.length} disabled/skipped):`);
activeGames.forEach((g, i) => {
    console.log(`   ${String(i + 1).padStart(2, ' ')}. ${g.title} (${g.id}) -> ${g.box}`);
});

if (skippedGames.length > 0) {
    console.log(`\n⏭️  Skipped ${skippedGames.length} non-active games:`);
    skippedGames.forEach(s => console.log(`   - ${s.title} (${s.reason})`));
}

// 2. Synchronize Box Art Images
console.log('\n📦 Synchronizing Box Art Assets...');
let copiedCount = 0;
let missingCount = 0;

for (const game of activeGames) {
    const srcBoxPath = path.join(boxArtSrcDir, game.rawBox);
    const destBoxPath = path.join(boxArtDestDir, game.rawBox);

    if (fs.existsSync(srcBoxPath)) {
        fs.copyFileSync(srcBoxPath, destBoxPath);
        copiedCount++;
    } else {
        // Check for alternative png
        const pngName = game.rawBox.replace(/\.webp$/, '.png');
        const pngSrcPath = path.join(boxArtSrcDir, pngName);
        if (fs.existsSync(pngSrcPath)) {
            fs.copyFileSync(pngSrcPath, path.join(boxArtDestDir, pngName));
            game.box = `boxArt/${pngName}`;
            copiedCount++;
        } else {
            console.warn(`   ⚠️ Warning: Missing box art for "${game.title}": ${game.rawBox}`);
            missingCount++;
        }
    }
}
console.log(`   Copied/Refreshed ${copiedCount} box art assets.`);

// 3. Write games.json
const jsonOutput = activeGames.map(g => ({
    id: g.id,
    title: g.title,
    desc: g.desc,
    box: g.box
}));
fs.writeFileSync(jsonFile, JSON.stringify(jsonOutput, null, 2), 'utf8');
console.log(`\n📄 Generated ${jsonFile}`);

// 4. Update index.html
if (fs.existsSync(htmlFile)) {
    console.log('📝 Updating index.html with new games & counts...');
    let htmlContent = fs.readFileSync(htmlFile, 'utf8');
    const totalCount = activeGames.length;

    // Update GAMES array in script
    const gamesJsArray = JSON.stringify(jsonOutput, null, 12)
        .replace(/\n\s{12}/g, '\n            ')
        .replace(/\n\s{8}\]/g, '\n        ]');

    const gamesRegex = /const\s+GAMES\s*=\s*\[[\s\S]*?\];/;
    if (gamesRegex.test(htmlContent)) {
        htmlContent = htmlContent.replace(gamesRegex, `const GAMES = ${gamesJsArray};`);
    } else {
        console.warn('   ⚠️ Warning: Could not locate "const GAMES = [...]" block in index.html');
    }

    // Update dynamic text counts
    htmlContent = htmlContent.replace(
        /(<span class="gallery-heading">)\d+(\s+INCLUDED PARTY GAMES<\/span>)/g,
        `$1${totalCount}$2`
    );
    htmlContent = htmlContent.replace(
        /(<strong>PLAY\s+)\d+(\s+PARTY GAMES<\/strong>)/g,
        `$1${totalCount}$2`
    );
    htmlContent = htmlContent.replace(
        /(\b)\d+(\s+Games Included in One \$5 Purchase\b)/g,
        `$1${totalCount}$2`
    );
    htmlContent = htmlContent.replace(
        /(\b)\d+(\s+original party minigames\b)/gi,
        `$1${totalCount}$2`
    );
    htmlContent = htmlContent.replace(
        /(\b)\d+(\s+original party games\b)/gi,
        `$1${totalCount}$2`
    );

    fs.writeFileSync(htmlFile, htmlContent, 'utf8');
    console.log(`   Updated index.html (synchronized ${totalCount} games).`);
}

console.log('\n✨ Synchronization Complete!');
console.log('--------------------------------------------------\n');

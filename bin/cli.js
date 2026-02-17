#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const chalk = require('chalk');
const prompts = require('prompts');
const { setupContext7 } = require('./context7-setup');

// Get the package root directory (where .jumpstart/ lives)
const PACKAGE_ROOT = path.join(__dirname, '..');

// Files and directories to copy
const INTEGRATION_FILES = ['AGENTS.md', 'CLAUDE.md', '.cursorrules'];
const JUMPSTART_DIR = '.jumpstart';
const GITHUB_DIR = '.github';
const SPEC_DIRS = ['specs/decisions', 'specs/research', 'specs/insights'];
const OUTPUT_DIRS = ['src', 'tests'];

// Parse command line arguments
function parseArgs() {
  const args = process.argv.slice(2);
  const config = {
    targetDir: null,
    projectName: null,
    approverName: null,
    copilot: false,
    force: false,
    dryRun: false,
    help: false,
    interactive: true,
    projectType: null  // greenfield | brownfield | null (auto-detect)
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    
    if (arg === '--help' || arg === '-h') {
      config.help = true;
      config.interactive = false;
    } else if (arg === '--name') {
      config.projectName = args[++i];
      config.interactive = false;
    } else if (arg === '--approver') {
      config.approverName = args[++i];
      config.interactive = false;
    } else if (arg === '--copilot') {
      config.copilot = true;
      config.interactive = false;
    } else if (arg === '--force') {
      config.force = true;
      config.interactive = false;
    } else if (arg === '--dry-run') {
      config.dryRun = true;
      config.interactive = false;
    } else if (arg === '--type') {
      const typeVal = args[++i];
      if (typeVal === 'greenfield' || typeVal === 'brownfield') {
        config.projectType = typeVal;
      } else {
        console.error(chalk.red(`Invalid --type value: ${typeVal}. Must be 'greenfield' or 'brownfield'.`));
        process.exit(1);
      }
      config.interactive = false;
    } else if (!arg.startsWith('--') && !config.targetDir) {
      config.targetDir = arg;
    }
  }

  // Default target directory
  if (!config.targetDir) {
    config.targetDir = '.';
  }

  return config;
}

// Display help information
function showHelp() {
  console.log(chalk.bold.blue('\n🚀 Jump Start Framework - Spec-driven agentic coding\n'));
  console.log(chalk.bold('USAGE:'));
  console.log('  npx jumpstart-mode [directory] [options]');
  console.log('  npx jumpstart-mode verify [verify-options]\n');
  console.log(chalk.bold('COMMANDS:'));
  console.log('  verify             Validate Mermaid diagrams in spec files');
  console.log('  validate <path>    Validate artifact against JSON schema (Item 5)');
  console.log('  spec-drift [specs] [src]  Detect drift between specs and code (Item 4)');
  console.log('  hash <register|verify>    Content-addressable spec integrity (Item 12)');
  console.log('  graph <build|coverage>    Build/query spec dependency graph (Item 13)');
  console.log('  simplicity [dir]   Check simplicity gate on directory structure (Item 9)');
  console.log('  scan-wrappers [dir] Scan for unnecessary wrapper patterns (Item 10)');
  console.log('  invariants         Check architecture against environment invariants (Item 15)');
  console.log('  version-tag <path> Create version tag for approved artifact (Item 6)');
  console.log('  template-check     Detect template changes since last snapshot (Item 14)');
  console.log('  freshness-audit    Run Context7 documentation freshness audit (Item 101)');
  console.log('  shard [prd-path]   Shard a large PRD into per-epic files (Item 8)');
  console.log('  test [options]     Run quality test suites (Layer 1-5)');
  console.log('  checklist <path>   Run spec quality checklist on an artifact');
  console.log('  smells <path>      Detect spec smells in an artifact');
  console.log('  handoff-check <path> Validate handoff contract from artifact');
  console.log('  coverage <prd> <plan> Check story-to-task coverage');
  console.log('  consistency [specs]  Run cross-artifact consistency analysis');
  console.log('  lint [dir]           Auto-detect and run project linter');
  console.log('  contracts            Validate API contracts vs data model');
  console.log('  regulatory           Run regulatory compliance gate');
  console.log('  boundaries           Validate plan against product-brief boundaries');
  console.log('  task-deps            Audit task dependency graph');
  console.log('  diff <path>          Show dry-run diff summary');
  console.log('  dashboard            Interactive progress dashboard');
  console.log('  validate-all         Proactive validation & suggestion engine');
  console.log('  quickstart           5-minute quickstart wizard');
  console.log('  rewind <phase>       Rewind to target phase, archiving downstream artifacts');
  console.log('  approve [path]       Approve current or specified phase artifact');
  console.log('  reject [path]        Reject artifact with reason');
  console.log('  checkpoint <action>  Session checkpoints (create/list/restore)');
  console.log('  handoff              Export portable handoff package\n');
  console.log(chalk.bold('OPTIONS:'));
  console.log('  <directory>        Target directory (default: current directory)');
  console.log('  --name <name>      Set project name in config');
  console.log('  --approver <name>  Set approver name in config');
  console.log('  --type <type>      Set project type: greenfield | brownfield');
  console.log('  --copilot          Include GitHub Copilot integration');
  console.log('  --force            Overwrite existing files without prompting');
  console.log('  --dry-run          Show what would be installed without copying');
  console.log('  --help, -h         Display this help message\n');
  console.log(chalk.bold('VERIFY OPTIONS:'));
  console.log('  --dir <path>       Directory to scan (default: specs)');
  console.log('  --file <path>      Scan a single file');
  console.log('  --strict           Treat warnings as errors');
  console.log('  --json             Output as JSON\n');
  console.log(chalk.bold('EXAMPLES:'));
  console.log('  npx jumpstart-mode');
  console.log('  npx jumpstart-mode ./my-project');
  console.log('  npx jumpstart-mode . --name "My Project" --approver "Jane Smith" --copilot');
  console.log('  npx jumpstart-mode ./existing-app --type brownfield --copilot');
  console.log('  npx jumpstart-mode --dry-run .');
  console.log('  npx jumpstart-mode verify');
  console.log('  npx jumpstart-mode verify --file specs/architecture.md --strict');
  console.log('  npx jumpstart-mode dashboard');
  console.log('  npx jumpstart-mode dashboard --json');
  console.log('  npx jumpstart-mode validate-all');
  console.log('  npx jumpstart-mode validate-all --file specs/prd.md --strict');
  console.log('  npx jumpstart-mode quickstart');
  console.log('  npx jumpstart-mode rewind 2');
  console.log('  npx jumpstart-mode rewind 1 --reason "Re-evaluating scope"');
  console.log('  npx jumpstart-mode approve');
  console.log('  npx jumpstart-mode approve specs/prd.md --approver "Jane"');
  console.log('  npx jumpstart-mode reject specs/prd.md --reason "Missing epic 3"');
  console.log('  npx jumpstart-mode checkpoint create "Before refactor"');
  console.log('  npx jumpstart-mode checkpoint list');
  console.log('  npx jumpstart-mode checkpoint restore cp-1234567890');
  console.log('  npx jumpstart-mode handoff');
  console.log('  npx jumpstart-mode handoff --output ./export/handoff.md --json\n');
}

// Detect whether a target directory is a greenfield or brownfield project
function detectProjectType(targetDir) {
  const absDir = path.resolve(targetDir);

  // Indicators of an existing project (brownfield)
  const brownfieldIndicators = [
    'package.json', 'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml',
    'requirements.txt', 'Pipfile', 'pyproject.toml', 'setup.py',
    'Gemfile', 'go.mod', 'Cargo.toml', 'pom.xml', 'build.gradle',
    'Makefile', 'CMakeLists.txt', 'composer.json',
    '.gitignore', 'tsconfig.json', 'webpack.config.js', 'vite.config.ts',
    'Dockerfile', 'docker-compose.yml'
  ];

  const brownfieldDirs = ['src', 'lib', 'app', 'components', 'pages', 'api', 'server', 'client'];

  let score = 0;
  const signals = [];

  // Check for .git directory (strong signal)
  if (fs.existsSync(path.join(absDir, '.git'))) {
    const gitLog = path.join(absDir, '.git', 'refs', 'heads');
    if (fs.existsSync(gitLog)) {
      score += 2;
      signals.push('.git history');
    }
  }

  // Check for config/manifest files
  for (const file of brownfieldIndicators) {
    if (fs.existsSync(path.join(absDir, file))) {
      score += 1;
      signals.push(file);
      if (signals.length >= 5) break; // Enough evidence
    }
  }

  // Check for source directories with actual files
  for (const dir of brownfieldDirs) {
    const dirPath = path.join(absDir, dir);
    if (fs.existsSync(dirPath) && fs.statSync(dirPath).isDirectory()) {
      const entries = fs.readdirSync(dirPath);
      if (entries.some(e => !e.startsWith('.') && e !== '.gitkeep')) {
        score += 1;
        signals.push(`${dir}/`);
        if (signals.length >= 5) break;
      }
    }
  }

  if (score >= 2) {
    return { type: 'brownfield', confidence: Math.min(score / 5, 1), signals };
  }

  return { type: 'greenfield', confidence: 1 - (score / 5), signals };
}

// Recursively copy directory
function copyDirectoryRecursive(src, dest, options = {}) {
  const { dryRun = false, force = false, stats = { copied: [], skipped: [] } } = options;

  if (!fs.existsSync(src)) {
    return stats;
  }

  if (!dryRun && !fs.existsSync(dest)) {
    fs.mkdirSync(dest, { recursive: true });
  }

  const entries = fs.readdirSync(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      copyDirectoryRecursive(srcPath, destPath, options);
    } else {
      const exists = fs.existsSync(destPath);
      if (exists && !force) {
        stats.skipped.push(destPath);
      } else {
        if (!dryRun) {
          fs.copyFileSync(srcPath, destPath);
        }
        stats.copied.push(destPath);
      }
    }
  }

  return stats;
}

// Copy a single file
function copyFile(src, dest, options = {}) {
  const { dryRun = false, force = false, stats = { copied: [], skipped: [] } } = options;

  if (!fs.existsSync(src)) {
    return stats;
  }

  const exists = fs.existsSync(dest);
  if (exists && !force) {
    stats.skipped.push(dest);
  } else {
    if (!dryRun) {
      const destDir = path.dirname(dest);
      if (!fs.existsSync(destDir)) {
        fs.mkdirSync(destDir, { recursive: true });
      }
      fs.copyFileSync(src, dest);
    }
    stats.copied.push(dest);
  }

  return stats;
}

// Create directory structure
function createDirectories(baseDir, dirs, options = {}) {
  const { dryRun = false, stats = { created: [] } } = options;

  for (const dir of dirs) {
    const fullPath = path.join(baseDir, dir);
    if (!fs.existsSync(fullPath)) {
      if (!dryRun) {
        fs.mkdirSync(fullPath, { recursive: true });
        // Create .gitkeep file
        fs.writeFileSync(path.join(fullPath, '.gitkeep'), '');
      }
      stats.created.push(fullPath);
    }
  }

  return stats;
}

// Replace project name in config.yaml
function replaceProjectName(configPath, projectName, options = {}) {
  const { dryRun = false } = options;

  if (!fs.existsSync(configPath) || !projectName || dryRun) {
    return;
  }

  let content = fs.readFileSync(configPath, 'utf8');
  
  // Replace various possible placeholder formats
  content = content.replace(/{{PROJECT_NAME}}/g, projectName);
  content = content.replace(/\{\{project_name\}\}/g, projectName);
  content = content.replace(/PROJECT_NAME_PLACEHOLDER/g, projectName);
  
  // Update the project.name field (YAML format under project: section)
  // Matches:  name: ""  or  name: ''  or  name: 
  content = content.replace(
    /(project:\s*\n(?:.*\n)*?\s*)name:\s*["']?["']?/m,
    `$1name: "${projectName}"`
  );

  fs.writeFileSync(configPath, content, 'utf8');
}

// Set project type in config.yaml
function setProjectType(configPath, projectType, options = {}) {
  const { dryRun = false } = options;

  if (!fs.existsSync(configPath) || !projectType || dryRun) {
    return;
  }

  let content = fs.readFileSync(configPath, 'utf8');

  // Replace type: null or type: "" under the project: section
  content = content.replace(
    /(project:\s*\n(?:.*\n)*?\s*)type:\s*(?:null|""|'')?/m,
    `$1type: "${projectType}"`
  );

  fs.writeFileSync(configPath, content, 'utf8');
}
// Set approver name in config.yaml
function setApprover(configPath, approverName, options = {}) {
  const { dryRun = false } = options;

  if (!fs.existsSync(configPath) || !approverName || dryRun) {
    return;
  }

  let content = fs.readFileSync(configPath, 'utf8');

  // Replace approver: "" under the project: section
  content = content.replace(
    /(project:\s*\n(?:.*\n)*?\s*)approver:\s*""\s*#/m,
    `$1approver: "${approverName}"                          #`
  );

  fs.writeFileSync(configPath, content, 'utf8');
}
// Detect conflicts
function detectConflicts(targetDir, config) {
  const conflicts = [];

  // Check .jumpstart directory
  const jumpstartPath = path.join(targetDir, JUMPSTART_DIR);
  if (fs.existsSync(jumpstartPath)) {
    conflicts.push(JUMPSTART_DIR);
  }

  // Check integration files
  for (const file of INTEGRATION_FILES) {
    const filePath = path.join(targetDir, file);
    if (fs.existsSync(filePath)) {
      conflicts.push(file);
    }
  }

  // Check .github if copilot option
  if (config.copilot) {
    const githubPath = path.join(targetDir, GITHUB_DIR);
    if (fs.existsSync(githubPath)) {
      conflicts.push(GITHUB_DIR);
    }
  }

  return conflicts;
}

// Interactive mode
async function runInteractive() {
  console.log(chalk.bold.blue('\n🚀 Jump Start Framework Setup\n'));

  const questions = [
    {
      type: 'text',
      name: 'targetDir',
      message: 'Target directory:',
      initial: '.'
    },
    {
      type: 'text',
      name: 'projectName',
      message: 'Project name (optional):',
      initial: ''
    },
    {
      type: 'text',
      name: 'approverName',
      message: 'Your name or team name (for phase approvals):',
      initial: '',
      validate: value => value.trim() ? true : 'Approver name is required for workflow tracking'
    },
    {
      type: 'confirm',
      name: 'copilot',
      message: 'Include GitHub Copilot integration?',
      initial: false
    }
  ];

  const answers = await prompts(questions);

  // If user cancelled
  if (!answers.targetDir) {
    console.log(chalk.yellow('\n❌ Setup cancelled\n'));
    process.exit(0);
  }

  // Detect and confirm project type
  const targetPath = path.resolve(answers.targetDir);
  const detection = detectProjectType(targetPath);

  let projectType = detection.type;

  if (detection.signals.length > 0 && detection.type === 'brownfield') {
    console.log(chalk.cyan(`\n🔍 Detected existing project signals: ${detection.signals.slice(0, 3).join(', ')}`));
    const { confirmedType } = await prompts({
      type: 'select',
      name: 'confirmedType',
      message: 'This looks like an existing codebase. Project type:',
      choices: [
        { title: 'Brownfield (existing codebase)', value: 'brownfield' },
        { title: 'Greenfield (new project)', value: 'greenfield' }
      ],
      initial: 0
    });

    if (!confirmedType) {
      console.log(chalk.yellow('\n❌ Setup cancelled\n'));
      process.exit(0);
    }
    projectType = confirmedType;
  } else {
    const { confirmedType } = await prompts({
      type: 'select',
      name: 'confirmedType',
      message: 'Project type:',
      choices: [
        { title: 'Greenfield (new project)', value: 'greenfield' },
        { title: 'Brownfield (existing codebase)', value: 'brownfield' }
      ],
      initial: 0
    });

    if (!confirmedType) {
      console.log(chalk.yellow('\n❌ Setup cancelled\n'));
      process.exit(0);
    }
    projectType = confirmedType;
  }

  const config = {
    targetDir: answers.targetDir,
    projectName: answers.projectName || null,
    approverName: answers.approverName || null,
    projectType,
    copilot: answers.copilot,
    force: false,
    dryRun: false,
    interactive: true
  };

  // Check for conflicts
  const conflicts = detectConflicts(targetPath, config);

  if (conflicts.length > 0 && !config.force) {
    console.log(chalk.yellow('\n⚠️  The following files/directories already exist:'));
    conflicts.forEach(c => console.log(chalk.yellow(`   - ${c}`)));
    
    const { overwrite } = await prompts({
      type: 'confirm',
      name: 'overwrite',
      message: 'Overwrite existing files?',
      initial: false
    });

    if (!overwrite) {
      console.log(chalk.yellow('\n❌ Setup cancelled\n'));
      process.exit(0);
    }

    config.force = true;
  }

  return config;
}

// Main installation function
async function install(config) {
  const targetPath = path.resolve(config.targetDir);

  console.log(chalk.bold.blue('\n🚀 Installing Jump Start Framework...\n'));
  console.log(chalk.gray(`Target: ${targetPath}`));
  if (config.projectName) {
    console.log(chalk.gray(`Project: ${config.projectName}`));
  }
  if (config.approverName) {
    console.log(chalk.gray(`Approver: ${config.approverName}`));
  }
  if (config.projectType) {
    console.log(chalk.gray(`Type: ${config.projectType}`));
  }
  if (config.copilot) {
    console.log(chalk.gray('Including: GitHub Copilot integration'));
  }
  if (config.dryRun) {
    console.log(chalk.yellow.bold('\n[DRY RUN MODE - No files will be copied]\n'));
  }

  const stats = {
    copied: [],
    skipped: [],
    created: []
  };

  const copyOptions = {
    dryRun: config.dryRun,
    force: config.force,
    stats
  };

  // 1. Copy .jumpstart directory
  console.log(chalk.cyan('\n📁 Copying .jumpstart framework...'));
  const jumpstartSrc = path.join(PACKAGE_ROOT, JUMPSTART_DIR);
  const jumpstartDest = path.join(targetPath, JUMPSTART_DIR);
  copyDirectoryRecursive(jumpstartSrc, jumpstartDest, copyOptions);

  // 2. Copy integration files
  console.log(chalk.cyan('📄 Copying integration files...'));
  for (const file of INTEGRATION_FILES) {
    const src = path.join(PACKAGE_ROOT, file);
    const dest = path.join(targetPath, file);
    copyFile(src, dest, copyOptions);
  }

  // 3. Copy .github if copilot option
  if (config.copilot) {
    console.log(chalk.cyan('🐙 Copying GitHub Copilot integration...'));
    const githubSrc = path.join(PACKAGE_ROOT, GITHUB_DIR);
    const githubDest = path.join(targetPath, GITHUB_DIR);
    copyDirectoryRecursive(githubSrc, githubDest, copyOptions);
  }

  // 4. Create directory structure
  console.log(chalk.cyan('📂 Creating directory structure...'));
  // Only create src/ and tests/ for greenfield projects
  // Brownfield projects use their existing codebase structure
  const dirsToCreate = config.projectType === 'greenfield'
    ? [...SPEC_DIRS, ...OUTPUT_DIRS]
    : SPEC_DIRS;
  createDirectories(targetPath, dirsToCreate, { dryRun: config.dryRun, stats });

  // 4b. Initialize Q&A decision log from template
  console.log(chalk.cyan('📝 Initializing Q&A decision log...'));
  const qaLogSrc = path.join(PACKAGE_ROOT, JUMPSTART_DIR, 'templates', 'qa-log.md');
  const qaLogDest = path.join(targetPath, 'specs', 'qa-log.md');
  copyFile(qaLogSrc, qaLogDest, copyOptions);

  // 5. Replace project name in config
  if (config.projectName) {
    console.log(chalk.cyan('✏️  Setting project name...'));
    const configPath = path.join(targetPath, JUMPSTART_DIR, 'config.yaml');
    replaceProjectName(configPath, config.projectName, { dryRun: config.dryRun });
  }

  // 6. Set project type in config
  if (config.projectType) {
    console.log(chalk.cyan('🏷️  Setting project type...'));
    const configPath = path.join(targetPath, JUMPSTART_DIR, 'config.yaml');
    setProjectType(configPath, config.projectType, { dryRun: config.dryRun });
  }

  // 6b. Set approver name in config
  if (config.approverName) {
    console.log(chalk.cyan('✍️  Setting approver name...'));
    const configPath = path.join(targetPath, JUMPSTART_DIR, 'config.yaml');
    setApprover(configPath, config.approverName, { dryRun: config.dryRun });
  }

  // 7. Context7 MCP setup (interactive only)
  if (config.interactive) {
    try {
      const context7Result = await setupContext7({
        targetDir: targetPath,
        dryRun: config.dryRun
      });
      if (context7Result.installed) {
        // Record in config.yaml that context7 is enabled
        const configPath = path.join(targetPath, JUMPSTART_DIR, 'config.yaml');
        appendContext7Config(configPath, config.dryRun);
      }
    } catch (err) {
      console.log(chalk.yellow('\n⚠️  Context7 MCP setup skipped due to an error.'));
      console.log(chalk.gray(`   ${err.message}`));
    }
  }

  // Display summary
  console.log(chalk.bold.green('\n✅ Installation complete!\n'));
  
  if (stats.copied.length > 0) {
    console.log(chalk.bold(`📦 Files copied: ${stats.copied.length}`));
  }
  
  if (stats.created.length > 0) {
    console.log(chalk.bold(`📁 Directories created: ${stats.created.length}`));
  }
  
  if (stats.skipped.length > 0 && !config.force) {
    console.log(chalk.yellow(`⚠️  Files skipped (already exist): ${stats.skipped.length}`));
    console.log(chalk.gray('   Use --force to overwrite existing files'));
  }

  // Next steps
  console.log(chalk.bold.blue('\n📖 Next Steps:\n'));
  if (targetPath !== process.cwd()) {
    console.log(chalk.gray(`   cd ${config.targetDir}`));
  }
  console.log(chalk.gray('   Open your project in VS Code with GitHub Copilot'));
  if (config.projectType === 'brownfield') {
    console.log(chalk.gray('   Select "Jump Start: Scout" agent to analyze your codebase'));
    console.log(chalk.gray('   Then proceed to "Jump Start: Challenger" for Phase 0'));
  } else {
    console.log(chalk.gray('   Select "Jump Start: Challenger" agent to begin Phase 0'));
  }
  console.log(chalk.gray('   Or run: @workspace /jumpstart-status\n'));
}

// Append context7 integration entry to config.yaml
function appendContext7Config(configPath, dryRun) {
  if (dryRun || !fs.existsSync(configPath)) return;

  let content = fs.readFileSync(configPath, 'utf8');

  // Only add if not already present
  if (content.includes('context7:')) return;

  const context7Block = [
    '',
    '# ---------------------------------------------------------------------------',
    '# Context7 MCP (Model Context Protocol)',
    '# ---------------------------------------------------------------------------',
    '# Context7 provides up-to-date library documentation to AI coding assistants.',
    '# Configured during setup. Manage keys at: https://context7.com',
    'context7:',
    '  enabled: true',
    '  # API key is stored in your client config files (e.g. .vscode/mcp.json),',
    '  # NOT in this file. Keep those files in .gitignore.',
    ''
  ].join('\n');

  content += context7Block;
  fs.writeFileSync(configPath, content, 'utf8');
}

// Main entry point
async function main() {
  try {
    // Check for subcommands before parsing normal args
    const subcommand = process.argv[2];
    
    if (subcommand === 'verify') {
      const { run } = require('./verify-diagrams');
      const verifyArgv = ['node', 'verify', ...process.argv.slice(3)];
      run(verifyArgv);
      return;
    }

    if (subcommand === 'validate') {
      // Schema validation (Item 5)
      const validator = require('./lib/validator');
      const filePath = process.argv[3];
      if (!filePath) {
        console.error(chalk.red('Usage: jumpstart-mode validate <artifact-path>'));
        process.exit(1);
      }
      const result = validator.validateArtifact(filePath, path.join(PACKAGE_ROOT, '.jumpstart', 'schemas'));
      if (result.valid) {
        console.log(chalk.green('✓ Artifact is valid.'));
      } else {
        console.error(chalk.red('✗ Validation errors:'));
        result.errors.forEach(e => console.error(chalk.yellow(`  - ${e}`)));
        process.exit(1);
      }
      return;
    }

    if (subcommand === 'spec-drift') {
      // Spec drift detection (Item 4)
      const specDrift = require('./lib/spec-drift');
      const specsDir = process.argv[3] || 'specs';
      const srcDir = process.argv[4] || 'src';
      const result = specDrift.checkSpecDrift(specsDir, srcDir);
      const io = require('./lib/io');
      io.writeResult(result);
      return;
    }

    if (subcommand === 'hash') {
      // Content-addressable specs (Item 12)
      const hashing = require('./lib/hashing');
      const action = process.argv[3]; // 'register' or 'verify'
      const manifestPath = path.join(process.cwd(), '.jumpstart', 'manifest.json');
      if (action === 'register') {
        const filePath = process.argv[4];
        if (!filePath) {
          console.error(chalk.red('Usage: jumpstart-mode hash register <file-path>'));
          process.exit(1);
        }
        const result = hashing.registerArtifact(filePath, manifestPath);
        console.log(chalk.green(`✓ Registered: ${result.hash.substring(0, 12)}...`));
      } else if (action === 'verify') {
        const results = hashing.verifyAll(manifestPath);
        const failed = results.filter(r => !r.valid);
        if (failed.length === 0) {
          console.log(chalk.green(`✓ All ${results.length} artifact(s) verified.`));
        } else {
          console.error(chalk.red(`✗ ${failed.length} artifact(s) failed verification:`));
          failed.forEach(f => console.error(chalk.yellow(`  - ${f.path}: ${f.reason}`)));
          process.exit(1);
        }
      } else {
        console.log('Usage: jumpstart-mode hash <register|verify> [file-path]');
      }
      return;
    }

    if (subcommand === 'graph') {
      // Dependency mapping (Item 13)
      const graph = require('./lib/graph');
      const action = process.argv[3]; // 'build' or 'coverage'
      const graphPath = path.join(process.cwd(), '.jumpstart', 'spec-graph.json');
      const specsDir = path.join(process.cwd(), 'specs');
      if (action === 'build') {
        const result = graph.buildFromSpecs(specsDir, graphPath);
        console.log(chalk.green(`✓ Graph built: ${result.nodes.length} nodes, ${result.edges.length} edges.`));
      } else if (action === 'coverage') {
        const result = graph.getCoverage(graphPath);
        console.log(chalk.blue('Dependency Coverage:'));
        console.log(`  Total nodes: ${result.total}`);
        console.log(`  With outgoing edges: ${result.withEdges}`);
        console.log(`  Orphans: ${result.orphans}`);
        console.log(`  Coverage: ${result.coverage}%`);
      } else {
        console.log('Usage: jumpstart-mode graph <build|coverage>');
      }
      return;
    }

    if (subcommand === 'simplicity') {
      // Simplicity gate (Item 9)
      const simplicity = require('./lib/simplicity-gate');
      const targetDir = process.argv[3] || 'src';
      const result = simplicity.check(targetDir);
      if (result.pass) {
        console.log(chalk.green(`✓ Simplicity gate passed (${result.count} top-level dirs).`));
      } else {
        console.error(chalk.red(`✗ Simplicity gate failed: ${result.count} top-level dirs (max ${result.max}).`));
        console.error(chalk.yellow('  Add a justification section to the Architecture Document.'));
        process.exit(1);
      }
      return;
    }

    if (subcommand === 'scan-wrappers') {
      // Anti-abstraction gate (Item 10)
      const antiAbstraction = require('./lib/anti-abstraction');
      const targetDir = process.argv[3] || 'src';
      const results = antiAbstraction.scanDirectory(targetDir);
      if (results.length === 0) {
        console.log(chalk.green('✓ No wrapper patterns detected.'));
      } else {
        console.error(chalk.yellow(`⚠ ${results.length} potential wrapper pattern(s) found:`));
        results.forEach(r => console.error(chalk.yellow(`  ${r.file}:${r.line} - ${r.pattern}`)));
      }
      return;
    }

    if (subcommand === 'invariants') {
      // Environment invariants check (Item 15)
      const invariants = require('./lib/invariants-check');
      const invariantsPath = path.join(process.cwd(), '.jumpstart', 'invariants.md');
      const specsDir = path.join(process.cwd(), 'specs');
      const report = invariants.generateReport(invariantsPath, specsDir);
      const io = require('./lib/io');
      io.writeResult(report);
      return;
    }

    if (subcommand === 'version-tag') {
      // Versioned artifacts (Item 6)
      const versioning = require('./lib/versioning');
      const filePath = process.argv[3];
      if (!filePath) {
        console.error(chalk.red('Usage: jumpstart-mode version-tag <artifact-path>'));
        process.exit(1);
      }
      const tag = versioning.createVersionTag(filePath);
      console.log(chalk.green(`✓ Version tag created: ${tag}`));
      return;
    }

    if (subcommand === 'template-check') {
      // Template hot-reloading (Item 14)
      const watcher = require('./lib/template-watcher');
      const templatesDir = path.join(process.cwd(), '.jumpstart', 'templates');
      const snapshotPath = path.join(process.cwd(), '.jumpstart', 'state', 'template-snapshot.json');
      const changes = watcher.checkForChanges(templatesDir, snapshotPath);
      if (changes.length === 0) {
        console.log(chalk.green('✓ All templates unchanged.'));
      } else {
        console.log(chalk.yellow(`⚠ ${changes.length} template(s) changed:`));
        changes.forEach(c => console.log(chalk.yellow(`  ${c.template}: ${c.changeType}`)));
      }
      return;
    }

    if (subcommand === 'freshness-audit') {
      // Context7 freshness audit (Item 101)
      const freshness = require('./lib/freshness-gate');
      const specsDir = path.join(process.cwd(), 'specs');
      const report = freshness.generateAuditReport(specsDir);
      console.log(report);
      return;
    }

    if (subcommand === 'shard') {
      // PRD sharding (Item 8)
      const sharder = require('./lib/sharder');
      const prdPath = process.argv[3] || path.join(process.cwd(), 'specs', 'prd.md');
      if (!fs.existsSync(prdPath)) {
        console.error(chalk.red(`PRD not found: ${prdPath}`));
        process.exit(1);
      }
      const content = fs.readFileSync(prdPath, 'utf8');
      if (sharder.shouldShard(content)) {
        const epics = sharder.extractEpics(content);
        console.log(chalk.blue(`Found ${epics.length} epic(s). Generating shards...`));
        const shardDir = path.join(process.cwd(), 'specs', 'prd');
        if (!fs.existsSync(shardDir)) fs.mkdirSync(shardDir, { recursive: true });
        epics.forEach((epic, i) => {
          const shard = sharder.generateShard(epic, i + 1);
          const shardPath = path.join(shardDir, `prd-${String(i + 1).padStart(3, '0')}-${epic.id.toLowerCase()}.md`);
          fs.writeFileSync(shardPath, shard, 'utf8');
          console.log(chalk.green(`  ✓ ${shardPath}`));
        });
        const index = sharder.generateIndex(epics);
        fs.writeFileSync(path.join(shardDir, 'index.md'), index, 'utf8');
        console.log(chalk.green('  ✓ Index generated.'));
      } else {
        console.log(chalk.green('✓ PRD is within context window limits. No sharding needed.'));
      }
      return;
    }

    if (subcommand === 'test') {
      // Quality test runner (5-layer testing)
      const flag = process.argv[3];
      const testArgs = ['npx', 'vitest', 'run'];
      if (flag === '--unit') {
        testArgs.push('--config', 'vitest.config.js', 'tests/test-schema.test.js', 'tests/test-spec-quality.test.js');
      } else if (flag === '--integration') {
        testArgs.push('--config', 'vitest.config.js', 'tests/test-handoffs.test.js');
      } else if (flag === '--regression') {
        testArgs.push('--config', 'vitest.config.js', 'tests/test-regression.test.js');
      } else if (flag === '--adversarial') {
        console.log(chalk.blue('Running adversarial review...'));
        console.log(chalk.yellow('Adversarial review requires LLM invocation. Use /jumpstart.adversary in chat.'));
        return;
      }
      const { execSync } = require('child_process');
      try {
        execSync(testArgs.join(' '), { stdio: 'inherit', cwd: process.cwd() });
      } catch (err) {
        process.exit(1);
      }
      return;
    }

    if (subcommand === 'checklist') {
      // Spec quality checklist
      const specTester = require('./lib/spec-tester');
      const smellDetector = require('./lib/smell-detector');
      const filePath = process.argv[3];
      if (!filePath || !fs.existsSync(filePath)) {
        console.error(chalk.red('Usage: jumpstart-mode checklist <spec-file>'));
        process.exit(1);
      }
      const content = fs.readFileSync(filePath, 'utf8');
      const result = specTester.runAllChecks(content, { specsDir: path.join(process.cwd(), 'specs') });
      console.log(specTester.generateReport(filePath));
      return;
    }

    if (subcommand === 'smells') {
      // Spec smell detection
      const smellDetector = require('./lib/smell-detector');
      const filePath = process.argv[3];
      if (!filePath || !fs.existsSync(filePath)) {
        console.error(chalk.red('Usage: jumpstart-mode smells <spec-file>'));
        process.exit(1);
      }
      console.log(smellDetector.generateSmellReport(filePath));
      return;
    }

    if (subcommand === 'handoff-check') {
      // Handoff contract validation
      const handoff = require('./lib/handoff-validator');
      const filePath = process.argv[3];
      const toPhase = process.argv[4] || 'architect';
      if (!filePath || !fs.existsSync(filePath)) {
        console.error(chalk.red('Usage: jumpstart-mode handoff-check <artifact-path> [target-phase]'));
        console.error(chalk.gray('  target-phase: architect | dev | qa'));
        process.exit(1);
      }
      const report = handoff.generateHandoffReport(filePath, 'upstream', toPhase);
      if (report.valid) {
        console.log(chalk.green(`✓ Handoff contract valid for transition to ${toPhase}.`));
      } else {
        console.error(chalk.red(`✗ Handoff contract violations:`));
        report.errors.forEach(e => console.error(chalk.yellow(`  - ${e}`)));
        process.exit(1);
      }
      return;
    }

    if (subcommand === 'coverage') {
      // Story-to-task coverage check
      const coverageModule = require('./lib/coverage');
      const prdPath = process.argv[3];
      const planPath = process.argv[4];
      if (!prdPath || !planPath) {
        console.error(chalk.red('Usage: jumpstart-mode coverage <prd-path> <plan-path>'));
        process.exit(1);
      }
      console.log(coverageModule.generateCoverageReport(prdPath, planPath));
      return;
    }

    if (subcommand === 'consistency') {
      // Cross-artifact consistency analysis (Item 64)
      const { analyze } = await import('./lib/analyzer.js');
      const specsDir = process.argv[3] || path.join(process.cwd(), 'specs');
      const result = await analyze(specsDir);
      const io = require('./lib/io');
      io.writeResult(result);
      return;
    }

    if (subcommand === 'lint') {
      // Auto-detect and run linter (Item 66)
      const { runLint } = await import('./lib/lint-runner.js');
      const targetDir = process.argv[3] || process.cwd();
      const result = await runLint(targetDir);
      const io = require('./lib/io');
      io.writeResult(result);
      return;
    }

    if (subcommand === 'contracts') {
      // Validate API contracts vs data model (Item 68)
      const { validateContracts } = await import('./lib/contract-checker.js');
      const specsDir = path.join(process.cwd(), 'specs');
      const result = validateContracts(specsDir);
      const io = require('./lib/io');
      io.writeResult(result);
      return;
    }

    if (subcommand === 'regulatory') {
      // Regulatory compliance gate (Item 71)
      const { evaluateRegulatory } = await import('./lib/regulatory-gate.js');
      const configPath = path.join(process.cwd(), '.jumpstart', 'config.yaml');
      const result = evaluateRegulatory(configPath);
      const io = require('./lib/io');
      io.writeResult(result);
      return;
    }

    if (subcommand === 'boundaries') {
      // Boundary validation (Item 74)
      const { checkBoundaries } = await import('./lib/boundary-check.js');
      const specsDir = path.join(process.cwd(), 'specs');
      const result = checkBoundaries(specsDir);
      const io = require('./lib/io');
      io.writeResult(result);
      return;
    }

    if (subcommand === 'task-deps') {
      // Task dependency audit (Item 73)
      const graph = require('./lib/graph');
      const graphPath = path.join(process.cwd(), '.jumpstart', 'spec-graph.json');
      if (!fs.existsSync(graphPath)) {
        console.error(chalk.red('No spec graph found. Run: jumpstart-mode graph build'));
        process.exit(1);
      }
      const graphData = graph.loadGraph(graphPath);
      const audit = graph.auditTaskDependencies(graphData);
      const io = require('./lib/io');
      io.writeResult(audit);
      return;
    }

    if (subcommand === 'diff') {
      // Dry-run diff summary (Item 77)
      const { generateDiff } = await import('./lib/diff.js');
      const targetPath = process.argv[3] || process.cwd();
      const result = generateDiff(targetPath);
      const io = require('./lib/io');
      io.writeResult(result);
      return;
    }

    if (subcommand === 'modules') {
      // Module system (Item 91)
      const { loadAllModules } = await import('./lib/module-loader.js');
      const modulesDir = path.join(process.cwd(), '.jumpstart', 'modules');
      const result = loadAllModules(modulesDir);
      const io = require('./lib/io');
      io.writeResult(result);
      return;
    }

    if (subcommand === 'validate-module') {
      // Module validation for marketplace (Item 94)
      const { validateForPublishing } = await import('./lib/registry.js');
      const moduleDir = process.argv[3];
      if (!moduleDir) {
        console.error(chalk.red('Usage: jumpstart-mode validate-module <module-dir>'));
        process.exit(1);
      }
      const result = validateForPublishing(path.resolve(moduleDir));
      const io = require('./lib/io');
      io.writeResult(result);
      return;
    }

    if (subcommand === 'usage') {
      // Usage summary (Item 99)
      const { summarizeUsage, generateUsageReport } = await import('./lib/usage.js');
      const logPath = path.join(process.cwd(), '.jumpstart', 'usage-log.json');
      const action = process.argv[3] || 'summary';
      if (action === 'report') {
        console.log(generateUsageReport(logPath));
      } else {
        const io = require('./lib/io');
        io.writeResult(summarizeUsage(logPath));
      }
      return;
    }

    if (subcommand === 'self-evolve') {
      // Self-evolve config proposals (Item 100)
      const { analyzeAndPropose, generateProposalArtifact } = await import('./lib/self-evolve.js');
      const projectDir = process.cwd();
      const result = analyzeAndPropose(projectDir);
      if (process.argv[3] === '--artifact') {
        console.log(generateProposalArtifact(result));
      } else {
        const io = require('./lib/io');
        io.writeResult(result);
      }
      return;
    }

    if (subcommand === 'next') {
      // Auto-pilot phase progression (UX Feature 1)
      const { determineNextAction } = await import('./lib/next-phase.js');
      const result = determineNextAction({ root: process.cwd() });
      const io = require('./lib/io');
      io.writeResult(result);
      return;
    }

    if (subcommand === 'ceremony') {
      // Ceremony profile management (UX Feature 3)
      const { expandProfile, getProfileDescription, getProfileSummary, compareProfiles, VALID_PROFILES } = await import('./lib/ceremony.js');
      const action = process.argv[3];
      const io = require('./lib/io');

      if (action === 'set') {
        const profile = process.argv[4];
        if (!profile || !VALID_PROFILES.includes(profile)) {
          console.error(chalk.red(`Usage: jumpstart-mode ceremony set <${VALID_PROFILES.join('|')}>`));
          process.exit(1);
        }
        // Update config.yaml ceremony.profile
        const configPath = path.join(process.cwd(), '.jumpstart', 'config.yaml');
        if (fs.existsSync(configPath)) {
          let content = fs.readFileSync(configPath, 'utf8');
          content = content.replace(
            /^(\s*profile:\s*)\S+/m,
            `$1${profile}`
          );
          fs.writeFileSync(configPath, content, 'utf8');
          console.log(chalk.green(`Ceremony profile set to: ${profile}`));
          console.log(chalk.gray(getProfileDescription(profile)));
        } else {
          console.error(chalk.red('Config file not found. Run jumpstart-mode init first.'));
          process.exit(1);
        }
        return;
      }

      if (action === 'compare') {
        const a = process.argv[4] || 'light';
        const b = process.argv[5] || 'rigorous';
        const diffs = compareProfiles(a, b);
        io.writeResult({ comparison: `${a} vs ${b}`, differences: diffs });
        return;
      }

      // Default: show summary
      const summary = getProfileSummary();
      io.writeResult(summary);
      return;
    }

    if (subcommand === 'summarize') {
      // Smart context summarizer (UX Feature 9)
      const { generateContextPacket, renderContextMarkdown } = require('./lib/context-summarizer');
      const phaseArg = process.argv[3];
      const formatArg = process.argv.includes('--markdown') ? 'markdown' : 'json';

      if (!phaseArg || isNaN(parseInt(phaseArg))) {
        console.error(chalk.red('Usage: jumpstart-mode summarize <phase> [--markdown]'));
        console.error(chalk.gray('  phase: 0-4 (target phase that will consume the summary)'));
        process.exit(1);
      }

      const packet = generateContextPacket({
        target_phase: parseInt(phaseArg),
        root: process.cwd()
      });

      if (formatArg === 'markdown') {
        console.log(renderContextMarkdown(packet));
      } else {
        const io = require('./lib/io');
        io.writeResult(packet);
      }
      return;
    }

    if (subcommand === 'dashboard') {
      // Interactive Progress Dashboard (UX Feature 5)
      const { gatherDashboardData, renderDashboardText } = await import('./lib/dashboard.js');
      const jsonMode = process.argv.includes('--json');
      const data = await gatherDashboardData({ root: process.cwd() });
      if (jsonMode) {
        const io = require('./lib/io');
        io.writeResult(data);
      } else {
        console.log(renderDashboardText(data));
      }
      return;
    }

    if (subcommand === 'validate-all') {
      // Proactive Validation & Suggestion Engine (UX Feature 7)
      const { validateArtifactProactive, validateAllArtifacts, renderValidationReport } = require('./lib/proactive-validator');
      const io = require('./lib/io');
      const fileArg = process.argv.indexOf('--file') !== -1 ? process.argv[process.argv.indexOf('--file') + 1] : null;
      const jsonMode = process.argv.includes('--json');
      const strict = process.argv.includes('--strict');

      if (fileArg) {
        const result = validateArtifactProactive(path.resolve(fileArg), { strict });
        if (jsonMode) {
          io.writeResult(result);
        } else {
          const report = renderValidationReport({ files: [result], cross_file: {}, summary: { total_files: 1, total_diagnostics: result.diagnostics.length, pass_count: result.pass ? 1 : 0, fail_count: result.pass ? 0 : 1, avg_score: result.score } });
          console.log(report);
        }
      } else {
        const specsDir = path.join(process.cwd(), 'specs');
        const result = await validateAllArtifacts(specsDir, { root: process.cwd(), strict });
        if (jsonMode) {
          io.writeResult(result);
        } else {
          console.log(renderValidationReport(result));
        }
      }
      return;
    }

    if (subcommand === 'quickstart') {
      // 5-Minute Quickstart Wizard (UX Feature 15)
      const { DOMAIN_OPTIONS, CEREMONY_OPTIONS, buildQuickstartConfig, generateQuickstartSummary, applyConfigPatches } = await import('./lib/quickstart.js');

      console.log(chalk.bold.blue('\n🚀 JumpStart Quickstart — Set up in under 60 seconds\n'));

      // Step 1: Project name
      const { projectName } = await prompts({
        type: 'text',
        name: 'projectName',
        message: 'Project name:',
        initial: path.basename(process.cwd())
      });
      if (projectName === undefined) { console.log(chalk.yellow('\n❌ Setup cancelled\n')); process.exit(0); }

      // Step 2: Project type (auto-detect)
      const detection = detectProjectType(process.cwd());
      if (detection.signals.length > 0 && detection.type === 'brownfield') {
        console.log(chalk.cyan(`\n🔍 Detected existing project signals: ${detection.signals.slice(0, 3).join(', ')}`));
      }
      const { projectType } = await prompts({
        type: 'select',
        name: 'projectType',
        message: 'Project type:',
        choices: [
          { title: 'Greenfield (new project)', value: 'greenfield' },
          { title: 'Brownfield (existing codebase)', value: 'brownfield' }
        ],
        initial: detection.type === 'brownfield' ? 1 : 0
      });
      if (!projectType) { console.log(chalk.yellow('\n❌ Setup cancelled\n')); process.exit(0); }

      // Step 3: Domain
      const { domain } = await prompts({
        type: 'select',
        name: 'domain',
        message: 'Project domain:',
        choices: DOMAIN_OPTIONS.map(d => ({ title: d.title, value: d.value, description: d.description }))
      });
      if (!domain) { console.log(chalk.yellow('\n❌ Setup cancelled\n')); process.exit(0); }

      let customDomain = null;
      if (domain === 'other') {
        const { custom } = await prompts({
          type: 'text',
          name: 'custom',
          message: 'Enter your project domain:',
          initial: 'general'
        });
        customDomain = custom;
      }

      // Step 4: Ceremony level
      const { ceremony } = await prompts({
        type: 'select',
        name: 'ceremony',
        message: 'Ceremony level:',
        choices: CEREMONY_OPTIONS.map(c => ({ title: c.title, value: c.value, description: c.description })),
        initial: 1 // Standard is default
      });
      if (!ceremony) { console.log(chalk.yellow('\n❌ Setup cancelled\n')); process.exit(0); }

      // Build config
      const qsConfig = buildQuickstartConfig({
        projectName,
        projectType,
        domain,
        customDomain,
        ceremony,
        targetDir: '.'
      });

      // Run the standard install
      const installConfig = {
        targetDir: '.',
        projectName: qsConfig.projectName,
        approverName: null,
        projectType: qsConfig.projectType,
        copilot: qsConfig.copilot,
        force: false,
        dryRun: false,
        interactive: false
      };

      await install(installConfig);

      // Patch config.yaml with domain and ceremony
      const configPath = path.join(process.cwd(), '.jumpstart', 'config.yaml');
      if (fs.existsSync(configPath)) {
        let content = fs.readFileSync(configPath, 'utf8');
        content = applyConfigPatches(content, qsConfig);
        fs.writeFileSync(configPath, content, 'utf8');
      }

      // Display summary
      const summary = generateQuickstartSummary(qsConfig);
      console.log(chalk.bold.green('\n✅ JumpStart initialized!\n'));
      for (const line of summary.lines) {
        console.log(chalk.white('  ' + line));
      }
      console.log('');
      console.log(chalk.bold.green(`  ▶ Type ${chalk.white(summary.firstCommand)} to begin!`));
      console.log(chalk.gray(`    ${summary.firstMessage}`));
      console.log('');
      return;
    }

    if (subcommand === 'rewind') {
      // Phase Rewind with Cascade (UX Feature 2)
      const { rewindToPhase, renderRewindReport } = await import('./lib/rewind.js');
      const phaseArg = process.argv[3];
      const jsonMode = process.argv.includes('--json');
      const reasonIdx = process.argv.indexOf('--reason');
      const reason = reasonIdx !== -1 ? process.argv[reasonIdx + 1] : undefined;

      if (phaseArg === undefined || isNaN(parseInt(phaseArg))) {
        console.error(chalk.red('Usage: jumpstart-mode rewind <phase> [--reason <text>] [--json]'));
        console.error(chalk.gray('  phase: -1 to 4 (target phase to rewind to)'));
        process.exit(1);
      }

      const result = await rewindToPhase(parseInt(phaseArg), { root: process.cwd(), reason });
      if (jsonMode) {
        const io = require('./lib/io');
        io.writeResult(result);
      } else {
        console.log(renderRewindReport(result));
      }
      return;
    }

    if (subcommand === 'approve') {
      // Programmatic Artifact Approval (UX Feature 4)
      const { detectCurrentArtifact, approveArtifact, renderApprovalResult } = await import('./lib/approve.js');
      const artifactPath = process.argv[3] && !process.argv[3].startsWith('--') ? process.argv[3] : null;
      const approverIdx = process.argv.indexOf('--approver');
      const approver = approverIdx !== -1 ? process.argv[approverIdx + 1] : undefined;
      const jsonMode = process.argv.includes('--json');

      let targetPath = artifactPath;
      if (!targetPath) {
        const detected = detectCurrentArtifact({ root: process.cwd() });
        if (!detected.artifact_path) {
          console.error(chalk.red('No artifact detected for current phase. Specify a path: jumpstart-mode approve <path>'));
          process.exit(1);
        }
        targetPath = detected.artifact_path;
      }

      const result = approveArtifact(path.resolve(targetPath), { root: process.cwd(), approver });
      if (jsonMode) {
        const io = require('./lib/io');
        io.writeResult(result);
      } else {
        console.log(renderApprovalResult(result));
      }
      return;
    }

    if (subcommand === 'reject') {
      // Programmatic Artifact Rejection (UX Feature 4)
      const { detectCurrentArtifact, rejectArtifact, renderRejectionResult } = await import('./lib/approve.js');
      const artifactPath = process.argv[3] && !process.argv[3].startsWith('--') ? process.argv[3] : null;
      const reasonIdx = process.argv.indexOf('--reason');
      const reason = reasonIdx !== -1 ? process.argv[reasonIdx + 1] : 'No reason specified';
      const jsonMode = process.argv.includes('--json');

      let targetPath = artifactPath;
      if (!targetPath) {
        const detected = detectCurrentArtifact({ root: process.cwd() });
        if (!detected.artifact_path) {
          console.error(chalk.red('No artifact detected for current phase. Specify a path: jumpstart-mode reject <path>'));
          process.exit(1);
        }
        targetPath = detected.artifact_path;
      }

      const result = rejectArtifact(path.resolve(targetPath), { root: process.cwd(), reason });
      if (jsonMode) {
        const io = require('./lib/io');
        io.writeResult(result);
      } else {
        console.log(renderRejectionResult(result));
      }
      return;
    }

    if (subcommand === 'checkpoint') {
      // Session Checkpointing (UX Feature 10)
      const { createCheckpoint, restoreCheckpoint, listCheckpoints } = await import('./lib/state-store.js');
      const action = process.argv[3];
      const jsonMode = process.argv.includes('--json');
      const io = require('./lib/io');

      if (action === 'create') {
        const label = process.argv[4] || undefined;
        const result = createCheckpoint(label, { root: process.cwd() });
        if (jsonMode) {
          io.writeResult(result);
        } else {
          console.log(chalk.green(`✅ Checkpoint created: ${result.id}`));
          if (result.label) console.log(chalk.gray(`   Label: ${result.label}`));
          console.log(chalk.gray(`   Phase: ${result.phase ?? 'none'} | Artifacts: ${(result.approved_artifacts || []).length}`));
        }
        return;
      }

      if (action === 'list') {
        const checkpoints = listCheckpoints(path.join(process.cwd(), '.jumpstart', 'state', 'state.json'));
        if (jsonMode) {
          io.writeResult(checkpoints);
        } else {
          if (checkpoints.length === 0) {
            console.log(chalk.yellow('No checkpoints found.'));
          } else {
            console.log(chalk.bold(`\n📌 Checkpoints (${checkpoints.length}):\n`));
            for (const cp of checkpoints) {
              const date = new Date(cp.timestamp).toLocaleString();
              console.log(chalk.white(`  ${cp.id}  ${date}  ${cp.label || '(no label)'}  phase=${cp.phase ?? '?'}`));
            }
            console.log('');
          }
        }
        return;
      }

      if (action === 'restore') {
        const cpId = process.argv[4];
        if (!cpId) {
          console.error(chalk.red('Usage: jumpstart-mode checkpoint restore <checkpoint-id>'));
          process.exit(1);
        }
        const result = restoreCheckpoint(cpId, path.join(process.cwd(), '.jumpstart', 'state', 'state.json'));
        if (jsonMode) {
          io.writeResult(result);
        } else {
          if (result.success) {
            console.log(chalk.green(`✅ Restored checkpoint: ${cpId}`));
            console.log(chalk.gray(`   Phase: ${result.restored.phase ?? 'none'} | Artifacts: ${(result.restored.approved_artifacts || []).length}`));
          } else {
            console.error(chalk.red(`❌ ${result.error}`));
          }
        }
        return;
      }

      console.error(chalk.red('Usage: jumpstart-mode checkpoint <create|list|restore> [args]'));
      process.exit(1);
    }

    if (subcommand === 'handoff') {
      // Export Handoff Package (UX Feature 14)
      const { exportHandoffPackage } = require('./lib/export');
      const outputIdx = process.argv.indexOf('--output');
      const outputPath = outputIdx !== -1 ? process.argv[outputIdx + 1] : undefined;
      const jsonMode = process.argv.includes('--json');

      const result = exportHandoffPackage({ root: process.cwd(), outputPath });
      if (jsonMode) {
        const io = require('./lib/io');
        io.writeResult(result);
      } else {
        if (result.success) {
          console.log(chalk.green(`✅ Handoff package exported: ${result.output_path}`));
          console.log(chalk.gray(`   Phases: ${result.stats.phases} | Approved: ${result.stats.approved} | Decisions: ${result.stats.decisions} | Open items: ${result.stats.open_items}`));
        } else {
          console.error(chalk.red(`❌ ${result.error}`));
        }
      }
      return;
    }

    if (subcommand === 'merge-templates') {
      // Template inheritance merge (Item 93)
      const { mergeTemplateFiles } = await import('./lib/template-merge.js');
      const basePath = process.argv[3];
      const projectPath = process.argv[4];
      if (!basePath || !projectPath) {
        console.error(chalk.red('Usage: jumpstart-mode merge-templates <base-path> <project-path>'));
        process.exit(1);
      }
      const result = mergeTemplateFiles(path.resolve(basePath), path.resolve(projectPath));
      console.log(JSON.stringify({ stats: result.stats }, null, 2));
      console.log(result.merged);
      return;
    }

    let config = parseArgs();

    if (config.help) {
      showHelp();
      process.exit(0);
    }

    // Run interactive mode if no flags provided
    if (config.interactive) {
      config = await runInteractive();
    } else if (!config.projectType) {
      // Auto-detect project type when not specified via --type
      const detection = detectProjectType(config.targetDir);
      config.projectType = detection.type;
    }

    await install(config);
  } catch (error) {
    console.error(chalk.red('\n❌ Error:'), error.message);
    console.error(chalk.gray('\nRun with --help for usage information\n'));
    process.exit(1);
  }
}

main();

#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const chalk = require('chalk');
const prompts = require('prompts');
const { setupContext7 } = require('./context7-setup');
const { updateBootstrapAnswers } = require('./lib/config-yaml.cjs');

// Get the package root directory (where .jumpstart/ lives)
const PACKAGE_ROOT = path.join(__dirname, '..');

// Files and directories to copy
const INTEGRATION_FILES = ['AGENTS.md', 'CLAUDE.md', '.cursorrules'];
const MERGEABLE_INTEGRATION_FILES = ['AGENTS.md', 'CLAUDE.md'];
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
    projectType: null,  // greenfield | brownfield | null (auto-detect)
    conflictStrategy: 'skip' // skip | overwrite | merge
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
      config.conflictStrategy = 'overwrite';
      config.interactive = false;
    } else if (arg === '--dry-run') {
      config.dryRun = true;
      config.interactive = false;
    } else if (arg === '--conflict') {
      const strategy = args[++i];
      if (strategy === 'skip' || strategy === 'overwrite' || strategy === 'merge') {
        config.conflictStrategy = strategy;
      } else {
        console.error(chalk.red(`Invalid --conflict value: ${strategy}. Must be 'skip', 'overwrite', or 'merge'.`));
        process.exit(1);
      }
      if (strategy === 'overwrite') {
        config.force = true;
      }
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
  console.log('  timeline             View, query, export, or clear interaction timeline');
  console.log('  validate-all         Proactive validation & suggestion engine');
  console.log('  quickstart           5-minute quickstart wizard');
  console.log('  rewind <phase>       Rewind to target phase, archiving downstream artifacts');
  console.log('  approve [path]       Approve current or specified phase artifact');
  console.log('  reject [path]        Reject artifact with reason');
  console.log('  checkpoint <action>  Session checkpoints (create/list/restore)');
  console.log('  handoff              Export portable handoff package');
  console.log('  install <item>       Install skill/agent/prompt from marketplace');
  console.log('  uninstall <item>     Uninstall a marketplace item');
  console.log('  status               Show installed marketplace items');
  console.log('  integrate            Rebuild skill integration files');
  console.log('  update [item]        Update installed items to latest');
  console.log('  upgrade              Safely upgrade framework files (preserves user content)');
  console.log('  upgrade --restore    Restore files from upgrade backups');
  console.log('  multi-repo <action>  Multi-repo program orchestration (init/status/link/plan)');
  console.log('  bidirectional-trace  Bidirectional code-to-spec traceability (scan/report)');
  console.log('  impact <file>        Agentic change impact analysis');
  console.log('  repo-graph <action>  Automated repo understanding graph (build/query)');
  console.log('  memory <action>      Persistent project memory (add/list/search/recall)');
  console.log('  policy <action>      Enterprise policy engine (check/list/add)');
  console.log('  branch-workflow      Branch-aware workflow engine (track/status/sync)');
  console.log('  pr-package <action>  PR-native execution mode (create/list/export)');
  console.log('  parallel-agents      Multi-agent concurrent execution (run/status/reconcile)');
  console.log('  role-approval        Human approval workflows with roles (assign/approve/status)');
  console.log('  requirements-baseline Requirements baseline & change control (freeze/check/impact/status)');
  console.log('  semantic-diff        Cross-artifact semantic diffing (compare/cross-artifact)');
  console.log('  backlog-sync         Native backlog synchronization (extract/export/status)');
  console.log('  delivery-confidence  Delivery confidence scoring (score/project)');
  console.log('  plan-executor        Rich plan execution engine (init/status/update/verify/reset)');
  console.log('  fitness-functions    Architectural fitness functions (evaluate/add/list)');
  console.log('  reference-arch       Org-wide reusable reference architectures (list/get/register/instantiate)');
  console.log('  decision-conflicts   Decision conflict detection (detect)');
  console.log('  spec-maturity        Spec maturity model (assess/project)');
  console.log('  portfolio            Portfolio reporting layer (register/status/refresh/snapshot/remove)');
  console.log('  ci-cd-integration    CI/CD pipeline integration (generate/validate/status)');
  console.log('  env-promotion        Environment promotion governance (promote/gate/status)');
  console.log('  raci-matrix          RACI-aware approvals (define/check/report)');
  console.log('  compliance-packs     Compliance framework packs (list/apply/check)');
  console.log('  evidence-collector   Evidence collection automation (collect/package/status)');
  console.log('  release-readiness    Release readiness reviews (assess/report)');
  console.log('  waiver-workflow      Exception & waiver workflow (request/approve/list/expire)');
  console.log('  sla-slo              SLA & SLO specification (define/check/report)');
  console.log('  risk-register        Risk register tracking (add/update/list/report)');
  console.log('  data-classification  Data classification controls (classify/check/report)');
  console.log('  credential-boundary  Secrets & credential boundary checks (scan/report)');
  console.log('  ea-review-packet     Enterprise architecture review packet (generate)');
  console.log('  model-governance     Model governance workflows (register/evaluate/report)');
  console.log('  ai-intake            AI use case intake templates (create/list/assess)');
  console.log('  finops-planner       FinOps-aware architecture planning (estimate/optimize/report)');
  console.log('  vendor-risk          Vendor & dependency risk scoring (scan/assess/report)');
  console.log('  cab-output           Change advisory board output (generate)');
  console.log('  bcdr-planning        Business continuity & DR planning (define/check/report)');
  console.log('  ops-ownership        Operational ownership modeling (define/check/report)');
  console.log('  governance-dashboard Governance dashboards for leadership');
  console.log('  codebase-retrieval   Codebase-native retrieval layer (index/query)');
  console.log('  ast-edit             AST-aware edit engine (analyze/validate)');
  console.log('  refactor-planner     Refactor planner with dependency safety (plan/validate/report)');
  console.log('  test-generator       Test generation from acceptance criteria (generate/coverage)');
  console.log('  contract-first       Contract-first implementation assistant (extract/verify)');
  console.log('  runtime-debugger     Runtime-aware debugging mode (analyze/correlate)');
  console.log('  migration-planner    Brownfield migration planner (plan/status/report)');
  console.log('  legacy-modernizer    Legacy code modernization mode (assess/plan/report)');
  console.log('  db-evolution         Database evolution planner (plan/validate/report)');
  console.log('  safe-rename          Safe large-scale rename & move engine (plan/validate)');
  console.log('  dependency-upgrade   Dependency upgrade autopilot (scan/plan/report)');
  console.log('  incident-feedback    Incident-to-spec feedback loop (log/analyze/report)');
  console.log('  context-chunker      Implementation chunking by context window (chunk/estimate)');
  console.log('  model-router         Multi-model routing (route/config/report)');
  console.log('  cost-router          Cost-aware model routing (route/budget/report)');
  console.log('  deterministic        Deterministic artifact generation (normalize/verify)');
  console.log('  agent-checkpoint     Agent self-checkpoint & resume (save/restore/list/clean)');
  console.log('  tool-guardrails      Tool execution guardrails (check/validate)');
  console.log('  root-cause           Root cause analysis for failures (analyze/report)');
  console.log('  quality-graph        Code quality smell graph (scan/report)');
  console.log('  web-dashboard        Rich web UI / local dashboard (config/data/status)');
  console.log('  role-views           Role-based project views (generate/list)');
  console.log('  spec-comments        Inline spec review comments (add/resolve/list)');
  console.log('  workshop-mode        Live workshop mode (start/status)');
  console.log('  collaboration        Real-time collaboration sessions (create/status)');
  console.log('  elicitation          Facilitated Q&A with structured elicitation (start/report)');
  console.log('  enterprise-templates Guided enterprise templates (list/get/apply)');
  console.log('  playback-summaries   Stakeholder playback summaries (generate/list)');
  console.log('  design-system        Design system integration (register/check/report)');
  console.log('  diagram-studio       Diagram studio (generate/validate/compare/list)');
  console.log('  ambiguity-heatmap    Requirement ambiguity heatmap (scan/report)');
  console.log('  estimation-studio    Feature estimation studio (estimate/report/calibrate)');
  console.log('  guided-handoff       Guided handoff packages by team (generate/list/validate)');
  console.log('  transcript-ingestion Meeting transcript ingestion (ingest/extract/list)');
  console.log('  chat-integration     Slack and Teams integration (configure/notify)');
  console.log('  context-onboarding   Context-aware onboarding (generate/customize)');
  console.log('  promptless-mode      Promptless wizard mode (start/step/status)');
  console.log('  artifact-comparison  Artifact comparison across versions (compare/history)');
  console.log('  workstream-ownership Workstream ownership visualization (define/query/report)');
  console.log('  persona-packs        Persona packs for enterprise roles (list/get/apply)');
  console.log('  knowledge-graph      Knowledge graph across initiatives (add/query/report)');
  console.log('  pattern-library      Inner-source pattern library (register/search/get/list)');
  console.log('  domain-ontology      Domain ontology support (define/query/validate/report)');
  console.log('  data-contracts       Data contract governance (register/validate/lineage/report)');
  console.log('  event-modeling       Event-driven architecture modeling (define/validate/report)');
  console.log('  platform-engineering Platform engineering integration (register/list/instantiate/report)');
  console.log('  ai-evaluation        AI system evaluation framework (evaluate/report/configure)');
  console.log('  prompt-governance    Prompt and agent version governance (register/version/approve/list)');
  console.log('  sre-integration      SRE integration (generate/configure/report)');
  console.log('  telemetry-feedback   Production telemetry feedback loop (ingest/analyze/report)');
  console.log('  enterprise-search    Enterprise search over artifacts (index/search)');
  console.log('  revert <path>        Archive rejected artifact draft and restore previous version');
  console.log('  adr <action>         Search/index Architecture Decision Records (build/search)');
  console.log('  complexity [path]    Calculate adaptive planning depth (quick/standard/deep)');
  console.log('  crossref [dir]       Validate markdown cross-references and detect orphans');
  console.log('  init                 Interactive initialization wizard (skill level, preferences)');
  console.log('  lock <action>        Artifact file locking for concurrent agents (acquire/release/list)');
  console.log('  timestamp <action>   UTC timestamp utilities (now/validate/audit)');
  console.log('  scan [dir]           Discover project context and tech stack\n');
  console.log(chalk.bold('OPTIONS:'));
  console.log('  <directory>        Target directory (default: current directory)');
  console.log('  --name <name>      Set project name in config');
  console.log('  --approver <name>  Set approver name in config');
  console.log('  --type <type>      Set project type: greenfield | brownfield');
  console.log('  --copilot          Include GitHub Copilot integration');
  console.log('  --force            Overwrite existing files without prompting');
  console.log('  --conflict <mode>  Conflict handling: skip | overwrite | merge');
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
  console.log('  npx jumpstart-mode . --conflict merge');
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
  console.log('  npx jumpstart-mode handoff --output ./export/handoff.md --json');
  console.log('  npx jumpstart-mode upgrade');
  console.log('  npx jumpstart-mode upgrade --dry-run');
  console.log('  npx jumpstart-mode upgrade --restore\n');
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
  const {
    dryRun = false,
    force = false,
    conflictStrategy = 'skip',
    stats = { copied: [], skipped: [], merged: [] },
    mergeResolver = null,
  } = options;

  if (!fs.existsSync(src)) {
    return stats;
  }

  const exists = fs.existsSync(dest);
  if (exists && !force) {
    if (conflictStrategy === 'merge' && typeof mergeResolver === 'function') {
      if (!dryRun) {
        const srcContent = fs.readFileSync(src, 'utf8');
        const destContent = fs.readFileSync(dest, 'utf8');
        const mergedContent = mergeResolver(destContent, srcContent, path.basename(dest));
        if (mergedContent !== destContent) {
          fs.writeFileSync(dest, mergedContent, 'utf8');
          stats.merged.push(dest);
        } else {
          stats.skipped.push(dest);
        }
      } else {
        stats.merged.push(dest);
      }
    } else {
      stats.skipped.push(dest);
    }
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

function buildMergedInstructionBlock(frameworkContent, fileName) {
  const startMarker = `<!-- BEGIN JUMPSTART MERGE: ${fileName} -->`;
  const endMarker = `<!-- END JUMPSTART MERGE: ${fileName} -->`;
  const trimmed = frameworkContent.trim();

  return {
    startMarker,
    endMarker,
    block: [
      '',
      '---',
      '',
      '## Jump Start Framework Instructions (Merged)',
      '',
      '> This section is managed by `jumpstart-mode --conflict merge`.',
      '> Keep your custom instructions above this block.',
      '',
      startMarker,
      trimmed,
      endMarker,
      '',
    ].join('\n'),
  };
}

function mergeInstructionDocument(existingContent, frameworkContent, fileName) {
  const { startMarker, endMarker, block } = buildMergedInstructionBlock(frameworkContent, fileName);
  const escapedStart = startMarker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const escapedEnd = endMarker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const blockRegex = new RegExp(`${escapedStart}[\\s\\S]*?${escapedEnd}`, 'm');

  if (blockRegex.test(existingContent)) {
    return existingContent.replace(blockRegex, `${startMarker}\n${frameworkContent.trim()}\n${endMarker}`);
  }

  return `${existingContent.replace(/\s*$/, '')}${block}`;
}

function buildSkipWarningNote(skippedFiles) {
  const timestamp = new Date().toISOString();
  const bulletList = skippedFiles.map(file => `- ${file}`).join('\n');

  return [
    '# Jump Start Installation Warning',
    '',
    `Generated: ${timestamp}`,
    '',
    'The following integration files were skipped during bootstrap:',
    bulletList,
    '',
    'Skipping these files can cause integration issues for AI assistants because required Jump Start instruction blocks may be missing.',
    'Recommended fix: re-run bootstrap with merge mode:',
    '',
    '```bash',
    'npx jumpstart-mode . --conflict merge',
    '```',
    '',
  ].join('\n');
}

function persistSkipWarning(targetPath, skippedFiles, dryRun) {
  if (dryRun || skippedFiles.length === 0) {
    return;
  }

  const warningPath = path.join(targetPath, JUMPSTART_DIR, 'state', 'install-warnings.md');
  const warningDir = path.dirname(warningPath);
  if (!fs.existsSync(warningDir)) {
    fs.mkdirSync(warningDir, { recursive: true });
  }

  fs.writeFileSync(warningPath, buildSkipWarningNote(skippedFiles), 'utf8');
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

function persistBootstrapAnswers(configPath, config, options = {}) {
  const { dryRun = false } = options;

  if (dryRun) {
    return { changed: false, applied: [] };
  }

  return updateBootstrapAnswers(configPath, {
    projectName: config.projectName,
    projectType: config.projectType,
    approverName: config.approverName,
  });
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
    conflictStrategy: 'skip',
    dryRun: false,
    interactive: true
  };

  // Check for conflicts
  const conflicts = detectConflicts(targetPath, config);

  if (conflicts.length > 0 && !config.force) {
    console.log(chalk.yellow('\n⚠️  The following files/directories already exist:'));
    conflicts.forEach(c => console.log(chalk.yellow(`   - ${c}`)));
    
    // Check if this is an existing jumpstart project
    const hasManifest = fs.existsSync(path.join(targetPath, '.jumpstart', 'framework-manifest.json'));
    const hasConfig = fs.existsSync(path.join(targetPath, '.jumpstart', 'config.yaml'));
    if (hasManifest || hasConfig) {
      console.log(chalk.cyan('\n💡 Tip: Use "npx jumpstart-mode upgrade" to safely update framework files'));
      console.log(chalk.cyan('   while preserving your config, state, specs, and custom agents.'));
    }

    const mergeableConflicts = conflicts.filter(c => MERGEABLE_INTEGRATION_FILES.includes(c));
    const { strategy } = await prompts({
      type: 'select',
      name: 'strategy',
      message: mergeableConflicts.length > 0
        ? 'How should conflicts be handled?'
        : 'How should existing files be handled?',
      choices: [
        {
          title: 'Skip existing files',
          description: 'Keep existing files untouched (may cause integration issues for AGENTS.md/CLAUDE.md)',
          value: 'skip'
        },
        {
          title: 'Overwrite existing files',
          description: 'Replace conflicting files with Jump Start defaults',
          value: 'overwrite'
        },
        {
          title: 'Merge AGENTS.md and CLAUDE.md',
          description: 'Append/refresh Jump Start instruction blocks while preserving custom content',
          value: 'merge'
        }
      ],
      initial: 0
    });

    if (!strategy) {
      console.log(chalk.yellow('\n❌ Setup cancelled\n'));
      process.exit(0);
    }

    config.conflictStrategy = strategy;
    config.force = strategy === 'overwrite';
  }

  return config;
}

// Main installation function
async function install(config) {
  const targetPath = path.resolve(config.targetDir);

  // Safeguard: warn if --force is used on an existing jumpstart project
  if (config.force && !config.interactive) {
    const manifestPath = path.join(targetPath, '.jumpstart', 'framework-manifest.json');
    const configPath = path.join(targetPath, '.jumpstart', 'config.yaml');
    if (fs.existsSync(manifestPath) || fs.existsSync(configPath)) {
      console.log(chalk.yellow.bold('\n⚠️  WARNING: --force will overwrite ALL files including:'));
      console.log(chalk.yellow('   - .jumpstart/config.yaml (your custom settings)'));
      console.log(chalk.yellow('   - .jumpstart/state/ (your workflow state)'));
      console.log(chalk.yellow('   - .jumpstart/agents/ (any agent customizations)'));
      console.log(chalk.yellow('\n💡 Consider using "npx jumpstart-mode upgrade" instead.'));
      console.log(chalk.yellow('   It preserves user content and backs up modified files.\n'));
    }
  }

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
    merged: [],
    created: []
  };

  const copyOptions = {
    dryRun: config.dryRun,
    force: config.force,
    conflictStrategy: config.conflictStrategy || (config.force ? 'overwrite' : 'skip'),
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
    const fileOptions = {
      ...copyOptions,
      mergeResolver: MERGEABLE_INTEGRATION_FILES.includes(file)
        ? mergeInstructionDocument
        : null,
    };
    copyFile(src, dest, fileOptions);
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

  // 5-6. Persist bootstrap answers in config.yaml
  const configPath = path.join(targetPath, JUMPSTART_DIR, 'config.yaml');
  const hasBootstrapAnswers = Boolean(config.projectName || config.projectType || config.approverName);
  if (hasBootstrapAnswers) {
    console.log(chalk.cyan('🧾 Persisting startup answers to config.yaml...'));
    const persistResult = persistBootstrapAnswers(configPath, config, { dryRun: config.dryRun });

    if (persistResult.changed && persistResult.applied.length > 0) {
      console.log(chalk.gray(`   Saved fields: ${persistResult.applied.join(', ')}`));
    }
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

  if (stats.merged.length > 0) {
    console.log(chalk.bold(`🔀 Files merged: ${stats.merged.length}`));
  }
  
  if (stats.skipped.length > 0 && !config.force) {
    console.log(chalk.yellow(`⚠️  Files skipped (already exist): ${stats.skipped.length}`));
    console.log(chalk.gray('   Use --conflict overwrite to overwrite existing files'));
    console.log(chalk.gray('   Use --conflict merge to merge AGENTS.md / CLAUDE.md'));
    console.log(chalk.gray('   Or use: npx jumpstart-mode upgrade (preserves user content)'));
  }

  const skipSensitiveFiles = stats.skipped
    .filter(filePath => MERGEABLE_INTEGRATION_FILES.includes(path.basename(filePath)));
  if (skipSensitiveFiles.length > 0 && (copyOptions.conflictStrategy === 'skip')) {
    console.log(chalk.yellow('\n⚠️  Integration warning: AGENTS.md / CLAUDE.md were skipped.'));
    console.log(chalk.yellow('   This may cause integration issues because required Jump Start instructions may be missing.'));
    console.log(chalk.gray('   Recommended: npx jumpstart-mode . --conflict merge'));
    persistSkipWarning(targetPath, skipSensitiveFiles.map(filePath => path.basename(filePath)), config.dryRun);
  }

  // 8. Stamp framework manifest and config baseline for future upgrades
  if (!config.dryRun) {
    try {
      const { generateManifest, writeFrameworkManifest, getPackageVersion } = await import('./lib/framework-manifest.js');
      const version = getPackageVersion(PACKAGE_ROOT);
      const manifest = generateManifest(targetPath, { version });
      writeFrameworkManifest(targetPath, manifest);
      console.log(chalk.dim(`\n📝 Framework manifest stamped (v${version}) for safe future upgrades`));

      // Save config.yaml as baseline for three-way merge on future upgrades
      const configSrc = path.join(PACKAGE_ROOT, JUMPSTART_DIR, 'config.yaml');
      const configDefaultDest = path.join(targetPath, JUMPSTART_DIR, 'config.yaml.default');
      if (fs.existsSync(configSrc)) {
        fs.copyFileSync(configSrc, configDefaultDest);
      }
    } catch (err) {
      // Non-fatal — upgrade will still work, just without a manifest
      console.log(chalk.dim('   (manifest stamping skipped — upgrade will create one automatically)'));
    }
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

    if (subcommand === 'install') {
      // ── Marketplace Item Installer ─────────────────────────────────────────
      // Supports:  jumpstart-mode install skill.ignition
      //            jumpstart-mode install skill ignition
      //            jumpstart-mode install ignition            (bare name lookup)
      //            jumpstart-mode install --search <query>
      //            jumpstart-mode install --search pptx
      const {
        install, searchItems, fetchRegistryIndex,
        normalizeItemId, detectIDE,
      } = await import('./lib/install.js');

      const registryIdx = process.argv.indexOf('--registry');
      const registryUrl = registryIdx >= 0 ? process.argv[registryIdx + 1] : undefined;
      const searchIdx = process.argv.indexOf('--search');
      const dryRun = process.argv.includes('--dry-run');
      const force = process.argv.includes('--force');

      // Handle --search before positional parsing
      if (searchIdx >= 0) {
        const query = process.argv[searchIdx + 1] || '';
        const index = await fetchRegistryIndex(registryUrl);
        const results = searchItems(index, query);
        if (results.length === 0) {
          console.log(chalk.yellow(`No items found matching "${query}".`));
        } else {
          console.log(chalk.bold(`Found ${results.length} item(s):`));
          for (const r of results) {
            console.log(`  ${chalk.green(r.id)} — ${r.displayName} [${r.category}] (${r.version})`);
            if (r.description) console.log(`    ${chalk.dim(r.description)}`);
          }
        }
        return;
      }

      // Collect positional args (skip flags and their values)
      const flagsWithValues = new Set();
      if (registryIdx >= 0) flagsWithValues.add(registryIdx + 1);
      const positional = process.argv.slice(3).filter(
        (a, i) => !a.startsWith('--') && !flagsWithValues.has(i + 3)
      );
      const first = positional[0];
      const second = positional[1];

      if (!first || first === '--help') {
        console.log(chalk.bold('Usage: jumpstart-mode install <item-id> [options]'));
        console.log(chalk.bold('       jumpstart-mode install <type> <name> [options]'));
        console.log('');
        console.log('  Install skills, agents, prompts, or bundles from the Skills marketplace.');
        console.log('');
        console.log(chalk.dim('Examples:'));
        console.log('  jumpstart-mode install skill.ignition');
        console.log('  jumpstart-mode install skill ignition');
        console.log('  jumpstart-mode install ignition');
        console.log('  jumpstart-mode install bundle.ignition-suite');
        console.log('');
        console.log(chalk.dim('Search:'));
        console.log('  jumpstart-mode install --search pptx');
        console.log('');
        console.log(chalk.dim('Options:'));
        console.log('  --registry <url>   Override registry URL');
        console.log('  --force            Re-install even if already present');
        console.log('  --dry-run          Show what would be installed');
        return;
      }

      // Normalize: "skill" "ignition" → "skill.ignition"
      const itemId = normalizeItemId(first, second);
      if (!itemId) {
        console.error(chalk.red(`Cannot resolve item from "${first}". Try: jumpstart-mode install --search ${first}`));
        process.exit(1);
      }

      try {
        const ide = detectIDE(process.cwd());
        if (dryRun) {
          console.log(chalk.dim(`[dry-run] Would install ${itemId}`));
          console.log(chalk.dim(`  IDE detected: ${ide.ide}`));
          console.log(chalk.dim(`  Agents → ${ide.agentDir}/`));
          console.log(chalk.dim(`  Prompts → ${ide.promptDir}/`));
        }

        console.log(chalk.dim(`Installing ${itemId}...`));
        const result = await install(itemId, {
          registryUrl,
          projectRoot: process.cwd(),
          force,
          dryRun,
          onProgress: (msg) => console.log(chalk.dim(msg)),
        });

        if (result.bundleId) {
          // Bundle result
          console.log(chalk.green(`\n✓ Bundle ${result.bundleId} installed:`));
          for (const r of result.installed) {
            if (r.error) {
              console.log(chalk.red(`  ✗ ${r.item.id}: ${r.error}`));
            } else {
              console.log(chalk.green(`  ✓ ${r.item.id} → ${(r.installed || []).join(', ')}`));
              if (r.remappedFiles && r.remappedFiles.length > 0) {
                console.log(chalk.dim(`    Remapped: ${r.remappedFiles.join(', ')}`));
              }
            }
          }
        } else if (result.skipped) {
          console.log(chalk.yellow(`\n↳ ${result.item.id} v${result.item.version} already installed.`));
        } else {
          console.log(chalk.green(`\n✓ ${result.item.id} v${result.item.version} installed`));
          console.log(`  Location: ${(result.installed || []).join(', ')}`);
          console.log(`  Files: ${result.fileCount}`);
          console.log(`  IDE: ${result.ide || 'unknown'}`);
          if (result.remappedFiles && result.remappedFiles.length > 0) {
            console.log(`  Remapped: ${result.remappedFiles.join(', ')}`);
          }
          if (result.dependenciesInstalled && result.dependenciesInstalled.length > 0) {
            console.log(`  Dependencies: ${result.dependenciesInstalled.join(', ')}`);
          }
        }
      } catch (err) {
        console.error(chalk.red(`Install failed: ${err.message}`));
        process.exit(1);
      }
      return;
    }

    if (subcommand === 'uninstall') {
      // ── Marketplace Item Uninstaller ───────────────────────────────────────
      const { uninstallItem, normalizeItemId } = await import('./lib/install.js');
      const first = process.argv[3];
      const second = process.argv[4];
      const itemId = normalizeItemId(first, second);

      if (!itemId || first === '--help') {
        console.log(chalk.bold('Usage: jumpstart-mode uninstall <item-id>'));
        console.log(chalk.bold('       jumpstart-mode uninstall <type> <name>'));
        console.log('');
        console.log(chalk.dim('Examples:'));
        console.log('  jumpstart-mode uninstall skill.ignition');
        console.log('  jumpstart-mode uninstall skill ignition');
        return;
      }

      try {
        const result = uninstallItem(itemId, process.cwd());
        console.log(chalk.green(`✓ Uninstalled ${itemId}`));
        if (result.removed.length > 0) {
          console.log(`  Removed: ${result.removed.join(', ')}`);
        }
      } catch (err) {
        console.error(chalk.red(`Uninstall failed: ${err.message}`));
        process.exit(1);
      }
      return;
    }

    if (subcommand === 'status') {
      // ── Installed Items Status ─────────────────────────────────────────────
      const { getStatus } = await import('./lib/install.js');
      const status = getStatus(process.cwd());

      if (status.count === 0) {
        console.log(chalk.yellow('No marketplace items installed.'));
        console.log(chalk.dim('Install with: jumpstart-mode install skill ignition'));
        return;
      }

      console.log(chalk.bold(`${status.count} marketplace item(s) installed:\n`));
      for (const [id, entry] of Object.entries(status.items)) {
        const typeColor = entry.type === 'skill' ? chalk.cyan
          : entry.type === 'agent' ? chalk.magenta
          : entry.type === 'prompt' ? chalk.blue
          : chalk.white;
        console.log(`  ${typeColor(entry.type.padEnd(6))} ${chalk.green(id)} v${entry.version}`);
        console.log(`         ${chalk.dim('Installed: ' + entry.installedAt)}`);
        if (entry.remappedFiles && entry.remappedFiles.length > 0) {
          console.log(`         ${chalk.dim('Remapped:  ' + entry.remappedFiles.join(', '))}`);
        }
      }
      return;
    }

    if (subcommand === 'integrate') {
      // ── Skill Integration Manager ──────────────────────────────────────────
      const { applyIntegration, cleanIntegration, readIntegrationLog } = await import('./lib/integrate.js');
      const root = process.cwd();
      const isClean = process.argv.includes('--clean');
      const isStatus = process.argv.includes('--status');
      const isHelp = process.argv.includes('--help');

      if (isHelp) {
        console.log(chalk.bold('Usage: jumpstart-mode integrate [--clean | --status]'));
        console.log('');
        console.log('  Rebuild skill integration files from installed skills.');
        console.log('  Generates IDE instructions and framework skill index so');
        console.log('  all Jump Start agents are aware of installed skills.');
        console.log('');
        console.log('  Options:');
        console.log('    --clean   Remove all integration files.');
        console.log('    --status  Show current integration state.');
        return;
      }

      if (isStatus) {
        const log = readIntegrationLog(root);
        const fileCount = Object.keys(log.files || {}).length;
        const skillCount = Object.keys(log.skillContributions || {}).length;
        if (fileCount === 0) {
          console.log(chalk.yellow('No integration files generated.'));
          console.log(chalk.dim('Run: jumpstart-mode integrate'));
          return;
        }
        console.log(chalk.bold(`Integration state (${log.generatedAt}):\n`));
        console.log(chalk.cyan(`  Skills integrated: ${skillCount}`));
        console.log(chalk.cyan(`  Files generated:   ${fileCount}`));
        for (const [fp, meta] of Object.entries(log.files)) {
          console.log(`    ${chalk.green(fp)} ${chalk.dim(meta.hash.slice(0, 18) + '...')}`);
        }
        return;
      }

      try {
        if (isClean) {
          const { filesRemoved } = cleanIntegration(root, { onProgress: (m) => console.log(m) });
          console.log(chalk.green(`✓ Clean complete: removed ${filesRemoved.length} file(s).`));
        } else {
          const { filesWritten, filesRemoved, skillCount } = applyIntegration(root, { onProgress: (m) => console.log(m) });
          console.log(chalk.green(`✓ Integration rebuilt: ${skillCount} skill(s), ${filesWritten.length} file(s) generated.`));
          if (filesRemoved.length > 0) {
            console.log(chalk.dim(`  Removed ${filesRemoved.length} stale file(s).`));
          }
        }
      } catch (err) {
        console.error(chalk.red(`Integration failed: ${err.message}`));
        process.exit(1);
      }
      return;
    }

    if (subcommand === 'update') {
      // ── Update Installed Items ─────────────────────────────────────────────
      const { updateItems, fetchRegistryIndex, checkUpdates, normalizeItemId } = await import('./lib/install.js');

      const registryIdx = process.argv.indexOf('--registry');
      const registryUrl = registryIdx >= 0 ? process.argv[registryIdx + 1] : undefined;
      const first = process.argv[3];
      const second = process.argv[4];
      const itemId = (first && first !== '--help' && !first.startsWith('--'))
        ? normalizeItemId(first, second)
        : null;

      if (first === '--help') {
        console.log(chalk.bold('Usage: jumpstart-mode update [<item-id>]'));
        console.log('');
        console.log('  Update installed marketplace items to the latest registry version.');
        console.log('  Omit <item-id> to check/update all items.');
        return;
      }

      try {
        const index = await fetchRegistryIndex(registryUrl);
        const { updates, upToDate } = checkUpdates(process.cwd(), index);

        if (updates.length === 0) {
          console.log(chalk.green('✓ All installed items are up to date.'));
          return;
        }

        console.log(chalk.bold(`${updates.length} update(s) available:`));
        for (const u of updates) {
          console.log(`  ${chalk.yellow(u.id)}: ${u.localVersion} → ${chalk.green(u.registryVersion)}`);
        }

        const results = await updateItems(itemId, {
          registryUrl,
          projectRoot: process.cwd(),
          index,
          onProgress: (msg) => console.log(chalk.dim(msg)),
        });

        console.log(chalk.green(`\n✓ Updated ${results.length} item(s).`));
      } catch (err) {
        console.error(chalk.red(`Update failed: ${err.message}`));
        process.exit(1);
      }
      return;
    }

    if (subcommand === 'upgrade') {
      // ── Safe Framework Upgrade ───────────────────────────────────────────
      const { upgrade, restore, listUpgradeBackups } = await import('./lib/upgrade.js');

      const dryRun = process.argv.includes('--dry-run');
      const yes = process.argv.includes('--yes') || process.argv.includes('-y');
      const doRestore = process.argv.includes('--restore');

      if (process.argv.includes('--help')) {
        console.log(chalk.bold('Usage: jumpstart-mode upgrade [options]'));
        console.log('');
        console.log('  Safely upgrade framework files while preserving user content.');
        console.log('  User customizations to config.yaml, state, specs, and custom');
        console.log('  agents/skills are preserved. Modified framework files are backed');
        console.log('  up to .jumpstart/archive/ before overwriting.');
        console.log('');
        console.log(chalk.bold('Options:'));
        console.log('  --dry-run    Preview changes without writing files');
        console.log('  --yes, -y    Skip confirmation prompt');
        console.log('  --restore    Restore files from upgrade backups');
        console.log('  --help       Show this help');
        return;
      }

      if (doRestore) {
        // Restore from backup
        const backups = listUpgradeBackups(process.cwd());
        if (backups.length === 0) {
          console.log(chalk.yellow('No upgrade backups found.'));
          return;
        }

        console.log(chalk.bold(`\nUpgrade backups (${backups.length} file(s)):\n`));
        for (const b of backups) {
          console.log(`  ${chalk.cyan(b.originalPath)}`);
          console.log(`    Archived: ${chalk.dim(b.archivedAt)}`);
          console.log(`    Upgrade: ${b.fromVersion} → ${b.toVersion}`);
          console.log(`    File: ${chalk.dim(b.file)}`);
          console.log('');
        }

        if (!dryRun) {
          const prompts = require('prompts');
          const { confirmed } = await prompts({
            type: 'confirm',
            name: 'confirmed',
            message: `Restore all ${backups.length} backed-up file(s)?`,
            initial: false,
          });

          if (!confirmed) {
            console.log(chalk.yellow('\n❌ Restore cancelled.\n'));
            return;
          }
        }

        const result = restore(process.cwd(), { dryRun });
        if (!result.success) {
          console.error(chalk.red(`Restore failed: ${result.message || 'Unknown error'}`));
          process.exit(1);
        }
        return;
      }

      // Normal upgrade
      try {
        const confirmFn = yes ? null : async (msg) => {
          const prompts = require('prompts');
          const { confirmed } = await prompts({
            type: 'confirm',
            name: 'confirmed',
            message: msg,
            initial: true,
          });
          return confirmed;
        };

        const result = await upgrade(process.cwd(), {
          packageRoot: PACKAGE_ROOT,
          dryRun,
          yes,
          confirm: confirmFn,
        });

        if (!result.success) {
          if (result.message !== 'Cancelled by user.') {
            console.error(chalk.red(result.message));
            process.exit(1);
          }
        }
      } catch (err) {
        console.error(chalk.red(`Upgrade failed: ${err.message}`));
        process.exit(1);
      }
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

    if (subcommand === 'timeline') {
      // Interaction Timeline (Timeline Protocol)
      const timeline = await import('./lib/timeline.js');
      const io = require('./lib/io');
      const argv = process.argv.slice(3);
      const formatIdx = argv.indexOf('--format');
      const format = formatIdx !== -1 ? argv[formatIdx + 1] : 'markdown';
      const phaseIdx = argv.indexOf('--phase');
      const phaseFilter = phaseIdx !== -1 ? argv[phaseIdx + 1] : null;
      const agentIdx = argv.indexOf('--agent');
      const agentFilter = agentIdx !== -1 ? argv[agentIdx + 1] : null;
      const typeIdx = argv.indexOf('--type');
      const typeFilter = typeIdx !== -1 ? argv[typeIdx + 1] : null;
      const sessionIdx = argv.indexOf('--session');
      const sessionFilter = sessionIdx !== -1 ? argv[sessionIdx + 1] : null;
      const fromIdx = argv.indexOf('--from');
      const fromFilter = fromIdx !== -1 ? argv[fromIdx + 1] : null;
      const toIdx = argv.indexOf('--to');
      const toFilter = toIdx !== -1 ? argv[toIdx + 1] : null;
      const jsonMode = argv.includes('--json');
      const doClear = argv.includes('--clear');
      const eventsFile = path.join(process.cwd(), '.jumpstart', 'state', 'timeline.json');

      if (doClear) {
        const result = timeline.clearTimeline(eventsFile, { archive: true });
        console.log(chalk.green('✓ Timeline cleared.'), result.archived_to ? `Archived to ${result.archived_to}` : '');
        return;
      }

      // Build filters
      const filters = {};
      if (phaseFilter) filters.phase = phaseFilter;
      if (agentFilter) filters.agent = agentFilter;
      if (typeFilter) filters.event_type = typeFilter;
      if (sessionFilter) filters.session_id = sessionFilter;
      if (fromFilter) filters.from = fromFilter;
      if (toFilter) filters.to = toFilter;

      const hasFilters = Object.keys(filters).length > 0;

      if (hasFilters) {
        // Query mode
        const events = timeline.queryTimeline(eventsFile, filters);
        if (jsonMode) {
          io.writeResult(events);
        } else {
          console.log(timeline.renderMarkdown(events));
        }
        return;
      }

      // Summary or report mode
      const action = argv[0] || 'summary';
      if (action === 'summary' || (!['report', 'export'].includes(action) && !hasFilters)) {
        const summary = timeline.getTimelineSummary(eventsFile);
        if (jsonMode) {
          io.writeResult(summary);
        } else {
          console.log(chalk.bold.blue('\n📊 Timeline Summary\n'));
          console.log(`  Session: ${summary.session_id || 'N/A'}`);
          console.log(`  Events:  ${summary.total_events}`);
          if (summary.started_at) console.log(`  Started: ${summary.started_at}`);
          if (summary.duration_s) console.log(`  Duration: ${Math.round(summary.duration_s)}s`);
          if (summary.by_type && Object.keys(summary.by_type).length > 0) {
            console.log(chalk.bold('\n  Events by Type:'));
            for (const [t, c] of Object.entries(summary.by_type)) {
              console.log(`    ${t}: ${c}`);
            }
          }
          if (summary.by_phase && Object.keys(summary.by_phase).length > 0) {
            console.log(chalk.bold('\n  Events by Phase:'));
            for (const [p, c] of Object.entries(summary.by_phase)) {
              console.log(`    ${p}: ${c}`);
            }
          }
          console.log();
        }
        return;
      }

      // Report / export
      const result = timeline.generateTimelineReport(eventsFile, { format });
      if (jsonMode && format !== 'json') {
        io.writeResult({ format, content: result });
      } else {
        console.log(result);
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
      const { detectCurrentArtifact, approveArtifact, renderApprovalResult } = require('./lib/approve.js');
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
      const { detectCurrentArtifact, rejectArtifact, renderRejectionResult } = require('./lib/approve.js');
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

    // ── Feature 1: Multi-Repo Program Orchestration ─────────────────────────
    if (subcommand === 'multi-repo') {
      const multiRepo = require('./lib/multi-repo');
      const action = process.argv[3] || 'status';
      const jsonMode = process.argv.includes('--json');
      const io = require('./lib/io');

      if (action === 'init') {
        const name = process.argv[4];
        if (!name) {
          console.error(chalk.red('Usage: jumpstart-mode multi-repo init <program-name>'));
          process.exit(1);
        }
        const result = multiRepo.initProgram(name, { stateFile: path.join(process.cwd(), '.jumpstart', 'state', 'multi-repo.json') });
        if (jsonMode) { io.writeResult(result); } else {
          console.log(result.success ? chalk.green(`✅ ${result.message}`) : chalk.red(`❌ ${result.error}`));
        }
      } else if (action === 'link') {
        const repoUrl = process.argv[4];
        const role = process.argv[5] || 'other';
        if (!repoUrl) {
          console.error(chalk.red('Usage: jumpstart-mode multi-repo link <repo-url> [role]'));
          process.exit(1);
        }
        const result = multiRepo.linkRepo(repoUrl, role, { stateFile: path.join(process.cwd(), '.jumpstart', 'state', 'multi-repo.json') });
        if (jsonMode) { io.writeResult(result); } else {
          console.log(result.success ? chalk.green(`✅ Repo linked: ${repoUrl} (${role})`) : chalk.red(`❌ ${result.error}`));
        }
      } else if (action === 'plan') {
        const result = multiRepo.getProgramStatus({ stateFile: path.join(process.cwd(), '.jumpstart', 'state', 'multi-repo.json') });
        if (jsonMode) { io.writeResult(result); } else {
          console.log(chalk.bold(`\n📦 Program: ${result.program_name || '(not initialized)'}`));
          console.log(`  Repos: ${result.repo_count}  Shared specs: ${result.shared_spec_count}  Dependencies: ${result.dependency_count}`);
          if (result.release_plan && result.release_plan.milestones.length > 0) {
            console.log(`  Milestones: ${result.release_plan.milestones.map(m => m.name).join(', ')}`);
          }
          console.log('');
        }
      } else {
        // status (default)
        const result = multiRepo.getProgramStatus({ stateFile: path.join(process.cwd(), '.jumpstart', 'state', 'multi-repo.json') });
        if (jsonMode) { io.writeResult(result); } else {
          console.log(chalk.bold(`\n🗂  Multi-Repo Program Status`));
          console.log(`  Program: ${result.program_name || '(not initialized)'}`);
          console.log(`  Repos: ${result.repo_count}`);
          if (result.repo_count > 0) {
            for (const repo of result.repos) {
              console.log(`    • [${repo.role}] ${repo.url}`);
            }
          }
          console.log(`  Shared specs: ${result.shared_spec_count}`);
          console.log(`  Cross-repo deps: ${result.dependency_count}`);
          console.log('');
        }
      }
      return;
    }

    // ── Feature 2: Bidirectional Code-to-Spec Traceability ──────────────────
    if (subcommand === 'bidirectional-trace') {
      const btrace = require('./lib/bidirectional-trace');
      const action = process.argv[3] || 'scan';
      const jsonMode = process.argv.includes('--json');
      const io = require('./lib/io');

      if (action === 'scan' || action === 'report') {
        const traceMap = btrace.scanTraceLinks(process.cwd());
        if (action === 'report') {
          const report = btrace.buildCoverageReport(process.cwd(), traceMap);
          if (jsonMode) { io.writeResult(report); } else {
            console.log(chalk.bold('\n🔗 Bidirectional Traceability Report'));
            console.log(`  Spec IDs: ${report.total_spec_ids}  Covered: ${report.covered}  Gaps: ${report.gaps}  Coverage: ${report.coverage_pct}%`);
            if (report.gap_list.length > 0) {
              console.log(chalk.yellow('\n  Unlinked spec IDs:'));
              for (const id of report.gap_list) console.log(`    • ${id}`);
            }
            console.log('');
          }
        } else {
          if (jsonMode) { io.writeResult(traceMap); } else {
            console.log(chalk.bold('\n🔗 Trace Scan Complete'));
            console.log(`  Spec IDs found: ${traceMap.stats.total_spec_ids}`);
            console.log(`  Files with links: ${traceMap.stats.total_files_with_links}`);
            console.log(`  Total links: ${traceMap.stats.total_links}`);
            console.log('');
          }
        }
      } else {
        console.error(chalk.red('Usage: jumpstart-mode bidirectional-trace [scan|report] [--json]'));
        process.exit(1);
      }
      return;
    }

    // ── Feature 3: Agentic Change Impact Analysis ────────────────────────────
    if (subcommand === 'impact') {
      const { analyzeImpact, renderImpactReport } = require('./lib/impact-analysis');
      const fileArg = process.argv[3];
      const symbolIdx = process.argv.indexOf('--symbol');
      const specIdIdx = process.argv.indexOf('--spec');
      const jsonMode = process.argv.includes('--json');
      const io = require('./lib/io');

      const target = {};
      if (fileArg && !fileArg.startsWith('--')) target.file = fileArg;
      if (symbolIdx !== -1) target.symbol = process.argv[symbolIdx + 1];
      if (specIdIdx !== -1) target.specId = process.argv[specIdIdx + 1];

      if (!target.file && !target.symbol && !target.specId) {
        console.error(chalk.red('Usage: jumpstart-mode impact <file> [--symbol <name>] [--spec <id>] [--json]'));
        process.exit(1);
      }

      const result = analyzeImpact(process.cwd(), target);
      if (jsonMode) { io.writeResult(result); } else {
        console.log(renderImpactReport(result));
      }
      return;
    }

    // ── Feature 4: Automated Repo Understanding Graph ───────────────────────
    if (subcommand === 'repo-graph') {
      const repoGraphLib = require('./lib/repo-graph');
      const action = process.argv[3] || 'build';
      const jsonMode = process.argv.includes('--json');
      const io = require('./lib/io');
      const graphFile = path.join(process.cwd(), '.jumpstart', 'state', 'repo-graph.json');

      if (action === 'build') {
        const result = repoGraphLib.buildRepoGraph(process.cwd(), { graphFile });
        if (jsonMode) { io.writeResult(result); } else {
          console.log(chalk.green(`✅ Repo graph built: ${result.node_count} nodes, ${result.edge_count} edges`));
          console.log(chalk.gray(`   Saved to: ${result.graph_file}`));
        }
      } else if (action === 'query') {
        const graph = repoGraphLib.loadRepoGraph(graphFile);
        const typeArg = process.argv.indexOf('--type') !== -1 ? process.argv[process.argv.indexOf('--type') + 1] : null;
        const nameArg = process.argv.indexOf('--name') !== -1 ? process.argv[process.argv.indexOf('--name') + 1] : null;
        const results = repoGraphLib.queryGraph(graph, { type: typeArg, nameContains: nameArg });
        if (jsonMode) { io.writeResult(results); } else {
          console.log(chalk.bold(`\n🗺  Repo Graph Query (${results.length} nodes)`));
          for (const n of results) console.log(`  [${n.type}] ${n.id} — ${n.name || ''}`);
          console.log('');
        }
      } else {
        console.error(chalk.red('Usage: jumpstart-mode repo-graph [build|query] [--type <type>] [--name <name>] [--json]'));
        process.exit(1);
      }
      return;
    }

    // ── Feature 5: Persistent Long-Term Project Memory ──────────────────────
    if (subcommand === 'memory') {
      const memLib = require('./lib/project-memory');
      const action = process.argv[3] || 'list';
      const jsonMode = process.argv.includes('--json');
      const io = require('./lib/io');
      const memFile = path.join(process.cwd(), '.jumpstart', 'state', 'project-memory.json');

      if (action === 'add') {
        const typeArg = process.argv.indexOf('--type') !== -1 ? process.argv[process.argv.indexOf('--type') + 1] : 'insight';
        const titleIdx = process.argv.indexOf('--title');
        const contentIdx = process.argv.indexOf('--content');
        if (titleIdx === -1 || contentIdx === -1) {
          console.error(chalk.red('Usage: jumpstart-mode memory add --type <type> --title <title> --content <content>'));
          process.exit(1);
        }
        const result = memLib.addMemory({
          type: typeArg,
          title: process.argv[titleIdx + 1],
          content: process.argv[contentIdx + 1]
        }, { memoryFile: memFile });
        if (jsonMode) { io.writeResult(result); } else {
          console.log(result.success ? chalk.green(`✅ Memory added: ${result.entry.id}`) : chalk.red(`❌ ${result.error}`));
        }
      } else if (action === 'search') {
        const keyword = process.argv[4];
        if (!keyword) { console.error(chalk.red('Usage: jumpstart-mode memory search <keyword>')); process.exit(1); }
        const result = memLib.searchMemories(keyword, { memoryFile: memFile });
        if (jsonMode) { io.writeResult(result); } else {
          console.log(chalk.bold(`\n🧠 Memory Search: "${keyword}" (${result.total} results)`));
          for (const e of result.entries) console.log(`  [${e.type}] ${e.title} — ${e.id}`);
          console.log('');
        }
      } else if (action === 'recall') {
        const id = process.argv[4];
        if (!id) { console.error(chalk.red('Usage: jumpstart-mode memory recall <id>')); process.exit(1); }
        const result = memLib.recallMemory(id, { memoryFile: memFile });
        if (jsonMode) { io.writeResult(result); } else {
          if (result.success) {
            console.log(chalk.bold(`\n🧠 ${result.entry.title}`));
            console.log(chalk.gray(`Type: ${result.entry.type}  |  Created: ${result.entry.created_at}`));
            console.log('');
            console.log(result.entry.content);
            console.log('');
          } else { console.error(chalk.red(`❌ ${result.error}`)); }
        }
      } else {
        // list (default)
        const typeFilter = process.argv.indexOf('--type') !== -1 ? process.argv[process.argv.indexOf('--type') + 1] : undefined;
        const result = memLib.listMemories(typeFilter ? { type: typeFilter } : {}, { memoryFile: memFile });
        if (jsonMode) { io.writeResult(result); } else {
          console.log(chalk.bold(`\n🧠 Project Memory (${result.total} entries)`));
          for (const e of result.entries) console.log(`  [${e.type}] ${e.title} — ${e.id}`);
          console.log('');
        }
      }
      return;
    }

    // ── Feature 6: Enterprise Policy Engine ────────────────────────────────
    if (subcommand === 'policy') {
      const policyLib = require('./lib/policy-engine');
      const action = process.argv[3] || 'check';
      const jsonMode = process.argv.includes('--json');
      const io = require('./lib/io');
      const policyFile = path.join(process.cwd(), '.jumpstart', 'policies.json');

      if (action === 'check') {
        const result = policyLib.checkPolicies(process.cwd(), { policyFile });
        if (jsonMode) { io.writeResult(result); } else {
          const icon = result.summary.passed ? '✅' : '❌';
          console.log(chalk.bold(`\n${icon} Policy Check: ${result.summary.passed ? 'PASSED' : 'FAILED'}`));
          console.log(`  Policies checked: ${result.summary.total_policies_checked}`);
          console.log(`  Violations: ${result.summary.violations}  Warnings: ${result.summary.warnings}`);
          if (result.violations.length > 0) {
            console.log(chalk.red('\n  Violations:'));
            for (const v of result.violations) console.log(`    ❌ [${v.category}] ${v.file}: ${v.policy_name}`);
          }
          if (result.warnings.length > 0) {
            console.log(chalk.yellow('\n  Warnings:'));
            for (const w of result.warnings) console.log(`    ⚠ [${w.category}] ${w.file}: ${w.policy_name}`);
          }
          console.log('');
        }
      } else if (action === 'list') {
        const result = policyLib.listPolicies({}, { policyFile });
        if (jsonMode) { io.writeResult(result); } else {
          console.log(chalk.bold(`\n📋 Policies (${result.total})`));
          for (const p of result.policies) console.log(`  [${p.category}/${p.severity}] ${p.name} — ${p.id}`);
          console.log('');
        }
      } else if (action === 'add') {
        const nameIdx = process.argv.indexOf('--name');
        const descIdx = process.argv.indexOf('--desc');
        const catIdx = process.argv.indexOf('--category');
        if (nameIdx === -1 || descIdx === -1) {
          console.error(chalk.red('Usage: jumpstart-mode policy add --name <name> --desc <desc> [--category <cat>] [--severity <sev>]'));
          process.exit(1);
        }
        const sevIdx = process.argv.indexOf('--severity');
        const patIdx = process.argv.indexOf('--pattern');
        const result = policyLib.addPolicy({
          name: process.argv[nameIdx + 1],
          description: process.argv[descIdx + 1],
          category: catIdx !== -1 ? process.argv[catIdx + 1] : 'other',
          severity: sevIdx !== -1 ? process.argv[sevIdx + 1] : 'warning',
          pattern: patIdx !== -1 ? process.argv[patIdx + 1] : null
        }, { policyFile });
        if (jsonMode) { io.writeResult(result); } else {
          console.log(result.success ? chalk.green(`✅ Policy added: ${result.policy.id}`) : chalk.red(`❌ ${result.error}`));
        }
      } else {
        console.error(chalk.red('Usage: jumpstart-mode policy [check|list|add] [options]'));
        process.exit(1);
      }
      return;
    }

    // ── Feature 7: Branch-Aware Workflow Engine ─────────────────────────────
    if (subcommand === 'branch-workflow') {
      const branchLib = require('./lib/branch-workflow');
      const action = process.argv[3] || 'status';
      const jsonMode = process.argv.includes('--json');
      const io = require('./lib/io');

      if (action === 'track') {
        const prNumIdx = process.argv.indexOf('--pr');
        const result = branchLib.trackBranch(process.cwd(), {
          pr_number: prNumIdx !== -1 ? parseInt(process.argv[prNumIdx + 1]) : undefined
        });
        if (jsonMode) { io.writeResult(result); } else {
          console.log(result.success ? chalk.green(`✅ Branch tracked: ${result.branch.branch}`) : chalk.red(`❌ ${result.error}`));
        }
      } else if (action === 'status') {
        const branchArg = process.argv[4];
        const result = branchLib.getBranchStatus(process.cwd(), { branch: branchArg });
        if (jsonMode) { io.writeResult(result); } else {
          if (result.tracked) {
            console.log(chalk.bold(`\n🌿 Branch: ${result.branch}`));
            console.log(`  Phases recorded: ${result.phase_count}  Approvals: ${result.approved_count}`);
            if (result.data.pr_number) console.log(`  PR #${result.data.pr_number}`);
          } else {
            console.log(chalk.yellow(`\n⚠  ${result.message}`));
          }
          console.log('');
        }
      } else if (action === 'sync') {
        const result = branchLib.listTrackedBranches();
        if (jsonMode) { io.writeResult(result); } else {
          console.log(chalk.bold(`\n🌿 Tracked Branches (${result.total})`));
          for (const b of result.branches) console.log(`  ${b.branch}  phases=${b.phase_snapshots ? b.phase_snapshots.length : 0}  PR=${b.pr_number || '-'}`);
          console.log('');
        }
      } else {
        console.error(chalk.red('Usage: jumpstart-mode branch-workflow [track|status|sync] [--pr <number>] [--json]'));
        process.exit(1);
      }
      return;
    }

    // ── Feature 8: PR-Native Execution Mode ────────────────────────────────
    if (subcommand === 'pr-package') {
      const prLib = require('./lib/pr-package');
      const action = process.argv[3] || 'list';
      const jsonMode = process.argv.includes('--json');
      const io = require('./lib/io');

      if (action === 'create') {
        const titleIdx = process.argv.indexOf('--title');
        const summaryIdx = process.argv.indexOf('--summary');
        const rollbackIdx = process.argv.indexOf('--rollback');
        const riskIdx = process.argv.indexOf('--risk');
        if (titleIdx === -1 || summaryIdx === -1) {
          console.error(chalk.red('Usage: jumpstart-mode pr-package create --title <title> --summary <summary> [--risk <note>] [--rollback <steps>]'));
          process.exit(1);
        }
        const result = prLib.createPRPackage({
          title: process.argv[titleIdx + 1],
          summary: process.argv[summaryIdx + 1],
          risk_notes: riskIdx !== -1 ? [process.argv[riskIdx + 1]] : [],
          rollback: rollbackIdx !== -1 ? process.argv[rollbackIdx + 1] : undefined
        }, process.cwd());
        if (jsonMode) { io.writeResult(result); } else {
          console.log(result.success ? chalk.green(`✅ PR package created: ${result.id}`) : chalk.red(`❌ ${result.error}`));
          if (result.success) console.log(chalk.gray(`   Saved to: ${result.output_file}`));
        }
      } else if (action === 'export') {
        const packageId = process.argv[4];
        if (!packageId) { console.error(chalk.red('Usage: jumpstart-mode pr-package export <id>')); process.exit(1); }
        const result = prLib.exportPRPackage(packageId, process.cwd());
        if (jsonMode) { io.writeResult(result); } else {
          if (result.success) { console.log(result.content); } else { console.error(chalk.red(`❌ ${result.error}`)); }
        }
      } else {
        // list (default)
        const result = prLib.listPRPackages(process.cwd());
        if (jsonMode) { io.writeResult(result); } else {
          console.log(chalk.bold(`\n📦 PR Packages (${result.total})`));
          for (const p of result.packages) console.log(`  ${p.id}  ${p.created_at.split('T')[0]}  ${p.file}`);
          console.log('');
        }
      }
      return;
    }

    // ── Feature 9: Multi-Agent Concurrent Execution ─────────────────────────
    if (subcommand === 'parallel-agents') {
      const parallelLib = require('./lib/parallel-agents');
      const action = process.argv[3] || 'status';
      const jsonMode = process.argv.includes('--json');
      const io = require('./lib/io');
      const stateFile = path.join(process.cwd(), '.jumpstart', 'state', 'parallel-agents.json');

      if (action === 'run') {
        const agentsArg = process.argv[4];
        const agents = agentsArg ? agentsArg.split(',') : [];
        const result = parallelLib.scheduleRun(agents, { root: process.cwd() }, { stateFile });
        if (jsonMode) { io.writeResult(result); } else {
          console.log(result.success ? chalk.green(`✅ Run scheduled: ${result.run_id}`) : chalk.red(`❌ ${result.error}`));
          if (result.success) console.log(chalk.gray(`   Agents: ${result.agents.join(', ')}`));
        }
      } else if (action === 'reconcile') {
        const runId = process.argv[4];
        if (!runId) { console.error(chalk.red('Usage: jumpstart-mode parallel-agents reconcile <run-id>')); process.exit(1); }
        const result = parallelLib.reconcileRun(runId, { stateFile });
        if (jsonMode) { io.writeResult(result); } else {
          if (result.success) {
            console.log(chalk.bold(`\n🔀 Reconciliation: ${runId}`));
            console.log(`  Total findings: ${result.reconciliation.total_findings}`);
            console.log(`  Conflicts: ${result.reconciliation.conflicts}`);
          } else { console.error(chalk.red(`❌ ${result.error}`)); }
          console.log('');
        }
      } else {
        // status (default) / list
        const runs = parallelLib.listRuns({ stateFile });
        if (jsonMode) { io.writeResult(runs); } else {
          console.log(chalk.bold(`\n🤖 Parallel Agent Runs (${runs.total})`));
          for (const r of runs.runs) console.log(`  ${r.id}  [${r.status}]  agents=${r.agent_count}  ${r.scheduled_at.split('T')[0]}`);
          console.log('');
        }
      }
      return;
    }

    // ── Feature 10: Human Approval Workflows with Roles ─────────────────────
    if (subcommand === 'role-approval') {
      const roleLib = require('./lib/role-approval');
      const action = process.argv[3] || 'status';
      const jsonMode = process.argv.includes('--json');
      const io = require('./lib/io');
      const stateFile = path.join(process.cwd(), '.jumpstart', 'state', 'role-approvals.json');

      if (action === 'assign') {
        const artifactArg = process.argv[4];
        const rolesArg = process.argv[5];
        if (!artifactArg || !rolesArg) {
          console.error(chalk.red('Usage: jumpstart-mode role-approval assign <artifact> <role1,role2,...>'));
          process.exit(1);
        }
        const roles = rolesArg.split(',').map(r => ({ role: r.trim(), required: true }));
        const result = roleLib.assignApprovers(artifactArg, roles, { stateFile });
        if (jsonMode) { io.writeResult(result); } else {
          console.log(result.success ? chalk.green(`✅ Approvers assigned to ${result.artifact}`) : chalk.red(`❌ ${result.error}`));
          if (result.success) console.log(chalk.gray(`   Roles: ${result.approvers.map(a => a.role).join(', ')}`));
        }
      } else if (action === 'approve') {
        const artifactArg = process.argv[4];
        const roleArg = process.argv[5];
        if (!artifactArg || !roleArg) {
          console.error(chalk.red('Usage: jumpstart-mode role-approval approve <artifact> <role> [--approver <name>]'));
          process.exit(1);
        }
        const nameIdx = process.argv.indexOf('--approver');
        const result = roleLib.recordRoleAction(artifactArg, roleArg, 'approve', {
          stateFile,
          approverName: nameIdx !== -1 ? process.argv[nameIdx + 1] : undefined
        });
        if (jsonMode) { io.writeResult(result); } else {
          console.log(result.success ? chalk.green(`✅ Approved [${roleArg}]: ${artifactArg}  Status: ${result.workflow_status}`) : chalk.red(`❌ ${result.error}`));
          if (result.success && result.pending_roles.length > 0) console.log(chalk.gray(`   Pending: ${result.pending_roles.join(', ')}`));
        }
      } else if (action === 'reject') {
        const artifactArg = process.argv[4];
        const roleArg = process.argv[5];
        if (!artifactArg || !roleArg) {
          console.error(chalk.red('Usage: jumpstart-mode role-approval reject <artifact> <role>'));
          process.exit(1);
        }
        const result = roleLib.recordRoleAction(artifactArg, roleArg, 'reject', { stateFile });
        if (jsonMode) { io.writeResult(result); } else {
          console.log(result.success ? chalk.yellow(`🚫 Rejected [${roleArg}]: ${artifactArg}`) : chalk.red(`❌ ${result.error}`));
        }
      } else {
        // status (default)
        const artifactArg = process.argv[4];
        if (artifactArg) {
          const result = roleLib.getApprovalStatus(artifactArg, { stateFile });
          if (jsonMode) { io.writeResult(result); } else {
            if (result.has_workflow) {
              const icon = result.fully_approved ? '✅' : '⏳';
              console.log(chalk.bold(`\n${icon} Approval Status: ${artifactArg}`));
              console.log(`  Status: ${result.status}`);
              if (result.pending_roles.length > 0) console.log(`  Pending: ${result.pending_roles.join(', ')}`);
              if (result.approved_roles.length > 0) console.log(`  Approved: ${result.approved_roles.join(', ')}`);
            } else {
              console.log(chalk.gray(`\n  ${result.message}`));
            }
            console.log('');
          }
        } else {
          const result = roleLib.listApprovalWorkflows({}, { stateFile });
          if (jsonMode) { io.writeResult(result); } else {
            console.log(chalk.bold(`\n👥 Approval Workflows (${result.total})`));
            for (const w of result.workflows) console.log(`  [${w.status}] ${w.artifact}  roles=${w.approvers.length}`);
            console.log('');
          }
        }
      }
      return;
    }

    // ── Feature 11: Requirements Baseline & Change Control ────────────────
    if (subcommand === 'requirements-baseline') {
      const baselineLib = require('./lib/requirements-baseline');
      const action = process.argv[3] || 'status';
      const jsonMode = process.argv.includes('--json');
      const io = require('./lib/io');
      const root = process.cwd();

      if (action === 'freeze') {
        const result = baselineLib.freezeBaseline(root, {
          approver: process.argv.includes('--approver') ? process.argv[process.argv.indexOf('--approver') + 1] : undefined
        });
        if (jsonMode) { io.writeResult(result); } else {
          if (result.success) {
            console.log(chalk.green(`\n🔒 Requirements baseline frozen`));
            console.log(`  Baseline ID: ${result.baseline_id}`);
            console.log(`  Artifacts frozen: ${result.artifacts_frozen}`);
            console.log(`  Total requirements: ${result.total_requirements}`);
            for (const s of result.snapshots) console.log(`    ${s.type}: ${s.requirements} requirements`);
          } else { console.error(chalk.red(`❌ ${result.error}`)); }
          console.log('');
        }
      } else if (action === 'check') {
        const result = baselineLib.checkBaseline(root);
        if (jsonMode) { io.writeResult(result); } else {
          if (result.frozen) {
            const icon = result.drifted ? '⚠️' : '✅';
            console.log(chalk.bold(`\n${icon} Baseline Check`));
            console.log(`  Baseline: ${result.baseline_id}`);
            console.log(`  Changed: ${result.summary.changed}  Unchanged: ${result.summary.unchanged}`);
            for (const c of result.changes) console.log(`  ${c.severity === 'critical' ? '🔴' : '🟡'} ${c.path}: ${c.change}`);
          } else { console.log(chalk.gray('\n  No frozen baseline found')); }
          console.log('');
        }
      } else if (action === 'impact') {
        const artifactPath = process.argv[4];
        if (!artifactPath) { console.error(chalk.red('Usage: jumpstart-mode requirements-baseline impact <artifact-path>')); process.exit(1); }
        const result = baselineLib.assessImpact(artifactPath, root);
        if (jsonMode) { io.writeResult(result); } else {
          console.log(chalk.bold(`\n📊 Impact Assessment: ${result.artifact || artifactPath}`));
          console.log(`  Impact level: ${result.impact}`);
          if (result.assessment) {
            console.log(`  Change type: ${result.assessment.change_type}`);
            if (result.assessment.requires_re_approval) console.log(chalk.yellow('  ⚠️  Requires re-approval'));
          }
          console.log('');
        }
      } else {
        const result = baselineLib.getBaselineStatus();
        if (jsonMode) { io.writeResult(result); } else {
          console.log(chalk.bold('\n📋 Requirements Baseline Status'));
          console.log(`  Frozen: ${result.frozen ? 'Yes' : 'No'}`);
          console.log(`  Baselines: ${result.total_baselines}`);
          console.log(`  Pending change requests: ${result.pending_change_requests}`);
          console.log('');
        }
      }
      return;
    }

    // ── Feature 12: Cross-artifact Semantic Diffing ───────────────────────
    if (subcommand === 'semantic-diff') {
      const diffLib = require('./lib/semantic-diff');
      const action = process.argv[3] || 'cross-artifact';
      const jsonMode = process.argv.includes('--json');
      const io = require('./lib/io');
      const root = process.cwd();

      if (action === 'compare') {
        const pathA = process.argv[4];
        const pathB = process.argv[5];
        if (!pathA || !pathB) { console.error(chalk.red('Usage: jumpstart-mode semantic-diff compare <file1> <file2>')); process.exit(1); }
        const result = diffLib.compareFiles(pathA, pathB);
        if (jsonMode) { io.writeResult(result); } else {
          if (result.success) {
            console.log(chalk.bold(`\n🔍 Semantic Diff`));
            console.log(`  Similarity: ${result.overall_similarity}%`);
            console.log(`  Breaking changes: ${result.has_breaking_changes ? 'Yes' : 'No'}`);
            console.log(`  Sections: +${result.summary.sections_added} -${result.summary.sections_removed} ~${result.summary.sections_modified}`);
            console.log(`  Requirements: +${result.summary.requirements_added} -${result.summary.requirements_removed}`);
            console.log(`  APIs: +${result.summary.apis_added} -${result.summary.apis_removed}`);
          } else { console.error(chalk.red(`❌ ${result.error}`)); }
          console.log('');
        }
      } else {
        const result = diffLib.crossArtifactDiff(root);
        if (jsonMode) { io.writeResult(result); } else {
          if (result.success) {
            console.log(chalk.bold(`\n🔍 Cross-artifact Semantic Analysis`));
            console.log(`  Artifacts analyzed: ${result.artifacts_analyzed}`);
            console.log(`  Inconsistencies: ${result.summary.total_inconsistencies}`);
            for (const inc of result.inconsistencies) {
              console.log(`  ⚠️  ${inc.type}: ${inc.upstream} → ${inc.downstream}: ${inc.missing_requirements.length} gaps`);
            }
          } else { console.error(chalk.red(`❌ ${result.error}`)); }
          console.log('');
        }
      }
      return;
    }

    // ── Feature 13: Native Backlog Synchronization ───────────────────────
    if (subcommand === 'backlog-sync') {
      const backlogLib = require('./lib/backlog-sync');
      const action = process.argv[3] || 'extract';
      const jsonMode = process.argv.includes('--json');
      const io = require('./lib/io');
      const root = process.cwd();

      if (action === 'extract') {
        const result = backlogLib.extractBacklog(root);
        if (jsonMode) { io.writeResult(result); } else {
          console.log(chalk.bold('\n📋 Backlog Extraction'));
          console.log(`  Epics: ${result.epics}  Stories: ${result.stories}  Tasks: ${result.tasks}`);
          console.log('');
        }
      } else if (action === 'export') {
        const target = process.argv[4];
        if (!target) { console.error(chalk.red('Usage: jumpstart-mode backlog-sync export <github|jira|azure-devops>')); process.exit(1); }
        const result = backlogLib.exportBacklog(root, target);
        if (jsonMode) { io.writeResult(result); } else {
          if (result.success) {
            console.log(chalk.green(`\n✅ Backlog exported for ${target}`));
            console.log(`  Items: ${result.items_exported}`);
            console.log(`  Output: ${result.output}`);
          } else { console.error(chalk.red(`❌ ${result.error}`)); }
          console.log('');
        }
      } else {
        const syncState = backlogLib.loadSyncState(path.join(root, '.jumpstart', 'state', 'backlog-sync.json'));
        if (jsonMode) { io.writeResult(syncState); } else {
          console.log(chalk.bold('\n📋 Backlog Sync Status'));
          console.log(`  Last sync: ${syncState.last_sync || 'never'}`);
          console.log(`  Exports: ${syncState.export_history.length}`);
          console.log('');
        }
      }
      return;
    }

    // ── Feature 14: Delivery Confidence Scoring ──────────────────────────
    if (subcommand === 'delivery-confidence') {
      const confLib = require('./lib/delivery-confidence');
      const action = process.argv[3] || 'project';
      const jsonMode = process.argv.includes('--json');
      const io = require('./lib/io');
      const root = process.cwd();

      if (action === 'score') {
        const filePath = process.argv[4];
        if (!filePath) { console.error(chalk.red('Usage: jumpstart-mode delivery-confidence score <file>')); process.exit(1); }
        const result = confLib.scoreFile(filePath, { root });
        if (jsonMode) { io.writeResult(result); } else {
          if (result.success) {
            console.log(chalk.bold(`\n${result.confidence_emoji} Delivery Confidence: ${result.overall_score}% (${result.confidence_level})`));
            for (const [dim, data] of Object.entries(result.dimensions)) {
              console.log(`  ${dim}: ${data.score}%`);
            }
            if (result.top_gaps.length > 0) console.log(`  Gaps: ${result.top_gaps.join(', ')}`);
          } else { console.error(chalk.red(`❌ ${result.error}`)); }
          console.log('');
        }
      } else {
        const result = confLib.scoreProject(root);
        if (jsonMode) { io.writeResult(result); } else {
          if (result.success) {
            console.log(chalk.bold(`\n${result.project_emoji} Project Confidence: ${result.project_score}% (${result.project_confidence})`));
            for (const a of result.artifacts) {
              console.log(`  ${a.confidence_emoji || '○'} ${a.artifact}: ${a.overall_score || 0}%`);
            }
          } else { console.error(chalk.red(`❌ ${result.error}`)); }
          console.log('');
        }
      }
      return;
    }

    // ── Feature 15: Rich Plan Execution Engine ───────────────────────────
    if (subcommand === 'plan-executor') {
      const execLib = require('./lib/plan-executor');
      const action = process.argv[3] || 'status';
      const jsonMode = process.argv.includes('--json');
      const io = require('./lib/io');
      const root = process.cwd();
      const stateFile = path.join(root, '.jumpstart', 'state', 'plan-execution.json');

      if (action === 'init') {
        const result = execLib.initializeExecution(root, { stateFile });
        if (jsonMode) { io.writeResult(result); } else {
          if (result.success) {
            console.log(chalk.green(`\n✅ Plan execution initialized`));
            console.log(`  Jobs: ${result.total_jobs}`);
            console.log(`  Milestones: ${result.milestones.join(', ')}`);
          } else { console.error(chalk.red(`❌ ${result.error}`)); }
          console.log('');
        }
      } else if (action === 'update') {
        const jobId = process.argv[4];
        const status = process.argv[5];
        if (!jobId || !status) { console.error(chalk.red('Usage: jumpstart-mode plan-executor update <job-id> <status>')); process.exit(1); }
        const result = execLib.updateJobStatus(jobId, status, { stateFile });
        if (jsonMode) { io.writeResult(result); } else {
          console.log(result.success ? chalk.green(`✅ ${jobId}: ${result.previous_status} → ${result.new_status}`) : chalk.red(`❌ ${result.error}`));
          console.log('');
        }
      } else if (action === 'verify') {
        const jobId = process.argv[4];
        if (!jobId) { console.error(chalk.red('Usage: jumpstart-mode plan-executor verify <job-id>')); process.exit(1); }
        const result = execLib.verifyJob(jobId, root, { stateFile });
        if (jsonMode) { io.writeResult(result); } else {
          console.log(result.success ? (result.verified ? chalk.green(`✅ ${jobId}: verified`) : chalk.yellow(`⚠️ ${jobId}: verification failed`)) : chalk.red(`❌ ${result.error}`));
          console.log('');
        }
      } else if (action === 'reset') {
        const result = execLib.resetExecution({ stateFile });
        if (jsonMode) { io.writeResult(result); } else {
          console.log(chalk.green(`✅ Execution reset (${result.jobs_reset} jobs)`));
          console.log('');
        }
      } else {
        const result = execLib.getExecutionStatus({ stateFile });
        if (jsonMode) { io.writeResult(result); } else {
          if (result.initialized) {
            console.log(chalk.bold(`\n⚡ Plan Execution: ${result.progress}%`));
            console.log(`  Total: ${result.total_jobs}  Completed: ${result.status_counts.completed}  In Progress: ${result.status_counts.in_progress}  Pending: ${result.status_counts.pending}`);
            if (result.next_tasks.length > 0) {
              console.log('  Next tasks:');
              for (const t of result.next_tasks.slice(0, 5)) console.log(`    → ${t.id}: ${t.title}`);
            }
          } else { console.log(chalk.gray('\n  No execution plan loaded. Run: jumpstart-mode plan-executor init')); }
          console.log('');
        }
      }
      return;
    }

    // ── Feature 16: Architectural Fitness Functions ──────────────────────
    if (subcommand === 'fitness-functions') {
      const fitnessLib = require('./lib/fitness-functions');
      const action = process.argv[3] || 'evaluate';
      const jsonMode = process.argv.includes('--json');
      const io = require('./lib/io');
      const root = process.cwd();
      const registryFile = path.join(root, '.jumpstart', 'fitness-functions.json');

      if (action === 'add') {
        const name = process.argv[4];
        const category = process.argv[5];
        if (!name || !category) { console.error(chalk.red('Usage: jumpstart-mode fitness-functions add <name> <category> [--pattern <regex>] [--threshold <n>]')); process.exit(1); }
        const patternIdx = process.argv.indexOf('--pattern');
        const thresholdIdx = process.argv.indexOf('--threshold');
        const result = fitnessLib.addFitnessFunction({
          name,
          category,
          description: `Fitness function: ${name}`,
          pattern: patternIdx !== -1 ? process.argv[patternIdx + 1] : null,
          threshold: thresholdIdx !== -1 ? parseInt(process.argv[thresholdIdx + 1]) : null
        }, { registryFile });
        if (jsonMode) { io.writeResult(result); } else {
          console.log(result.success ? chalk.green(`✅ Fitness function added: ${name}`) : chalk.red(`❌ ${result.error}`));
          console.log('');
        }
      } else if (action === 'list') {
        const result = fitnessLib.listFitnessFunctions({}, { registryFile });
        if (jsonMode) { io.writeResult(result); } else {
          console.log(chalk.bold(`\n🏋️ Fitness Functions (${result.total})`));
          for (const f of result.functions) console.log(`  [${f.enabled ? '✓' : '✗'}] ${f.name} (${f.category})`);
          console.log('');
        }
      } else {
        const result = fitnessLib.evaluateFitness(root, { registryFile });
        if (jsonMode) { io.writeResult(result); } else {
          const icon = result.all_passed ? '✅' : '❌';
          console.log(chalk.bold(`\n${icon} Fitness Evaluation`));
          console.log(`  Functions: ${result.summary.total_functions}  Passed: ${result.summary.passed}  Failed: ${result.summary.failed}`);
          for (const r of result.results.filter(r => !r.passed)) {
            console.log(`  🔴 ${r.name}: ${r.violations} violations`);
          }
          console.log('');
        }
      }
      return;
    }

    // ── Feature 17: Org-wide Reusable Reference Architectures ───────────
    if (subcommand === 'reference-arch') {
      const refLib = require('./lib/reference-architectures');
      const action = process.argv[3] || 'list';
      const jsonMode = process.argv.includes('--json');
      const io = require('./lib/io');
      const root = process.cwd();

      if (action === 'get') {
        const patternId = process.argv[4];
        if (!patternId) { console.error(chalk.red('Usage: jumpstart-mode reference-arch get <pattern-id>')); process.exit(1); }
        const result = refLib.getPattern(patternId);
        if (jsonMode) { io.writeResult(result); } else {
          if (result.success) {
            const p = result.pattern;
            console.log(chalk.bold(`\n📐 ${p.name} (${p.category})`));
            console.log(`  ${p.description}`);
            console.log(`  Components: ${p.components.join(', ')}`);
            console.log('  Structure:');
            for (const [dir, desc] of Object.entries(p.structure || {})) console.log(`    ${dir} — ${desc}`);
            if (p.nfrs.length > 0) console.log(`  NFRs: ${p.nfrs.join('; ')}`);
          } else { console.error(chalk.red(`❌ ${result.error}`)); }
          console.log('');
        }
      } else if (action === 'register') {
        const name = process.argv[4];
        const category = process.argv[5];
        if (!name) { console.error(chalk.red('Usage: jumpstart-mode reference-arch register <name> [category]')); process.exit(1); }
        const result = refLib.registerPattern({ name, category: category || 'other', description: `Custom pattern: ${name}` });
        if (jsonMode) { io.writeResult(result); } else {
          console.log(result.success ? chalk.green(`✅ Pattern registered: ${name}`) : chalk.red(`❌ ${result.error}`));
          console.log('');
        }
      } else if (action === 'instantiate') {
        const patternId = process.argv[4];
        if (!patternId) { console.error(chalk.red('Usage: jumpstart-mode reference-arch instantiate <pattern-id>')); process.exit(1); }
        const result = refLib.instantiatePattern(patternId, root);
        if (jsonMode) { io.writeResult(result); } else {
          if (result.success) {
            console.log(chalk.green(`\n✅ Pattern instantiated: ${result.pattern_name}`));
            console.log(`  Directories created: ${result.directories_created.length}`);
            console.log(`  Components: ${result.components.join(', ')}`);
          } else { console.error(chalk.red(`❌ ${result.error}`)); }
          console.log('');
        }
      } else {
        const result = refLib.listPatterns();
        if (jsonMode) { io.writeResult(result); } else {
          console.log(chalk.bold(`\n📐 Reference Architectures (${result.total})`));
          for (const p of result.patterns) console.log(`  ${p.id} (${p.category}): ${p.name} — ${p.components} components`);
          console.log(`  Categories: ${result.categories.join(', ')}`);
          console.log('');
        }
      }
      return;
    }

    // ── Feature 18: Decision Conflict Detection ─────────────────────────
    if (subcommand === 'decision-conflicts') {
      const conflictsLib = require('./lib/decision-conflicts');
      const jsonMode = process.argv.includes('--json');
      const io = require('./lib/io');
      const root = process.cwd();

      const result = conflictsLib.detectConflicts(root);
      if (jsonMode) { io.writeResult(result); } else {
        if (result.success) {
          const icon = result.summary.has_conflicts ? '⚠️' : '✅';
          console.log(chalk.bold(`\n${icon} Decision Conflict Analysis`));
          console.log(`  Decisions analyzed: ${result.total_decisions}`);
          console.log(`  Conflicts found: ${result.summary.total_conflicts}`);
          for (const c of result.conflicts) {
            console.log(`  🔸 ${c.type}: ${c.description}`);
            console.log(`    Sources: ${c.sources.join(', ')}`);
          }
        } else { console.error(chalk.red(`❌ ${result.error}`)); }
        console.log('');
      }
      return;
    }

    // ── Feature 19: Spec Maturity Model ─────────────────────────────────
    if (subcommand === 'spec-maturity') {
      const maturityLib = require('./lib/spec-maturity');
      const action = process.argv[3] || 'project';
      const jsonMode = process.argv.includes('--json');
      const io = require('./lib/io');
      const root = process.cwd();

      if (action === 'assess') {
        const filePath = process.argv[4];
        if (!filePath) { console.error(chalk.red('Usage: jumpstart-mode spec-maturity assess <file>')); process.exit(1); }
        const result = maturityLib.assessFile(filePath);
        if (jsonMode) { io.writeResult(result); } else {
          if (result.success) {
            console.log(chalk.bold(`\n📊 Maturity: L${result.maturity_level} ${result.maturity_name} (${result.overall_score}%)`));
            for (const [cat, data] of Object.entries(result.category_scores)) {
              console.log(`  ${cat}: ${data.score}% (${data.passed}/${data.total})`);
            }
            if (result.next_level) console.log(`  Next level: L${result.next_level.level} ${result.next_level.name} (need +${result.next_level.points_needed} points)`);
            if (result.gaps.length > 0) console.log(`  Gaps: ${result.gaps.slice(0, 5).map(g => g.check).join(', ')}`);
          } else { console.error(chalk.red(`❌ ${result.error}`)); }
          console.log('');
        }
      } else {
        const result = maturityLib.assessProject(root);
        if (jsonMode) { io.writeResult(result); } else {
          if (result.success) {
            console.log(chalk.bold(`\n📊 Project Maturity: L${result.project_level} ${result.project_maturity} (${result.project_score}%)`));
            for (const a of result.artifacts) {
              console.log(`  L${a.maturity_level || 1} ${a.artifact}: ${a.overall_score || 0}% (${a.maturity_name || 'Draft'})`);
            }
            console.log(`  Production-ready: ${result.summary.production_ready}/${result.summary.artifacts_assessed}`);
          } else { console.error(chalk.red(`❌ ${result.error}`)); }
          console.log('');
        }
      }
      return;
    }

    // ── Feature 20: Portfolio Reporting Layer ────────────────────────────
    if (subcommand === 'portfolio') {
      const portfolioLib = require('./lib/portfolio-reporting');
      const action = process.argv[3] || 'status';
      const jsonMode = process.argv.includes('--json');
      const io = require('./lib/io');
      const portfolioFile = path.join(process.cwd(), '.jumpstart', 'state', 'portfolio.json');

      if (action === 'register') {
        const name = process.argv[4];
        if (!name) { console.error(chalk.red('Usage: jumpstart-mode portfolio register <name> [--path <dir>] [--owner <name>]')); process.exit(1); }
        const pathIdx = process.argv.indexOf('--path');
        const ownerIdx = process.argv.indexOf('--owner');
        const result = portfolioLib.registerInitiative({
          name,
          path: pathIdx !== -1 ? process.argv[pathIdx + 1] : null,
          owner: ownerIdx !== -1 ? process.argv[ownerIdx + 1] : null
        }, { portfolioFile });
        if (jsonMode) { io.writeResult(result); } else {
          console.log(result.success ? chalk.green(`✅ Initiative registered: ${name}`) : chalk.red(`❌ ${result.error}`));
          console.log('');
        }
      } else if (action === 'refresh') {
        const initId = process.argv[4];
        if (!initId) { console.error(chalk.red('Usage: jumpstart-mode portfolio refresh <initiative-id>')); process.exit(1); }
        const result = portfolioLib.refreshInitiative(initId, { portfolioFile });
        if (jsonMode) { io.writeResult(result); } else {
          if (result.success) {
            const i = result.initiative;
            console.log(chalk.bold(`\n🔄 ${i.name}`));
            console.log(`  Status: ${i.status}  Phase: ${i.current_phase}  Progress: ${i.phase_progress}%`);
          } else { console.error(chalk.red(`❌ ${result.error}`)); }
          console.log('');
        }
      } else if (action === 'snapshot') {
        const result = portfolioLib.takeSnapshot({ portfolioFile });
        if (jsonMode) { io.writeResult(result); } else {
          console.log(chalk.green(`✅ Portfolio snapshot taken at ${result.snapshot.taken_at}`));
          console.log('');
        }
      } else if (action === 'remove') {
        const initId = process.argv[4];
        if (!initId) { console.error(chalk.red('Usage: jumpstart-mode portfolio remove <initiative-id>')); process.exit(1); }
        const result = portfolioLib.removeInitiative(initId, { portfolioFile });
        if (jsonMode) { io.writeResult(result); } else {
          console.log(result.success ? chalk.green(`✅ Removed: ${result.removed}`) : chalk.red(`❌ ${result.error}`));
          console.log('');
        }
      } else {
        const result = portfolioLib.getPortfolioStatus({ portfolioFile });
        if (jsonMode) { io.writeResult(result); } else {
          console.log(chalk.bold(`\n📊 Portfolio Status (${result.total_initiatives} initiatives)`));
          console.log(`  Average progress: ${result.average_progress}%`);
          console.log(`  On-track: ${result.status_counts['on-track']}  At-risk: ${result.status_counts['at-risk']}  Blocked: ${result.status_counts['blocked']}  Completed: ${result.status_counts['completed']}`);
          if (result.budget.total > 0) console.log(`  Budget: $${result.budget.spent}/$${result.budget.total} (${Math.round((result.budget.spent/result.budget.total)*100)}%)`);
          for (const i of result.initiatives) {
            console.log(`  [${i.status}] ${i.name}: ${i.progress}% (${i.readiness})`);
          }
          if (result.blockers.length > 0) {
            console.log('  Blockers:');
            for (const b of result.blockers) console.log(`    🔴 ${b.initiative}: ${b.blocker}`);
          }
          console.log('');
        }
      }
      return;
    }

    // ── Feature 21: CI/CD Integration ─────────────────────────────────────
    if (subcommand === 'ci-cd-integration') {
      const lib = require('./lib/ci-cd-integration');
      const action = process.argv[3] || 'status';
      const jsonMode = process.argv.includes('--json');
      const io = require('./lib/io');
      if (action === 'generate') {
        const platform = process.argv[4] || 'github-actions';
        const result = lib.generatePipeline(platform);
        if (jsonMode) { io.writeResult(result); } else {
          console.log(result.success ? chalk.green(`✅ Pipeline generated for ${platform}: ${result.path}`) : chalk.red(`❌ ${result.error}`));
        }
      } else if (action === 'validate') {
        const result = lib.validatePipeline(process.cwd());
        if (jsonMode) { io.writeResult(result); } else {
          console.log(chalk.bold('\n🔄 CI/CD Pipeline Validation'));
          for (const p of result.pipelines) console.log(`  ${p.exists ? '✅' : '❌'} ${p.platform}: ${p.path}`);
          console.log('');
        }
      } else {
        const result = lib.getStatus();
        if (jsonMode) { io.writeResult(result); } else {
          console.log(chalk.bold(`\n🔄 CI/CD Integration Status`));
          console.log(`  Available checks: ${result.available_checks}`);
          console.log(`  Pipelines: ${result.pipelines}  Runs: ${result.total_runs}\n`);
        }
      }
      return;
    }

    // ── Feature 22: Environment Promotion ────────────────────────────────────
    if (subcommand === 'env-promotion') {
      const lib = require('./lib/environment-promotion');
      const action = process.argv[3] || 'status';
      const jsonMode = process.argv.includes('--json');
      const io = require('./lib/io');
      const stateFile = path.join(process.cwd(), '.jumpstart', 'state', 'environment-promotion.json');
      if (action === 'promote') {
        const target = process.argv[4];
        if (!target) { console.error(chalk.red('Usage: jumpstart-mode env-promotion promote <environment>')); process.exit(1); }
        const result = lib.promote(target, { stateFile });
        if (jsonMode) { io.writeResult(result); } else {
          console.log(result.success ? chalk.green(`✅ Promoted to ${result.to}`) : chalk.red(`❌ ${result.error}`));
        }
      } else if (action === 'gate') {
        const env = process.argv[4];
        if (!env) { console.error(chalk.red('Usage: jumpstart-mode env-promotion gate <environment>')); process.exit(1); }
        const result = lib.checkGates(env, { stateFile });
        if (jsonMode) { io.writeResult(result); } else {
          console.log(chalk.bold(`\n🚦 Gate Status: ${env}`));
          console.log(`  Passed: ${result.passed.join(', ') || 'none'}`);
          console.log(`  Pending: ${result.pending.join(', ') || 'none'}\n`);
        }
      } else {
        const result = lib.getStatus({ stateFile });
        if (jsonMode) { io.writeResult(result); } else {
          console.log(chalk.bold(`\n🌍 Environment Promotion Status`));
          console.log(`  Current: ${result.current_environment}`);
          for (const e of result.environments) console.log(`  ${e.ready ? '✅' : '⏳'} ${e.name}: ${e.gates_passed}/${e.gates_total} gates`);
          console.log('');
        }
      }
      return;
    }

    // ── Feature 23: RACI Matrix ──────────────────────────────────────────────
    if (subcommand === 'raci-matrix') {
      const lib = require('./lib/raci-matrix');
      const action = process.argv[3] || 'report';
      const jsonMode = process.argv.includes('--json');
      const io = require('./lib/io');
      const stateFile = path.join(process.cwd(), '.jumpstart', 'state', 'raci-matrix.json');
      if (action === 'define') {
        const artifact = process.argv[4];
        const accountable = process.argv[5];
        if (!artifact || !accountable) { console.error(chalk.red('Usage: jumpstart-mode raci-matrix define <artifact> <accountable>')); process.exit(1); }
        const result = lib.defineAssignment(artifact, { accountable }, { stateFile });
        if (jsonMode) { io.writeResult(result); } else {
          console.log(result.success ? chalk.green(`✅ RACI defined for ${artifact}`) : chalk.red(`❌ ${result.error}`));
        }
      } else if (action === 'check') {
        const artifact = process.argv[4];
        const actor = process.argv[5];
        if (!artifact || !actor) { console.error(chalk.red('Usage: jumpstart-mode raci-matrix check <artifact> <actor>')); process.exit(1); }
        const result = lib.checkPermission(artifact, actor, 'approve', { stateFile });
        if (jsonMode) { io.writeResult(result); } else {
          console.log(result.allowed ? chalk.green(`✅ ${result.reason}`) : chalk.red(`❌ ${result.reason}`));
        }
      } else {
        const result = lib.generateReport({ stateFile });
        if (jsonMode) { io.writeResult(result); } else {
          console.log(chalk.bold(`\n📋 RACI Matrix (${result.total_assignments} assignments, ${result.coverage}% coverage)`));
          for (const row of result.matrix) console.log(`  ${row.artifact}: R=${row.R} A=${row.A} C=${row.C || '-'} I=${row.I || '-'}`);
          if (result.gaps.length > 0) console.log(chalk.yellow(`  Gaps: ${result.gaps.join(', ')}`));
          console.log('');
        }
      }
      return;
    }

    // ── Feature 24: Compliance Packs ─────────────────────────────────────────
    if (subcommand === 'compliance-packs') {
      const lib = require('./lib/compliance-packs');
      const action = process.argv[3] || 'list';
      const jsonMode = process.argv.includes('--json');
      const io = require('./lib/io');
      const stateFile = path.join(process.cwd(), '.jumpstart', 'state', 'compliance.json');
      if (action === 'list') {
        const result = lib.listFrameworks();
        if (jsonMode) { io.writeResult(result); } else {
          console.log(chalk.bold(`\n📦 Compliance Frameworks (${result.total})`));
          for (const fw of result.frameworks) console.log(`  ${fw.id}: ${fw.name} (${fw.controls} controls)`);
          console.log('');
        }
      } else if (action === 'apply') {
        const fw = process.argv[4];
        if (!fw) { console.error(chalk.red('Usage: jumpstart-mode compliance-packs apply <framework-id>')); process.exit(1); }
        const result = lib.applyFramework(fw, { stateFile });
        if (jsonMode) { io.writeResult(result); } else {
          console.log(result.success ? chalk.green(`✅ Applied ${result.name} (${result.controls_added} controls)`) : chalk.red(`❌ ${result.error}`));
        }
      } else if (action === 'check') {
        const result = lib.checkCompliance({ stateFile });
        if (jsonMode) { io.writeResult(result); } else {
          console.log(chalk.bold(`\n🔍 Compliance Check`));
          console.log(`  Frameworks: ${result.applied_frameworks?.join(', ') || 'none'}`);
          console.log(`  Controls: ${result.total_controls || 0}  Compliant: ${result.compliant}\n`);
        }
      }
      return;
    }

    // ── Feature 25: Evidence Collector ────────────────────────────────────────
    if (subcommand === 'evidence-collector') {
      const lib = require('./lib/evidence-collector');
      const action = process.argv[3] || 'status';
      const jsonMode = process.argv.includes('--json');
      const io = require('./lib/io');
      const root = process.cwd();
      if (action === 'collect') {
        const result = lib.collectEvidence(root);
        if (jsonMode) { io.writeResult(result); } else {
          console.log(chalk.green(`✅ Collected ${result.items_collected} evidence items`));
        }
      } else if (action === 'package') {
        const result = lib.packageEvidence(root);
        if (jsonMode) { io.writeResult(result); } else {
          console.log(result.success ? chalk.green(`✅ Evidence packaged: ${result.output}`) : chalk.red(`❌ ${result.error}`));
        }
      } else {
        const result = lib.getStatus();
        if (jsonMode) { io.writeResult(result); } else {
          console.log(chalk.bold(`\n📦 Evidence Status: ${result.total_items} items, ${result.collections} collections\n`));
        }
      }
      return;
    }

    // ── Feature 26: Release Readiness ────────────────────────────────────────
    if (subcommand === 'release-readiness') {
      const lib = require('./lib/release-readiness');
      const action = process.argv[3] || 'report';
      const jsonMode = process.argv.includes('--json');
      const io = require('./lib/io');
      const root = process.cwd();
      if (action === 'assess') {
        const result = lib.assessReadiness(root);
        if (jsonMode) { io.writeResult(result); } else {
          console.log(chalk.bold(`\n🚀 Release Readiness: ${result.level} (${result.total_score}%)`));
          console.log(`  Recommendation: ${result.recommendation}`);
          if (result.blockers.length > 0) console.log(chalk.red(`  Blockers: ${result.blockers.join(', ')}`));
          console.log('');
        }
      } else {
        const result = lib.generateReport({ stateFile: path.join(root, '.jumpstart', 'state', 'release-readiness.json') });
        if (jsonMode) { io.writeResult(result); } else {
          if (result.success) {
            console.log(chalk.bold(`\n🚀 Release Readiness Report: ${result.level} (${result.total_score}%)`));
            for (const cat of result.categories) console.log(`  ${cat.status === 'pass' ? '✅' : cat.status === 'warning' ? '⚠️' : '❌'} ${cat.name}: ${cat.score}%`);
          } else {
            console.log(chalk.yellow(`  ${result.error}`));
          }
          console.log('');
        }
      }
      return;
    }

    // ── Feature 27: Waiver Workflow ──────────────────────────────────────────
    if (subcommand === 'waiver-workflow') {
      const lib = require('./lib/waiver-workflow');
      const action = process.argv[3] || 'list';
      const jsonMode = process.argv.includes('--json');
      const io = require('./lib/io');
      const stateFile = path.join(process.cwd(), '.jumpstart', 'state', 'waivers.json');
      if (action === 'request') {
        const title = process.argv[4];
        const owner = process.argv[5];
        if (!title || !owner) { console.error(chalk.red('Usage: jumpstart-mode waiver-workflow request <title> <owner>')); process.exit(1); }
        const result = lib.requestWaiver({ title, owner, justification: 'CLI request' }, { stateFile });
        if (jsonMode) { io.writeResult(result); } else {
          console.log(result.success ? chalk.green(`✅ Waiver requested: ${result.waiver.id}`) : chalk.red(`❌ ${result.error}`));
        }
      } else if (action === 'approve') {
        const waiverId = process.argv[4];
        if (!waiverId) { console.error(chalk.red('Usage: jumpstart-mode waiver-workflow approve <waiver-id>')); process.exit(1); }
        const result = lib.resolveWaiver(waiverId, 'approve', { stateFile });
        if (jsonMode) { io.writeResult(result); } else {
          console.log(result.success ? chalk.green(`✅ Waiver approved: ${waiverId}`) : chalk.red(`❌ ${result.error}`));
        }
      } else if (action === 'expire') {
        const result = lib.expireWaivers({ stateFile });
        if (jsonMode) { io.writeResult(result); } else {
          console.log(chalk.green(`✅ Expired ${result.expired} waivers`));
        }
      } else {
        const result = lib.listWaivers({}, { stateFile });
        if (jsonMode) { io.writeResult(result); } else {
          console.log(chalk.bold(`\n📋 Waivers (${result.total})`));
          for (const w of result.waivers) console.log(`  [${w.status}] ${w.id}: ${w.title} (${w.owner})`);
          console.log('');
        }
      }
      return;
    }

    // ── Feature 28: SLA/SLO ──────────────────────────────────────────────────
    if (subcommand === 'sla-slo') {
      const lib = require('./lib/sla-slo');
      const action = process.argv[3] || 'report';
      const jsonMode = process.argv.includes('--json');
      const io = require('./lib/io');
      const stateFile = path.join(process.cwd(), '.jumpstart', 'state', 'sla-slo.json');
      if (action === 'define') {
        const name = process.argv[4];
        const service = process.argv[5];
        const target = process.argv[6];
        if (!name || !service || !target) { console.error(chalk.red('Usage: jumpstart-mode sla-slo define <name> <service> <target>')); process.exit(1); }
        const result = lib.defineSLO({ name, service, target: parseFloat(target) }, { stateFile });
        if (jsonMode) { io.writeResult(result); } else {
          console.log(result.success ? chalk.green(`✅ SLO defined: ${result.slo.id}`) : chalk.red(`❌ ${result.error}`));
        }
      } else if (action === 'check') {
        const result = lib.checkSLOCoverage(process.cwd(), { stateFile });
        if (jsonMode) { io.writeResult(result); } else {
          console.log(chalk.bold(`\n📊 SLO Coverage: ${result.defined_slos} SLOs defined`));
          console.log(`  Architecture mentions SLO: ${result.architecture_mentions_slo}`);
          console.log(`  PRD mentions SLO: ${result.prd_mentions_slo}\n`);
        }
      } else {
        const result = lib.generateReport({ stateFile });
        if (jsonMode) { io.writeResult(result); } else {
          console.log(chalk.bold(`\n📊 SLA/SLO Report: ${result.total_slos} SLOs, ${result.total_slas} SLAs\n`));
        }
      }
      return;
    }

    // ── Feature 29: Risk Register ────────────────────────────────────────────
    if (subcommand === 'risk-register') {
      const lib = require('./lib/risk-register');
      const action = process.argv[3] || 'report';
      const jsonMode = process.argv.includes('--json');
      const io = require('./lib/io');
      const stateFile = path.join(process.cwd(), '.jumpstart', 'state', 'risk-register.json');
      if (action === 'add') {
        const title = process.argv[4];
        if (!title) { console.error(chalk.red('Usage: jumpstart-mode risk-register add <title>')); process.exit(1); }
        const result = lib.addRisk({ title, description: title }, { stateFile });
        if (jsonMode) { io.writeResult(result); } else {
          console.log(result.success ? chalk.green(`✅ Risk added: ${result.risk.id} (score: ${result.risk.score})`) : chalk.red(`❌ ${result.error}`));
        }
      } else if (action === 'list') {
        const result = lib.listRisks({}, { stateFile });
        if (jsonMode) { io.writeResult(result); } else {
          console.log(chalk.bold(`\n⚠️ Risk Register (${result.total})`));
          for (const r of result.risks) console.log(`  [${r.status}] ${r.id}: ${r.title} (${r.likelihood}/${r.impact}, score=${r.score})`);
          console.log('');
        }
      } else {
        const result = lib.generateReport({ stateFile });
        if (jsonMode) { io.writeResult(result); } else {
          console.log(chalk.bold(`\n⚠️ Risk Report: ${result.total_risks} risks, avg score=${result.average_score}`));
          console.log(`  High: ${result.high_risks}  Unmitigated: ${result.unmitigated}\n`);
        }
      }
      return;
    }

    // ── Feature 30: Data Classification ──────────────────────────────────────
    if (subcommand === 'data-classification') {
      const lib = require('./lib/data-classification');
      const action = process.argv[3] || 'report';
      const jsonMode = process.argv.includes('--json');
      const io = require('./lib/io');
      const stateFile = path.join(process.cwd(), '.jumpstart', 'state', 'data-classification.json');
      if (action === 'classify') {
        const name = process.argv[4];
        if (!name) { console.error(chalk.red('Usage: jumpstart-mode data-classification classify <asset-name>')); process.exit(1); }
        const result = lib.classifyAsset({ name }, { stateFile });
        if (jsonMode) { io.writeResult(result); } else {
          console.log(result.success ? chalk.green(`✅ Classified: ${result.asset.classification}`) : chalk.red(`❌ ${result.error}`));
        }
      } else if (action === 'check') {
        const result = lib.checkCompliance({ stateFile });
        if (jsonMode) { io.writeResult(result); } else {
          console.log(chalk.bold(`\n🏷️ Data Classification: ${result.total_assets} assets, ${result.violations} violations\n`));
        }
      } else {
        const result = lib.generateReport({ stateFile });
        if (jsonMode) { io.writeResult(result); } else {
          console.log(chalk.bold(`\n🏷️ Data Classification Report: ${result.total_assets} assets`));
          for (const [level, count] of Object.entries(result.by_level)) console.log(`  ${level}: ${count}`);
          console.log('');
        }
      }
      return;
    }

    // ── Feature 31: Credential Boundary ──────────────────────────────────────
    if (subcommand === 'credential-boundary') {
      const lib = require('./lib/credential-boundary');
      const action = process.argv[3] || 'scan';
      const jsonMode = process.argv.includes('--json');
      const io = require('./lib/io');
      const root = process.cwd();
      const result = lib.scanProject(root);
      if (jsonMode) { io.writeResult(result); } else {
        console.log(chalk.bold(`\n🔐 Credential Boundary Scan`));
        console.log(`  Files scanned: ${result.files_scanned}`);
        console.log(`  Findings: ${result.total_findings} (${result.critical} critical, ${result.high} high)`);
        console.log(`  ${result.pass ? chalk.green('✅ PASS') : chalk.red('❌ FAIL')}\n`);
      }
      return;
    }

    // ── Feature 32: EA Review Packet ─────────────────────────────────────────
    if (subcommand === 'ea-review-packet') {
      const lib = require('./lib/ea-review-packet');
      const jsonMode = process.argv.includes('--json');
      const io = require('./lib/io');
      const result = lib.generatePacket(process.cwd());
      if (jsonMode) { io.writeResult(result); } else {
        console.log(chalk.bold(`\n🏢 EA Review Packet: ${result.completeness}% complete`));
        for (const [section, data] of Object.entries(result.sections)) console.log(`  ${data.present ? '✅' : '❌'} ${section}`);
        if (result.gaps.length > 0) console.log(chalk.yellow(`  Gaps: ${result.gaps.join(', ')}`));
        console.log('');
      }
      return;
    }

    // ── Feature 33: Model Governance ─────────────────────────────────────────
    if (subcommand === 'model-governance') {
      const lib = require('./lib/model-governance');
      const action = process.argv[3] || 'report';
      const jsonMode = process.argv.includes('--json');
      const io = require('./lib/io');
      const stateFile = path.join(process.cwd(), '.jumpstart', 'state', 'model-governance.json');
      if (action === 'register') {
        const name = process.argv[4];
        const provider = process.argv[5];
        if (!name || !provider) { console.error(chalk.red('Usage: jumpstart-mode model-governance register <name> <provider>')); process.exit(1); }
        const result = lib.registerModel({ name, provider }, { stateFile });
        if (jsonMode) { io.writeResult(result); } else {
          console.log(result.success ? chalk.green(`✅ Model registered: ${result.model.id}`) : chalk.red(`❌ ${result.error}`));
        }
      } else {
        const result = lib.generateReport({ stateFile });
        if (jsonMode) { io.writeResult(result); } else {
          console.log(chalk.bold(`\n🤖 Model Governance: ${result.total_models} models, ${result.total_evaluations} evaluations`));
          if (result.high_risk_models.length > 0) console.log(chalk.yellow(`  High risk: ${result.high_risk_models.map(m => m.name).join(', ')}`));
          console.log('');
        }
      }
      return;
    }

    // ── Feature 34: AI Intake ────────────────────────────────────────────────
    if (subcommand === 'ai-intake') {
      const lib = require('./lib/ai-intake');
      const action = process.argv[3] || 'list';
      const jsonMode = process.argv.includes('--json');
      const io = require('./lib/io');
      const stateFile = path.join(process.cwd(), '.jumpstart', 'state', 'ai-intake.json');
      if (action === 'create') {
        const name = process.argv[4];
        if (!name) { console.error(chalk.red('Usage: jumpstart-mode ai-intake create <name>')); process.exit(1); }
        const result = lib.createIntake({ name, description: name }, { stateFile });
        if (jsonMode) { io.writeResult(result); } else {
          console.log(result.success ? chalk.green(`✅ AI intake created: ${result.intake.id} (Risk tier: ${result.intake.risk_tier})`) : chalk.red(`❌ ${result.error}`));
        }
      } else {
        const result = lib.listIntakes({}, { stateFile });
        if (jsonMode) { io.writeResult(result); } else {
          console.log(chalk.bold(`\n🧠 AI Use Case Intakes (${result.total})`));
          for (const i of result.intakes) console.log(`  ${i.id}: ${i.name} (Tier ${i.risk_tier}: ${i.risk_label})`);
          console.log('');
        }
      }
      return;
    }

    // ── Feature 35: FinOps Planner ───────────────────────────────────────────
    if (subcommand === 'finops-planner') {
      const lib = require('./lib/finops-planner');
      const action = process.argv[3] || 'report';
      const jsonMode = process.argv.includes('--json');
      const io = require('./lib/io');
      const stateFile = path.join(process.cwd(), '.jumpstart', 'state', 'finops.json');
      if (action === 'optimize') {
        const result = lib.getOptimizations({ stateFile });
        if (jsonMode) { io.writeResult(result); } else {
          console.log(chalk.bold(`\n💰 FinOps Optimizations (${result.total})`));
          for (const r of result.recommendations) console.log(`  ${r.recommendation} (${r.potential_savings})`);
          console.log('');
        }
      } else {
        const result = lib.generateReport({ stateFile });
        if (jsonMode) { io.writeResult(result); } else {
          console.log(chalk.bold(`\n💰 FinOps Report: $${result.total_monthly}/mo ($${result.total_annual}/yr)`));
          console.log(`  Estimates: ${result.total_estimates}\n`);
        }
      }
      return;
    }

    // ── Feature 36: Vendor Risk ──────────────────────────────────────────────
    if (subcommand === 'vendor-risk') {
      const lib = require('./lib/vendor-risk');
      const action = process.argv[3] || 'report';
      const jsonMode = process.argv.includes('--json');
      const io = require('./lib/io');
      const root = process.cwd();
      const stateFile = path.join(root, '.jumpstart', 'state', 'vendor-risk.json');
      if (action === 'scan') {
        const result = lib.scanDependencies(root);
        if (jsonMode) { io.writeResult(result); } else {
          console.log(chalk.bold(`\n📦 Vendor Scan: ${result.total} dependencies found\n`));
        }
      } else {
        const result = lib.generateReport({ stateFile });
        if (jsonMode) { io.writeResult(result); } else {
          console.log(chalk.bold(`\n📦 Vendor Risk Report: ${result.total_assessed} assessed`));
          console.log(`  Avg score: ${result.average_score}  High risk: ${result.high_risk.length}\n`);
        }
      }
      return;
    }

    // ── Feature 37: CAB Output ───────────────────────────────────────────────
    if (subcommand === 'cab-output') {
      const lib = require('./lib/cab-output');
      const jsonMode = process.argv.includes('--json');
      const io = require('./lib/io');
      const result = lib.generateCABSummary(process.cwd());
      if (jsonMode) { io.writeResult(result); } else {
        console.log(chalk.bold(`\n📋 CAB Summary: ${result.completeness}% complete (Risk: ${result.risk_level})`));
        console.log(`  ${result.recommendation}`);
        if (result.gaps.length > 0) console.log(chalk.yellow(`  Gaps: ${result.gaps.join(', ')}`));
        console.log('');
      }
      return;
    }

    // ── Feature 38: BCDR Planning ────────────────────────────────────────────
    if (subcommand === 'bcdr-planning') {
      const lib = require('./lib/bcdr-planning');
      const action = process.argv[3] || 'report';
      const jsonMode = process.argv.includes('--json');
      const io = require('./lib/io');
      const root = process.cwd();
      const stateFile = path.join(root, '.jumpstart', 'state', 'bcdr.json');
      if (action === 'define') {
        const name = process.argv[4];
        const tier = process.argv[5] || 'silver';
        if (!name) { console.error(chalk.red('Usage: jumpstart-mode bcdr-planning define <service-name> [tier]')); process.exit(1); }
        const result = lib.defineService({ name, tier }, { stateFile });
        if (jsonMode) { io.writeResult(result); } else {
          console.log(result.success ? chalk.green(`✅ BC/DR defined: RTO=${result.service.rto_hours}h RPO=${result.service.rpo_hours}h`) : chalk.red(`❌ ${result.error}`));
        }
      } else if (action === 'check') {
        const result = lib.checkCoverage(root);
        if (jsonMode) { io.writeResult(result); } else {
          console.log(chalk.bold(`\n🛡️ BC/DR Coverage: ${result.coverage}%`));
          if (result.gaps.length > 0) console.log(chalk.yellow(`  Gaps: ${result.gaps.join(', ')}`));
          console.log('');
        }
      } else {
        const result = lib.generateReport({ stateFile });
        if (jsonMode) { io.writeResult(result); } else {
          console.log(chalk.bold(`\n🛡️ BC/DR Report: ${result.total_services} services\n`));
        }
      }
      return;
    }

    // ── Feature 39: Ops Ownership ────────────────────────────────────────────
    if (subcommand === 'ops-ownership') {
      const lib = require('./lib/ops-ownership');
      const action = process.argv[3] || 'report';
      const jsonMode = process.argv.includes('--json');
      const io = require('./lib/io');
      const stateFile = path.join(process.cwd(), '.jumpstart', 'state', 'ops-ownership.json');
      if (action === 'define') {
        const name = process.argv[4];
        const owner = process.argv[5];
        if (!name || !owner) { console.error(chalk.red('Usage: jumpstart-mode ops-ownership define <service> <owner>')); process.exit(1); }
        const result = lib.defineOwnership({ name, service_owner: owner }, { stateFile });
        if (jsonMode) { io.writeResult(result); } else {
          console.log(result.success ? chalk.green(`✅ Ownership defined for ${name}`) : chalk.red(`❌ ${result.error}`));
        }
      } else if (action === 'check') {
        const result = lib.checkCompleteness({ stateFile });
        if (jsonMode) { io.writeResult(result); } else {
          console.log(chalk.bold(`\n👤 Ops Ownership: ${result.complete}/${result.total_services} complete\n`));
        }
      } else {
        const result = lib.generateReport({ stateFile });
        if (jsonMode) { io.writeResult(result); } else {
          console.log(chalk.bold(`\n👤 Ops Ownership Report: ${result.total_services} services\n`));
        }
      }
      return;
    }

    // ── Feature 40: Governance Dashboard ─────────────────────────────────────
    if (subcommand === 'governance-dashboard') {
      const lib = require('./lib/governance-dashboard');
      const jsonMode = process.argv.includes('--json');
      const io = require('./lib/io');
      const result = lib.gatherGovernanceData(process.cwd());
      if (jsonMode) { io.writeResult(result); } else {
        console.log(lib.renderDashboardText(result));
      }
      return;
    }

    // ── Feature 41: Codebase Retrieval ───────────────────────────────────────
    if (subcommand === 'codebase-retrieval') {
      const lib = require('./lib/codebase-retrieval');
      const action = process.argv[3] || 'index';
      const jsonMode = process.argv.includes('--json');
      const io = require('./lib/io');
      const root = process.cwd();
      if (action === 'query') {
        const query = process.argv[4];
        if (!query) { console.error(chalk.red('Usage: jumpstart-mode codebase-retrieval query <search-term>')); process.exit(1); }
        const result = lib.queryFiles(root, query);
        if (jsonMode) { io.writeResult(result); } else {
          console.log(chalk.bold(`\n🔍 Codebase Query: "${query}" (${result.total_results} results)`));
          for (const r of result.results.slice(0, 10)) console.log(`  ${r.file} (${r.matches} matches)`);
          console.log('');
        }
      } else {
        const result = lib.indexProject(root);
        if (jsonMode) { io.writeResult(result); } else {
          console.log(chalk.bold(`\n📁 Codebase Index: ${result.total_files} files`));
          for (const c of result.categories) console.log(`  ${c.type}: ${c.count}`);
          console.log('');
        }
      }
      return;
    }

    // ── Feature 42: AST Edit Engine ──────────────────────────────────────────
    if (subcommand === 'ast-edit') {
      const lib = require('./lib/ast-edit-engine');
      const action = process.argv[3] || 'analyze';
      const jsonMode = process.argv.includes('--json');
      const io = require('./lib/io');
      const filePath = process.argv[4];
      if (!filePath) { console.error(chalk.red('Usage: jumpstart-mode ast-edit analyze|validate <file>')); process.exit(1); }
      const result = lib.analyzeStructure(filePath);
      if (jsonMode) { io.writeResult(result); } else {
        if (result.success) {
          console.log(chalk.bold(`\n🌳 AST Analysis: ${result.file} (${result.language})`));
          console.log(`  Lines: ${result.total_lines}  Symbols: ${result.symbol_count}`);
          for (const s of result.symbols) console.log(`  L${s.line}: ${s.type} ${s.name}`);
        } else { console.log(chalk.red(`❌ ${result.error}`)); }
        console.log('');
      }
      return;
    }

    // ── Feature 43: Refactor Planner ─────────────────────────────────────────
    if (subcommand === 'refactor-planner') {
      const lib = require('./lib/refactor-planner');
      const action = process.argv[3] || 'report';
      const jsonMode = process.argv.includes('--json');
      const io = require('./lib/io');
      const stateFile = path.join(process.cwd(), '.jumpstart', 'state', 'refactor-plan.json');
      const result = lib.generateReport({ stateFile });
      if (jsonMode) { io.writeResult(result); } else {
        console.log(chalk.bold(`\n🔧 Refactor Planner: ${result.total_plans} plans, ${result.completed} completed\n`));
      }
      return;
    }

    // ── Feature 44: Test Generator ───────────────────────────────────────────
    if (subcommand === 'test-generator') {
      const lib = require('./lib/test-generator');
      const action = process.argv[3] || 'coverage';
      const jsonMode = process.argv.includes('--json');
      const io = require('./lib/io');
      const root = process.cwd();
      if (action === 'coverage') {
        const result = lib.checkCoverage(root);
        if (jsonMode) { io.writeResult(result); } else {
          if (result.success) {
            console.log(chalk.bold(`\n🧪 Test Coverage vs Acceptance Criteria: ${result.coverage}%`));
            console.log(`  Total criteria: ${result.total_criteria}  Covered: ${result.covered}`);
          } else { console.log(chalk.yellow(`  ${result.error}`)); }
          console.log('');
        }
      } else {
        const prdFile = path.join(root, 'specs', 'prd.md');
        if (!fs.existsSync(prdFile)) { console.error(chalk.red('PRD not found at specs/prd.md')); process.exit(1); }
        const content = fs.readFileSync(prdFile, 'utf8');
        const criteria = lib.extractCriteria(content);
        const result = lib.generateTestStubs(criteria);
        if (jsonMode) { io.writeResult(result); } else {
          console.log(chalk.bold(`\n🧪 Test Generator: ${result.test_files} files from ${result.total_criteria} criteria\n`));
        }
      }
      return;
    }

    // ── Feature 45: Contract First ───────────────────────────────────────────
    if (subcommand === 'contract-first') {
      const lib = require('./lib/contract-first');
      const action = process.argv[3] || 'extract';
      const jsonMode = process.argv.includes('--json');
      const io = require('./lib/io');
      const root = process.cwd();
      if (action === 'verify') {
        const result = lib.verifyCompliance(root);
        if (jsonMode) { io.writeResult(result); } else {
          console.log(chalk.bold(`\n📝 Contract Compliance: ${result.compliance}%`));
          console.log(`  Contracts: ${result.total_contracts}  Implemented: ${result.implemented}  Violations: ${result.violations}\n`);
        }
      } else {
        const result = lib.extractContracts(root);
        if (jsonMode) { io.writeResult(result); } else {
          console.log(chalk.bold(`\n📝 Contracts Found: ${result.total_contracts}`));
          for (const c of (result.contracts || [])) console.log(`  ${c.type}: ${c.method || ''} ${c.path || c.name}`);
          console.log('');
        }
      }
      return;
    }

    // ── Feature 46: Runtime Debugger ─────────────────────────────────────────
    if (subcommand === 'runtime-debugger') {
      const lib = require('./lib/runtime-debugger');
      const action = process.argv[3] || 'analyze';
      const jsonMode = process.argv.includes('--json');
      const io = require('./lib/io');
      const filePath = process.argv[4];
      if (!filePath) { console.error(chalk.red('Usage: jumpstart-mode runtime-debugger analyze <log-file>')); process.exit(1); }
      const result = lib.analyzeLogFile(filePath);
      if (jsonMode) { io.writeResult(result); } else {
        if (result.success) {
          console.log(chalk.bold(`\n🐛 Log Analysis: ${result.total_findings} findings`));
          console.log(`  Errors: ${result.summary.errors}  Warnings: ${result.summary.warnings}  Exceptions: ${result.summary.exceptions}\n`);
        } else { console.log(chalk.red(`❌ ${result.error}`)); }
      }
      return;
    }

    // ── Feature 47: Migration Planner ────────────────────────────────────────
    if (subcommand === 'migration-planner') {
      const lib = require('./lib/migration-planner');
      const action = process.argv[3] || 'report';
      const jsonMode = process.argv.includes('--json');
      const io = require('./lib/io');
      const stateFile = path.join(process.cwd(), '.jumpstart', 'state', 'migration-plan.json');
      const result = lib.generateReport({ stateFile });
      if (jsonMode) { io.writeResult(result); } else {
        console.log(chalk.bold(`\n🔄 Migration Planner: ${result.total_migrations} migrations\n`));
      }
      return;
    }

    // ── Feature 48: Legacy Modernizer ────────────────────────────────────────
    if (subcommand === 'legacy-modernizer') {
      const lib = require('./lib/legacy-modernizer');
      const action = process.argv[3] || 'report';
      const jsonMode = process.argv.includes('--json');
      const io = require('./lib/io');
      const stateFile = path.join(process.cwd(), '.jumpstart', 'state', 'legacy-modernization.json');
      const result = lib.generateReport({ stateFile });
      if (jsonMode) { io.writeResult(result); } else {
        console.log(chalk.bold(`\n🏚️ Legacy Modernizer: ${result.total_assessments} assessments, ${result.total_plans} plans\n`));
      }
      return;
    }

    // ── Feature 49: DB Evolution ─────────────────────────────────────────────
    if (subcommand === 'db-evolution') {
      const lib = require('./lib/db-evolution');
      const action = process.argv[3] || 'report';
      const jsonMode = process.argv.includes('--json');
      const io = require('./lib/io');
      const stateFile = path.join(process.cwd(), '.jumpstart', 'state', 'db-evolution.json');
      const result = lib.generateReport({ stateFile });
      if (jsonMode) { io.writeResult(result); } else {
        console.log(chalk.bold(`\n🗄️ DB Evolution: ${result.total_migrations} migrations\n`));
      }
      return;
    }

    // ── Feature 50: Safe Rename ──────────────────────────────────────────────
    if (subcommand === 'safe-rename') {
      const lib = require('./lib/safe-rename');
      const action = process.argv[3] || 'plan';
      const jsonMode = process.argv.includes('--json');
      const io = require('./lib/io');
      const root = process.cwd();
      if (action === 'plan') {
        const oldPath = process.argv[4];
        const newPath = process.argv[5];
        if (!oldPath || !newPath) { console.error(chalk.red('Usage: jumpstart-mode safe-rename plan <old-path> <new-path>')); process.exit(1); }
        const result = lib.planRename(root, oldPath, newPath);
        if (jsonMode) { io.writeResult(result); } else {
          console.log(chalk.bold(`\n📦 Safe Rename: ${oldPath} → ${newPath}`));
          console.log(`  References: ${result.references_found}  Files affected: ${result.affected_files.length}\n`);
        }
      } else if (action === 'validate') {
        const oldPath = process.argv[4];
        const newPath = process.argv[5];
        if (!oldPath || !newPath) { console.error(chalk.red('Usage: jumpstart-mode safe-rename validate <old-path> <new-path>')); process.exit(1); }
        const result = lib.validateRename(root, oldPath, newPath);
        if (jsonMode) { io.writeResult(result); } else {
          console.log(result.clean ? chalk.green('✅ Rename validated') : chalk.yellow(`⚠️ ${result.stale_references} stale references found`));
        }
      }
      return;
    }

    // ── Feature 51: Dependency Upgrade ───────────────────────────────────────
    if (subcommand === 'dependency-upgrade') {
      const lib = require('./lib/dependency-upgrade');
      const action = process.argv[3] || 'report';
      const jsonMode = process.argv.includes('--json');
      const io = require('./lib/io');
      const root = process.cwd();
      if (action === 'scan') {
        const result = lib.scanUpgrades(root);
        if (jsonMode) { io.writeResult(result); } else {
          console.log(chalk.bold(`\n📦 Dependency Scan: ${result.total} dependencies\n`));
        }
      } else {
        const stateFile = path.join(root, '.jumpstart', 'state', 'dependency-upgrades.json');
        const result = lib.generateReport({ stateFile });
        if (jsonMode) { io.writeResult(result); } else {
          console.log(chalk.bold(`\n📦 Dependency Upgrade Report: ${result.total_plans} plans\n`));
        }
      }
      return;
    }

    // ── Feature 52: Incident Feedback ────────────────────────────────────────
    if (subcommand === 'incident-feedback') {
      const lib = require('./lib/incident-feedback');
      const action = process.argv[3] || 'report';
      const jsonMode = process.argv.includes('--json');
      const io = require('./lib/io');
      const stateFile = path.join(process.cwd(), '.jumpstart', 'state', 'incidents.json');
      if (action === 'log') {
        const title = process.argv[4];
        const severity = process.argv[5] || 'sev3';
        if (!title) { console.error(chalk.red('Usage: jumpstart-mode incident-feedback log <title> [severity]')); process.exit(1); }
        const result = lib.logIncident({ title, severity, description: title }, { stateFile });
        if (jsonMode) { io.writeResult(result); } else {
          console.log(result.success ? chalk.green(`✅ Incident logged: ${result.incident.id}`) : chalk.red(`❌ ${result.error}`));
        }
      } else {
        const result = lib.generateReport({ stateFile });
        if (jsonMode) { io.writeResult(result); } else {
          console.log(chalk.bold(`\n🚨 Incident Feedback: ${result.total_incidents} incidents, ${result.total_spec_updates} spec updates\n`));
        }
      }
      return;
    }

    // ── Feature 53: Context Chunker ──────────────────────────────────────────
    if (subcommand === 'context-chunker') {
      const lib = require('./lib/context-chunker');
      const jsonMode = process.argv.includes('--json');
      const io = require('./lib/io');
      const root = process.cwd();
      const result = lib.chunkImplementationPlan(root);
      if (jsonMode) { io.writeResult(result); } else {
        if (result.success) {
          console.log(chalk.bold(`\n📦 Context Chunking: ${result.total_sections} sections, ${result.total_tokens} tokens`));
          for (const r of result.model_recommendations) {
            console.log(`  ${r.model}: ${r.fits_in_single_call ? '✅ fits' : `needs ${r.chunks_needed} chunks`}`);
          }
        } else { console.log(chalk.yellow(`  ${result.error}`)); }
        console.log('');
      }
      return;
    }

    // ── Feature 54: Model Router ─────────────────────────────────────────────
    if (subcommand === 'model-router') {
      const lib = require('./lib/model-router');
      const action = process.argv[3] || 'report';
      const jsonMode = process.argv.includes('--json');
      const io = require('./lib/io');
      if (action === 'route') {
        const taskType = process.argv[4];
        if (!taskType) { console.error(chalk.red('Usage: jumpstart-mode model-router route <task-type>')); process.exit(1); }
        const result = lib.routeTask(taskType);
        if (jsonMode) { io.writeResult(result); } else {
          console.log(result.success ? chalk.green(`✅ Route: ${taskType} → ${result.model} (${result.reason})`) : chalk.red(`❌ ${result.error}`));
        }
      } else {
        const result = lib.generateReport();
        if (jsonMode) { io.writeResult(result); } else {
          console.log(chalk.bold(`\n🔀 Model Router: ${result.unique_models} models across ${result.task_types} task types\n`));
        }
      }
      return;
    }

    // ── Feature 55: Cost Router ──────────────────────────────────────────────
    if (subcommand === 'cost-router') {
      const lib = require('./lib/cost-router');
      const action = process.argv[3] || 'report';
      const jsonMode = process.argv.includes('--json');
      const io = require('./lib/io');
      if (action === 'route') {
        const result = lib.routeByCost({ type: process.argv[4] || 'coding' });
        if (jsonMode) { io.writeResult(result); } else {
          console.log(chalk.green(`✅ Cost route: ${result.selected_model} ($${result.estimated_cost})`));
        }
      } else {
        const result = lib.generateReport();
        if (jsonMode) { io.writeResult(result); } else {
          console.log(chalk.bold(`\n💵 Cost Router: ${result.budget_profile} profile, $${result.total_cost} total\n`));
        }
      }
      return;
    }

    // ── Feature 56: Deterministic Artifacts ──────────────────────────────────
    if (subcommand === 'deterministic') {
      const lib = require('./lib/deterministic-artifacts');
      const action = process.argv[3] || 'normalize';
      const jsonMode = process.argv.includes('--json');
      const io = require('./lib/io');
      const root = process.cwd();
      if (action === 'verify') {
        const file1 = process.argv[4];
        const file2 = process.argv[5];
        if (!file1 || !file2) { console.error(chalk.red('Usage: jumpstart-mode deterministic verify <file1> <file2>')); process.exit(1); }
        const result = lib.verifyStability(file1, file2);
        if (jsonMode) { io.writeResult(result); } else {
          console.log(result.identical ? chalk.green('✅ Files are identical') : chalk.yellow(`⚠️ ${result.similarity}% similar (${result.diff_lines} diff lines)`));
        }
      } else {
        const result = lib.normalizeSpecs(root, { write: process.argv.includes('--write') });
        if (jsonMode) { io.writeResult(result); } else {
          console.log(chalk.bold(`\n📐 Normalized ${result.files} spec files (${result.modified} modified)\n`));
        }
      }
      return;
    }

    // ── Feature 57: Agent Checkpoint ─────────────────────────────────────────
    if (subcommand === 'agent-checkpoint') {
      const lib = require('./lib/agent-checkpoint');
      const action = process.argv[3] || 'list';
      const jsonMode = process.argv.includes('--json');
      const io = require('./lib/io');
      const stateFile = path.join(process.cwd(), '.jumpstart', 'state', 'agent-checkpoints.json');
      if (action === 'save') {
        const agent = process.argv[4] || 'cli';
        const result = lib.saveCheckpoint({ agent, type: 'manual' }, { stateFile });
        if (jsonMode) { io.writeResult(result); } else {
          console.log(chalk.green(`✅ Checkpoint saved: ${result.checkpoint.id}`));
        }
      } else if (action === 'restore') {
        const cpId = process.argv[4];
        const result = lib.restoreCheckpoint(cpId, { stateFile });
        if (jsonMode) { io.writeResult(result); } else {
          console.log(result.success ? chalk.green(`✅ Restored: ${result.checkpoint.id}`) : chalk.red(`❌ ${result.error}`));
        }
      } else if (action === 'clean') {
        const result = lib.cleanCheckpoints({ stateFile });
        if (jsonMode) { io.writeResult(result); } else {
          console.log(chalk.green(`✅ Cleaned ${result.removed} checkpoints, ${result.remaining} remaining`));
        }
      } else {
        const result = lib.listCheckpoints({}, { stateFile });
        if (jsonMode) { io.writeResult(result); } else {
          console.log(chalk.bold(`\n💾 Checkpoints (${result.total})`));
          for (const c of result.checkpoints) console.log(`  ${c.id}: ${c.agent} ${c.phase || ''} (${c.saved_at})`);
          console.log('');
        }
      }
      return;
    }

    // ── Feature 58: Tool Guardrails ──────────────────────────────────────────
    if (subcommand === 'tool-guardrails') {
      const lib = require('./lib/tool-guardrails');
      const action = process.argv[3] || 'check';
      const jsonMode = process.argv.includes('--json');
      const io = require('./lib/io');
      const operation = process.argv[4];
      if (!operation) { console.error(chalk.red('Usage: jumpstart-mode tool-guardrails check <operation>')); process.exit(1); }
      const result = lib.checkOperation(operation);
      if (jsonMode) { io.writeResult(result); } else {
        console.log(result.allowed ? chalk.green(`✅ Operation allowed (${result.risk_level})`) : chalk.red(`❌ Operation blocked (${result.risk_level})`));
        for (const v of result.violations) console.log(`  ⚠️ ${v.description}`);
      }
      return;
    }

    // ── Feature 59: Root Cause Analysis ──────────────────────────────────────
    if (subcommand === 'root-cause') {
      const lib = require('./lib/root-cause-analysis');
      const jsonMode = process.argv.includes('--json');
      const io = require('./lib/io');
      const filePath = process.argv[4] || process.argv[3];
      if (!filePath || filePath === 'analyze' || filePath === 'report') {
        console.error(chalk.red('Usage: jumpstart-mode root-cause <output-file>'));
        process.exit(1);
      }
      const result = lib.analyzeTestFile(filePath);
      if (jsonMode) { io.writeResult(result); } else {
        if (result.success) {
          console.log(chalk.bold(`\n🔍 Root Cause Analysis: ${result.total_hypotheses} hypotheses`));
          if (result.hypotheses.length > 0) {
            console.log(`  Primary: ${result.hypotheses[0].category} — ${result.hypotheses[0].suggested_fix}`);
          }
          for (const a of (result.hypotheses || []).slice(0, 5)) console.log(`  ${a.category}: ${a.detail.substring(0, 80)}`);
        } else { console.log(chalk.red(`❌ ${result.error}`)); }
        console.log('');
      }
      return;
    }

    // ── Feature 60: Quality Graph ────────────────────────────────────────────
    if (subcommand === 'quality-graph') {
      const lib = require('./lib/quality-graph');
      const jsonMode = process.argv.includes('--json');
      const io = require('./lib/io');
      const root = process.cwd();
      const result = lib.scanQuality(root);
      if (jsonMode) { io.writeResult(result); } else {
        console.log(chalk.bold(`\n📊 Code Quality Graph: ${result.total_files} files`));
        console.log(`  Average score: ${result.summary.average_score}%`);
        console.log(`  Critical hotspots: ${result.summary.critical_hotspots}  High risk: ${result.summary.high_risk}`);
        if (result.hotspots.length > 0) {
          console.log('  Top hotspots:');
          for (const h of result.hotspots.slice(0, 5)) console.log(`    ${h.file}: ${h.overall_score}% (${h.total_lines} lines, depth=${h.max_nesting_depth})`);
        }
        console.log('');
      }
      return;
    }

    // ─── Item 61: Web Dashboard ──────────────────────────────────────────────
    if (subcommand === 'web-dashboard') {
      const lib = require('./lib/web-dashboard');
      const jsonMode = process.argv.includes('--json');
      const io = require('./lib/io');
      const root = process.cwd();
      const action = process.argv[3] || 'data';
      if (action === 'config') {
        const result = lib.generateConfig(root, { port: parseInt(process.argv[4]) || undefined });
        if (jsonMode) { io.writeResult(result); } else {
          console.log(chalk.bold('\n🖥️  Dashboard Configuration'));
          console.log(`  Port: ${result.config.port}  Host: ${result.config.host}`);
          console.log(`  Sections: ${result.config.sections.join(', ')}\n`);
        }
      } else if (action === 'status') {
        const result = lib.getServerStatus();
        if (jsonMode) { io.writeResult(result); } else {
          console.log(chalk.bold('\n🖥️  Dashboard Status'));
          console.log(`  Running: ${result.running}  Port: ${result.port}\n`);
        }
      } else {
        const result = lib.gatherDashboardData(root);
        if (jsonMode) { io.writeResult(result); } else {
          console.log(chalk.bold('\n🖥️  Dashboard Data'));
          console.log(`  Phase: ${result.sections.phases.current_phase}  Artifacts: ${result.sections.artifacts.total}\n`);
        }
      }
      return;
    }

    // ─── Item 62: Role Views ─────────────────────────────────────────────────
    if (subcommand === 'role-views') {
      const lib = require('./lib/role-views');
      const jsonMode = process.argv.includes('--json');
      const io = require('./lib/io');
      const root = process.cwd();
      const action = process.argv[3] || 'list';
      if (action === 'list') {
        const result = lib.listRoles();
        if (jsonMode) { io.writeResult(result); } else {
          console.log(chalk.bold('\n👥 Available Roles'));
          for (const r of result.roles) console.log(`  ${r.id}: ${r.label} — focus: ${r.focus.join(', ')}`);
          console.log('');
        }
      } else if (action === 'generate') {
        const role = process.argv[4] || 'engineer';
        const result = lib.generateView(root, role);
        if (jsonMode) { io.writeResult(result); } else {
          if (!result.success) { console.log(chalk.red(`\n❌ ${result.error}\n`)); } else {
            console.log(chalk.bold(`\n👤 ${result.view.label}`));
            console.log(`  Focus: ${result.view.focus_areas.join(', ')}`);
            console.log(`  Phase: ${result.view.sections.phase_status.current_phase}\n`);
          }
        }
      }
      return;
    }

    // ─── Item 63: Spec Comments ──────────────────────────────────────────────
    if (subcommand === 'spec-comments') {
      const lib = require('./lib/spec-comments');
      const jsonMode = process.argv.includes('--json');
      const io = require('./lib/io');
      const action = process.argv[3] || 'list';
      if (action === 'add') {
        const artifact = process.argv[4]; const text = process.argv[5];
        const result = lib.addComment(artifact, null, text);
        if (jsonMode) { io.writeResult(result); } else {
          if (result.success) console.log(chalk.green(`\n✅ Comment ${result.comment.id} added to ${artifact}\n`));
          else console.log(chalk.red(`\n❌ ${result.error}\n`));
        }
      } else if (action === 'resolve') {
        const commentId = process.argv[4]; const resolution = process.argv[5];
        const result = lib.resolveComment(commentId, resolution);
        if (jsonMode) { io.writeResult(result); } else {
          if (result.success) console.log(chalk.green(`\n✅ Comment ${commentId} resolved\n`));
          else console.log(chalk.red(`\n❌ ${result.error}\n`));
        }
      } else {
        const result = lib.listComments({ status: process.argv[4] });
        if (jsonMode) { io.writeResult(result); } else {
          console.log(chalk.bold(`\n💬 Spec Comments (${result.total})`));
          for (const c of result.comments) console.log(`  [${c.status}] ${c.id}: ${c.text.substring(0, 60)}`);
          console.log('');
        }
      }
      return;
    }

    // ─── Item 64: Workshop Mode ──────────────────────────────────────────────
    if (subcommand === 'workshop-mode') {
      const lib = require('./lib/workshop-mode');
      const jsonMode = process.argv.includes('--json');
      const io = require('./lib/io');
      const action = process.argv[3] || 'status';
      if (action === 'start') {
        const name = process.argv[4] || 'Workshop';
        const result = lib.startSession(name);
        if (jsonMode) { io.writeResult(result); } else {
          if (result.success) console.log(chalk.green(`\n✅ Workshop ${result.session.id} started: ${name}\n`));
          else console.log(chalk.red(`\n❌ ${result.error}\n`));
        }
      } else {
        const result = lib.getSessionStatus();
        if (jsonMode) { io.writeResult(result); } else {
          console.log(chalk.bold(`\n🎯 Workshop Sessions (${result.total_sessions})`));
          for (const s of result.sessions) console.log(`  ${s.id}: ${s.name} [${s.status}] (${s.captures} captures)`);
          console.log('');
        }
      }
      return;
    }

    // ─── Item 65: Collaboration ──────────────────────────────────────────────
    if (subcommand === 'collaboration') {
      const lib = require('./lib/collaboration');
      const jsonMode = process.argv.includes('--json');
      const io = require('./lib/io');
      const action = process.argv[3] || 'status';
      if (action === 'create') {
        const name = process.argv[4] || 'Session';
        const result = lib.createSession(name);
        if (jsonMode) { io.writeResult(result); } else {
          if (result.success) console.log(chalk.green(`\n✅ Collaboration ${result.session.id} created\n`));
          else console.log(chalk.red(`\n❌ ${result.error}\n`));
        }
      } else {
        const result = lib.getStatus();
        if (jsonMode) { io.writeResult(result); } else {
          console.log(chalk.bold(`\n🤝 Collaboration Status`));
          console.log(`  Active sessions: ${result.active_sessions}  Active locks: ${result.active_locks}\n`);
        }
      }
      return;
    }

    // ─── Item 66: Structured Elicitation ─────────────────────────────────────
    if (subcommand === 'elicitation') {
      const lib = require('./lib/structured-elicitation');
      const jsonMode = process.argv.includes('--json');
      const io = require('./lib/io');
      const action = process.argv[3] || 'start';
      if (action === 'start') {
        const domain = process.argv[4] || 'general';
        const result = lib.startElicitation(domain);
        if (jsonMode) { io.writeResult(result); } else {
          if (result.success) {
            console.log(chalk.green(`\n✅ Elicitation ${result.session.id} started for domain: ${domain}`));
            console.log(`  Questions: ${result.session.questions.length}\n`);
          } else console.log(chalk.red(`\n❌ ${result.error}\n`));
        }
      } else if (action === 'report') {
        const sessionId = process.argv[4];
        const result = lib.generateReport(sessionId);
        if (jsonMode) { io.writeResult(result); } else {
          if (result.success) {
            console.log(chalk.bold(`\n📋 Elicitation Report: ${result.completion_pct}% complete`));
            console.log(`  Answered: ${result.answered}/${result.total_questions}\n`);
          } else console.log(chalk.red(`\n❌ ${result.error}\n`));
        }
      }
      return;
    }

    // ─── Item 67: Enterprise Templates ───────────────────────────────────────
    if (subcommand === 'enterprise-templates') {
      const lib = require('./lib/enterprise-templates');
      const jsonMode = process.argv.includes('--json');
      const io = require('./lib/io');
      const action = process.argv[3] || 'list';
      if (action === 'list') {
        const result = lib.listTemplates();
        if (jsonMode) { io.writeResult(result); } else {
          console.log(chalk.bold('\n🏢 Enterprise Templates'));
          for (const t of result.templates) console.log(`  ${t.id}: ${t.label} (${t.compliance_count} compliance, ${t.persona_count} personas)`);
          console.log('');
        }
      } else if (action === 'get') {
        const vertical = process.argv[4];
        const result = lib.getTemplate(vertical);
        if (jsonMode) { io.writeResult(result); } else {
          if (result.success) {
            console.log(chalk.bold(`\n🏢 ${result.template.label}`));
            console.log(`  Compliance: ${result.template.compliance.join(', ')}`);
            console.log(`  Personas: ${result.template.personas.join(', ')}\n`);
          } else console.log(chalk.red(`\n❌ ${result.error}\n`));
        }
      } else if (action === 'apply') {
        const vertical = process.argv[4];
        const result = lib.applyTemplate(process.cwd(), vertical);
        if (jsonMode) { io.writeResult(result); } else {
          if (result.success) console.log(chalk.green(`\n✅ Template ${result.applied.label} applied\n`));
          else console.log(chalk.red(`\n❌ ${result.error}\n`));
        }
      }
      return;
    }

    // ─── Item 68: Playback Summaries ─────────────────────────────────────────
    if (subcommand === 'playback-summaries') {
      const lib = require('./lib/playback-summaries');
      const jsonMode = process.argv.includes('--json');
      const io = require('./lib/io');
      const action = process.argv[3] || 'list';
      if (action === 'generate') {
        const audience = process.argv[4] || 'executive';
        const result = lib.generateSummary(process.cwd(), audience);
        if (jsonMode) { io.writeResult(result); } else {
          if (result.success) {
            console.log(chalk.bold(`\n📣 ${result.summary.label}`));
            console.log(`  Tone: ${result.summary.tone}  Focus: ${result.summary.focus_areas.join(', ')}\n`);
          } else console.log(chalk.red(`\n❌ ${result.error}\n`));
        }
      } else {
        const result = lib.listAudiences();
        if (jsonMode) { io.writeResult(result); } else {
          console.log(chalk.bold('\n📣 Available Audiences'));
          for (const a of result.audiences) console.log(`  ${a.id}: ${a.label} (${a.tone})`);
          console.log('');
        }
      }
      return;
    }

    // ─── Item 69: Design System ──────────────────────────────────────────────
    if (subcommand === 'design-system') {
      const lib = require('./lib/design-system');
      const jsonMode = process.argv.includes('--json');
      const io = require('./lib/io');
      const action = process.argv[3] || 'report';
      if (action === 'check') {
        const result = lib.checkCompliance();
        if (jsonMode) { io.writeResult(result); } else {
          console.log(chalk.bold('\n🎨 Design System Compliance'));
          console.log(`  Compliant: ${result.compliant}  Issues: ${result.issues.length}\n`);
        }
      } else {
        const result = lib.generateReport();
        if (jsonMode) { io.writeResult(result); } else {
          console.log(chalk.bold('\n🎨 Design System Report'));
          console.log(`  Components: ${result.components}  Level: ${result.accessibility_level}\n`);
        }
      }
      return;
    }

    // ─── Item 70: Diagram Studio ─────────────────────────────────────────────
    if (subcommand === 'diagram-studio') {
      const lib = require('./lib/diagram-studio');
      const jsonMode = process.argv.includes('--json');
      const io = require('./lib/io');
      const action = process.argv[3] || 'list';
      if (action === 'generate') {
        const type = process.argv[4] || 'sequence';
        const result = lib.generateDiagram(type);
        if (jsonMode) { io.writeResult(result); } else {
          if (result.success) { console.log(chalk.bold(`\n📐 Diagram: ${type}`)); console.log(result.content + '\n'); }
          else console.log(chalk.red(`\n❌ ${result.error}\n`));
        }
      } else if (action === 'validate') {
        const file = process.argv[4];
        if (file && fs.existsSync(file)) {
          const content = fs.readFileSync(file, 'utf8');
          const result = lib.validateDiagram(content);
          if (jsonMode) { io.writeResult(result); } else {
            console.log(chalk.bold(`\n📐 Diagram Validation: ${result.valid ? 'Valid' : 'Issues Found'}`));
            for (const i of result.issues) console.log(`  [${i.type}] ${i.message}`);
            console.log('');
          }
        } else console.log(chalk.red('\n❌ File path required for validate\n'));
      } else {
        const result = lib.listDiagramTypes();
        if (jsonMode) { io.writeResult(result); } else {
          console.log(chalk.bold('\n📐 Diagram Types'));
          for (const t of result.types) console.log(`  ${t}`);
          console.log('');
        }
      }
      return;
    }

    // ─── Item 71: Ambiguity Heatmap ──────────────────────────────────────────
    if (subcommand === 'ambiguity-heatmap') {
      const lib = require('./lib/ambiguity-heatmap');
      const jsonMode = process.argv.includes('--json');
      const io = require('./lib/io');
      const action = process.argv[3] || 'report';
      if (action === 'scan') {
        const file = process.argv[4];
        if (file) {
          const result = lib.scanFile(file);
          if (jsonMode) { io.writeResult(result); } else {
            if (result.success) {
              console.log(chalk.bold(`\n🔥 Ambiguity Scan: ${result.total_findings} findings`));
              console.log(`  Vague terms: ${result.metrics.vague_terms}  Missing constraints: ${result.metrics.missing_constraints}  Density: ${result.metrics.ambiguity_density}%\n`);
            } else console.log(chalk.red(`\n❌ ${result.error}\n`));
          }
        } else console.log(chalk.red('\n❌ File path required for scan\n'));
      } else {
        const result = lib.generateHeatmap(process.cwd());
        if (jsonMode) { io.writeResult(result); } else {
          console.log(chalk.bold(`\n🔥 Ambiguity Heatmap: ${result.files_scanned} files`));
          console.log(`  Total findings: ${result.overall.total_findings}\n`);
        }
      }
      return;
    }

    // ─── Item 72: Estimation Studio ──────────────────────────────────────────
    if (subcommand === 'estimation-studio') {
      const lib = require('./lib/estimation-studio');
      const jsonMode = process.argv.includes('--json');
      const io = require('./lib/io');
      const action = process.argv[3] || 'report';
      if (action === 'estimate') {
        const name = process.argv[4]; const size = process.argv[5];
        const result = lib.estimateFeature(name, size);
        if (jsonMode) { io.writeResult(result); } else {
          if (result.success) {
            console.log(chalk.bold(`\n📊 Estimate: ${name}`));
            console.log(`  Size: ${result.estimate.tshirt_size}  Points: ${result.estimate.story_points}  Days: ${result.estimate.ideal_days}`);
            console.log(`  ROM: $${result.estimate.rom_cost.min}–$${result.estimate.rom_cost.max}\n`);
          } else console.log(chalk.red(`\n❌ ${result.error}\n`));
        }
      } else {
        const result = lib.generateReport();
        if (jsonMode) { io.writeResult(result); } else {
          console.log(chalk.bold(`\n📊 Estimation Report: ${result.total_features} features`));
          console.log(`  Total points: ${result.total_story_points}  Total days: ${result.total_ideal_days}\n`);
        }
      }
      return;
    }

    // ─── Item 73: Guided Handoff ─────────────────────────────────────────────
    if (subcommand === 'guided-handoff') {
      const lib = require('./lib/guided-handoff');
      const jsonMode = process.argv.includes('--json');
      const io = require('./lib/io');
      const action = process.argv[3] || 'list';
      if (action === 'generate') {
        const type = process.argv[4] || 'product-to-engineering';
        const result = lib.generateHandoff(type, process.cwd());
        if (jsonMode) { io.writeResult(result); } else {
          if (result.success) {
            console.log(chalk.bold(`\n📦 Handoff: ${result.label}`));
            console.log(`  Complete: ${result.complete}  Missing: ${result.missing_required.join(', ') || 'none'}\n`);
          } else console.log(chalk.red(`\n❌ ${result.error}\n`));
        }
      } else {
        const result = lib.listHandoffTypes();
        if (jsonMode) { io.writeResult(result); } else {
          console.log(chalk.bold('\n📦 Handoff Types'));
          for (const t of result.types) console.log(`  ${t.id}: ${t.label} (${t.required_count} required, ${t.optional_count} optional)`);
          console.log('');
        }
      }
      return;
    }

    // ─── Item 74: Transcript Ingestion ───────────────────────────────────────
    if (subcommand === 'transcript-ingestion') {
      const lib = require('./lib/transcript-ingestion');
      const jsonMode = process.argv.includes('--json');
      const io = require('./lib/io');
      const action = process.argv[3] || 'list';
      if (action === 'ingest') {
        const file = process.argv[4];
        if (file && fs.existsSync(file)) {
          const text = fs.readFileSync(file, 'utf8');
          const result = lib.ingestTranscript(text, { title: path.basename(file) });
          if (jsonMode) { io.writeResult(result); } else {
            if (result.success) {
              console.log(chalk.green(`\n✅ Transcript ingested: ${result.transcript.id}`));
              console.log(`  Actions: ${result.transcript.actions.length}  Decisions: ${result.transcript.decisions.length}\n`);
            }
          }
        } else console.log(chalk.red('\n❌ File path required for ingest\n'));
      } else {
        const result = lib.listTranscripts();
        if (jsonMode) { io.writeResult(result); } else {
          console.log(chalk.bold(`\n🎙️  Transcripts (${result.total})`));
          for (const t of result.transcripts) console.log(`  ${t.id}: ${t.title} (${t.actions} actions, ${t.decisions} decisions)`);
          console.log('');
        }
      }
      return;
    }

    // ─── Item 75: Chat Integration ───────────────────────────────────────────
    if (subcommand === 'chat-integration') {
      const lib = require('./lib/chat-integration');
      const jsonMode = process.argv.includes('--json');
      const io = require('./lib/io');
      const action = process.argv[3] || 'status';
      if (action === 'configure') {
        const platform = process.argv[4] || 'slack';
        const result = lib.configure(platform);
        if (jsonMode) { io.writeResult(result); } else {
          if (result.success) console.log(chalk.green(`\n✅ ${platform} integration configured: ${result.configuration.id}\n`));
          else console.log(chalk.red(`\n❌ ${result.error}\n`));
        }
      } else if (action === 'notify') {
        const eventType = process.argv[4]; const message = process.argv[5];
        const result = lib.queueNotification(eventType, message);
        if (jsonMode) { io.writeResult(result); } else {
          if (result.success) console.log(chalk.green(`\n✅ Notification queued: ${result.notification.id}\n`));
          else console.log(chalk.red(`\n❌ ${result.error}\n`));
        }
      } else {
        const result = lib.getStatus();
        if (jsonMode) { io.writeResult(result); } else {
          console.log(chalk.bold('\n💬 Chat Integration Status'));
          console.log(`  Configurations: ${result.configurations}  Active: ${result.active}  Queued: ${result.notifications_queued}\n`);
        }
      }
      return;
    }

    // ─── Item 76: Context Onboarding ─────────────────────────────────────────
    if (subcommand === 'context-onboarding') {
      const lib = require('./lib/context-onboarding');
      const jsonMode = process.argv.includes('--json');
      const io = require('./lib/io');
      const role = process.argv[3] || 'engineer';
      const result = lib.generateOnboarding(process.cwd(), { role });
      if (jsonMode) { io.writeResult(result); } else {
        if (result.success) {
          const ob = result.onboarding;
          console.log(chalk.bold(`\n🎓 Onboarding Package (${ob.role})`));
          console.log(`  Decisions: ${ob.sections.decisions.total}  Risks: ${ob.sections.risks.total}`);
          console.log(`  Specs: ${ob.sections.specs.total}  Phase: ${ob.sections.project_status.current_phase}\n`);
        }
      }
      return;
    }

    // ─── Item 77: Promptless Mode ────────────────────────────────────────────
    if (subcommand === 'promptless-mode') {
      const lib = require('./lib/promptless-mode');
      const jsonMode = process.argv.includes('--json');
      const io = require('./lib/io');
      const action = process.argv[3] || 'status';
      if (action === 'start') {
        const wizard = process.argv[4] || 'new-project';
        const result = lib.startWizard(wizard);
        if (jsonMode) { io.writeResult(result); } else {
          if (result.success) {
            console.log(chalk.green(`\n✅ Wizard started: ${result.session.id}`));
            if (result.next_step) console.log(`  Next: ${result.next_step.prompt}`);
            console.log('');
          } else console.log(chalk.red(`\n❌ ${result.error}\n`));
        }
      } else {
        const result = lib.getWizardStatus();
        if (jsonMode) { io.writeResult(result); } else {
          console.log(chalk.bold('\n🧙 Promptless Mode'));
          console.log(`  Available wizards: ${result.available_wizards.join(', ')}`);
          for (const s of result.sessions) console.log(`  ${s.id}: ${s.wizard} [${s.status}] (${s.progress})`);
          console.log('');
        }
      }
      return;
    }

    // ─── Item 78: Artifact Comparison ────────────────────────────────────────
    if (subcommand === 'artifact-comparison') {
      const lib = require('./lib/artifact-comparison');
      const jsonMode = process.argv.includes('--json');
      const io = require('./lib/io');
      const action = process.argv[3] || 'history';
      if (action === 'compare') {
        const fileA = process.argv[4]; const fileB = process.argv[5];
        if (fileA && fileB) {
          const result = lib.compareFiles(fileA, fileB);
          if (jsonMode) { io.writeResult(result); } else {
            if (result.success) {
              console.log(chalk.bold(`\n📄 Artifact Comparison: ${result.total_changes} changes`));
              console.log(`  Lines: ${result.lines_before} → ${result.lines_after} (${result.line_diff >= 0 ? '+' : ''}${result.line_diff})`);
              for (const c of result.changes) console.log(`  [${c.type}] ${c.summary}`);
              console.log('');
            } else console.log(chalk.red(`\n❌ ${result.error}\n`));
          }
        } else console.log(chalk.red('\n❌ Two file paths required for compare\n'));
      } else {
        const artifact = process.argv[4] || 'prd.md';
        const result = lib.getArtifactHistory(process.cwd(), artifact);
        if (jsonMode) { io.writeResult(result); } else {
          console.log(chalk.bold(`\n📄 Artifact History: ${result.artifact}`));
          console.log(`  Versions: ${result.versions}\n`);
        }
      }
      return;
    }

    // ─── Item 79: Workstream Ownership ───────────────────────────────────────
    if (subcommand === 'workstream-ownership') {
      const lib = require('./lib/workstream-ownership');
      const jsonMode = process.argv.includes('--json');
      const io = require('./lib/io');
      const action = process.argv[3] || 'report';
      if (action === 'define') {
        const name = process.argv[4];
        const result = lib.defineWorkstream(name, { team: process.argv[5] });
        if (jsonMode) { io.writeResult(result); } else {
          if (result.success) console.log(chalk.green(`\n✅ Workstream ${result.workstream.id} defined: ${name}\n`));
          else console.log(chalk.red(`\n❌ ${result.error}\n`));
        }
      } else {
        const result = lib.generateReport();
        if (jsonMode) { io.writeResult(result); } else {
          console.log(chalk.bold(`\n🔗 Workstream Report: ${result.total_workstreams} workstreams, ${result.total_dependencies} dependencies\n`));
        }
      }
      return;
    }

    // ─── Item 80: Persona Packs ──────────────────────────────────────────────
    if (subcommand === 'persona-packs') {
      const lib = require('./lib/persona-packs');
      const jsonMode = process.argv.includes('--json');
      const io = require('./lib/io');
      const action = process.argv[3] || 'list';
      if (action === 'get') {
        const id = process.argv[4];
        const result = lib.getPersona(id);
        if (jsonMode) { io.writeResult(result); } else {
          if (result.success) {
            console.log(chalk.bold(`\n👤 ${result.persona.label}`));
            console.log(`  Focus: ${result.persona.focus.join(', ')}`);
            console.log(`  Tools: ${result.persona.tools.join(', ')}\n`);
          } else console.log(chalk.red(`\n❌ ${result.error}\n`));
        }
      } else if (action === 'apply') {
        const id = process.argv[4];
        const result = lib.applyPersona(id);
        if (jsonMode) { io.writeResult(result); } else {
          if (result.success) console.log(chalk.green(`\n✅ Persona ${result.label} applied\n`));
          else console.log(chalk.red(`\n❌ ${result.error}\n`));
        }
      } else {
        const result = lib.listPersonas();
        if (jsonMode) { io.writeResult(result); } else {
          console.log(chalk.bold('\n👤 Persona Packs'));
          for (const p of result.personas) console.log(`  ${p.id}: ${p.label} (${p.focus_count} focus, ${p.tools_count} tools)`);
          console.log('');
        }
      }
      return;
    }

    // ─── Item 81: Knowledge Graph ────────────────────────────────────────────
    if (subcommand === 'knowledge-graph') {
      const lib = require('./lib/knowledge-graph');
      const jsonMode = process.argv.includes('--json');
      const io = require('./lib/io');
      const action = process.argv[3] || 'report';
      if (action === 'add') {
        const name = process.argv[4]; const type = process.argv[5];
        const result = lib.addNode(name, type);
        if (jsonMode) { io.writeResult(result); } else {
          if (result.success) console.log(chalk.green(`\n✅ Node ${result.node.id} added: ${name} (${type})\n`));
          else console.log(chalk.red(`\n❌ ${result.error}\n`));
        }
      } else if (action === 'query') {
        const search = process.argv[4];
        const result = lib.queryGraph({ search });
        if (jsonMode) { io.writeResult(result); } else {
          console.log(chalk.bold(`\n🧠 Knowledge Graph: ${result.nodes} nodes, ${result.edges} edges`));
          for (const n of result.results) console.log(`  ${n.id}: ${n.name} (${n.type})`);
          console.log('');
        }
      } else {
        const result = lib.generateReport();
        if (jsonMode) { io.writeResult(result); } else {
          console.log(chalk.bold(`\n🧠 Knowledge Graph Report: ${result.total_nodes} nodes, ${result.total_edges} edges\n`));
        }
      }
      return;
    }

    // ─── Item 82: Pattern Library ────────────────────────────────────────────
    if (subcommand === 'pattern-library') {
      const lib = require('./lib/pattern-library');
      const jsonMode = process.argv.includes('--json');
      const io = require('./lib/io');
      const action = process.argv[3] || 'list';
      if (action === 'register') {
        const name = process.argv[4]; const category = process.argv[5];
        const result = lib.registerPattern(name, category);
        if (jsonMode) { io.writeResult(result); } else {
          if (result.success) console.log(chalk.green(`\n✅ Pattern ${result.pattern.id} registered: ${name}\n`));
          else console.log(chalk.red(`\n❌ ${result.error}\n`));
        }
      } else if (action === 'search') {
        const query = process.argv[4];
        const result = lib.searchPatterns(query);
        if (jsonMode) { io.writeResult(result); } else {
          console.log(chalk.bold(`\n📚 Pattern Search: ${result.total} results`));
          for (const p of result.patterns) console.log(`  ${p.id}: ${p.name} (${p.category})`);
          console.log('');
        }
      } else {
        const result = lib.listPatterns();
        if (jsonMode) { io.writeResult(result); } else {
          console.log(chalk.bold(`\n📚 Pattern Library: ${result.total} patterns`));
          for (const p of result.patterns) console.log(`  ${p.id}: ${p.name} [${p.category}]`);
          console.log('');
        }
      }
      return;
    }

    // ─── Item 83: Domain Ontology ────────────────────────────────────────────
    if (subcommand === 'domain-ontology') {
      const lib = require('./lib/domain-ontology');
      const jsonMode = process.argv.includes('--json');
      const io = require('./lib/io');
      const action = process.argv[3] || 'report';
      if (action === 'define') {
        const domain = process.argv[4]; const name = process.argv[5]; const type = process.argv[6];
        const result = lib.defineElement(domain, name, type);
        if (jsonMode) { io.writeResult(result); } else {
          if (result.success) console.log(chalk.green(`\n✅ Element ${result.element.id} defined: ${name} (${type})\n`));
          else console.log(chalk.red(`\n❌ ${result.error}\n`));
        }
      } else if (action === 'query') {
        const domain = process.argv[4];
        const result = lib.queryOntology(domain);
        if (jsonMode) { io.writeResult(result); } else {
          console.log(chalk.bold(`\n🏷️  Ontology: ${result.domain} (${result.total} elements)\n`));
        }
      } else {
        const result = lib.generateReport();
        if (jsonMode) { io.writeResult(result); } else {
          console.log(chalk.bold(`\n🏷️  Domain Ontology Report: ${result.total_domains} domains\n`));
        }
      }
      return;
    }

    // ─── Item 84: Data Contracts ─────────────────────────────────────────────
    if (subcommand === 'data-contracts') {
      const lib = require('./lib/data-contracts');
      const jsonMode = process.argv.includes('--json');
      const io = require('./lib/io');
      const action = process.argv[3] || 'report';
      if (action === 'register') {
        const name = process.argv[4];
        const result = lib.registerContract(name, { field1: 'string' });
        if (jsonMode) { io.writeResult(result); } else {
          if (result.success) console.log(chalk.green(`\n✅ Contract ${result.contract.id} registered: ${name}\n`));
          else console.log(chalk.red(`\n❌ ${result.error}\n`));
        }
      } else {
        const result = lib.generateReport();
        if (jsonMode) { io.writeResult(result); } else {
          console.log(chalk.bold(`\n📜 Data Contracts: ${result.total_contracts} contracts, ${result.total_lineage} lineage entries\n`));
        }
      }
      return;
    }

    // ─── Item 85: Event Modeling ─────────────────────────────────────────────
    if (subcommand === 'event-modeling') {
      const lib = require('./lib/event-modeling');
      const jsonMode = process.argv.includes('--json');
      const io = require('./lib/io');
      const action = process.argv[3] || 'report';
      if (action === 'define') {
        const name = process.argv[4]; const type = process.argv[5] || 'topic';
        if (type === 'topic') {
          const result = lib.defineTopic(name);
          if (jsonMode) { io.writeResult(result); } else {
            if (result.success) console.log(chalk.green(`\n✅ Topic ${result.topic.id} defined: ${name}\n`));
            else console.log(chalk.red(`\n❌ ${result.error}\n`));
          }
        }
      } else {
        const result = lib.generateReport();
        if (jsonMode) { io.writeResult(result); } else {
          console.log(chalk.bold(`\n📡 Event Model: ${result.total_topics} topics, ${result.total_events} events, ${result.total_sagas} sagas\n`));
        }
      }
      return;
    }

    // ─── Item 86: Platform Engineering ───────────────────────────────────────
    if (subcommand === 'platform-engineering') {
      const lib = require('./lib/platform-engineering');
      const jsonMode = process.argv.includes('--json');
      const io = require('./lib/io');
      const action = process.argv[3] || 'report';
      if (action === 'register') {
        const name = process.argv[4]; const type = process.argv[5] || 'service';
        const result = lib.registerTemplate(name, type);
        if (jsonMode) { io.writeResult(result); } else {
          if (result.success) console.log(chalk.green(`\n✅ Template ${result.template.id} registered: ${name}\n`));
          else console.log(chalk.red(`\n❌ ${result.error}\n`));
        }
      } else if (action === 'list') {
        const result = lib.listTemplates();
        if (jsonMode) { io.writeResult(result); } else {
          console.log(chalk.bold(`\n🏗️  Platform Templates: ${result.total}`));
          for (const t of result.templates) console.log(`  ${t.id}: ${t.name} (${t.type})`);
          console.log('');
        }
      } else {
        const result = lib.generateReport();
        if (jsonMode) { io.writeResult(result); } else {
          console.log(chalk.bold(`\n🏗️  Platform Report: ${result.total_templates} templates, ${result.total_instances} instances\n`));
        }
      }
      return;
    }

    // ─── Item 90: AI Evaluation ──────────────────────────────────────────────
    if (subcommand === 'ai-evaluation') {
      const lib = require('./lib/ai-evaluation');
      const jsonMode = process.argv.includes('--json');
      const io = require('./lib/io');
      const action = process.argv[3] || 'report';
      if (action === 'evaluate') {
        const name = process.argv[4];
        const result = lib.evaluate(name, { groundedness: 80, hallucination: 90, safety: 85 });
        if (jsonMode) { io.writeResult(result); } else {
          if (result.success) {
            console.log(chalk.bold(`\n🤖 AI Evaluation: ${name}`));
            console.log(`  Overall: ${result.evaluation.overall}%\n`);
          } else console.log(chalk.red(`\n❌ ${result.error}\n`));
        }
      } else {
        const result = lib.generateReport();
        if (jsonMode) { io.writeResult(result); } else {
          console.log(chalk.bold(`\n🤖 AI Evaluation Report: ${result.total_evaluations} evaluations\n`));
        }
      }
      return;
    }

    // ─── Item 91: Prompt Governance ──────────────────────────────────────────
    if (subcommand === 'prompt-governance') {
      const lib = require('./lib/prompt-governance');
      const jsonMode = process.argv.includes('--json');
      const io = require('./lib/io');
      const action = process.argv[3] || 'list';
      if (action === 'register') {
        const name = process.argv[4]; const type = process.argv[5] || 'prompt';
        const result = lib.registerAsset(name, type, 'content');
        if (jsonMode) { io.writeResult(result); } else {
          if (result.success) console.log(chalk.green(`\n✅ Asset ${result.asset.id} registered: ${name}\n`));
          else console.log(chalk.red(`\n❌ ${result.error}\n`));
        }
      } else if (action === 'approve') {
        const assetId = process.argv[4]; const version = process.argv[5] || '1.0.0';
        const result = lib.approveVersion(assetId, version);
        if (jsonMode) { io.writeResult(result); } else {
          if (result.success) console.log(chalk.green(`\n✅ Version ${version} approved\n`));
          else console.log(chalk.red(`\n❌ ${result.error}\n`));
        }
      } else {
        const result = lib.listAssets();
        if (jsonMode) { io.writeResult(result); } else {
          console.log(chalk.bold(`\n📋 Prompt Governance: ${result.total} assets`));
          for (const a of result.assets) console.log(`  ${a.id}: ${a.name} [${a.type}] v${a.current_version}`);
          console.log('');
        }
      }
      return;
    }

    // ─── Item 94: SRE Integration ────────────────────────────────────────────
    if (subcommand === 'sre-integration') {
      const lib = require('./lib/sre-integration');
      const jsonMode = process.argv.includes('--json');
      const io = require('./lib/io');
      const action = process.argv[3] || 'report';
      if (action === 'generate') {
        const type = process.argv[4] || 'monitor';
        if (type === 'monitor') {
          const name = process.argv[5] || 'default-monitor';
          const result = lib.generateMonitor(name, 'uptime');
          if (jsonMode) { io.writeResult(result); } else {
            if (result.success) console.log(chalk.green(`\n✅ Monitor ${result.monitor.id} generated: ${name}\n`));
            else console.log(chalk.red(`\n❌ ${result.error}\n`));
          }
        } else if (type === 'alert') {
          const name = process.argv[5] || 'default-alert';
          const result = lib.generateAlert(name, 'warning');
          if (jsonMode) { io.writeResult(result); } else {
            if (result.success) console.log(chalk.green(`\n✅ Alert ${result.alert.id} generated: ${name}\n`));
            else console.log(chalk.red(`\n❌ ${result.error}\n`));
          }
        } else if (type === 'runbook') {
          const name = process.argv[5] || 'default-runbook';
          const result = lib.generateRunbook(name, ['Check status', 'Restart service', 'Verify recovery']);
          if (jsonMode) { io.writeResult(result); } else {
            if (result.success) console.log(chalk.green(`\n✅ Runbook ${result.runbook.id} generated: ${name}\n`));
            else console.log(chalk.red(`\n❌ ${result.error}\n`));
          }
        }
      } else {
        const result = lib.generateReport();
        if (jsonMode) { io.writeResult(result); } else {
          console.log(chalk.bold(`\n🔧 SRE Report: ${result.total_monitors} monitors, ${result.total_alerts} alerts, ${result.total_runbooks} runbooks\n`));
        }
      }
      return;
    }

    // ─── Item 95: Telemetry Feedback ─────────────────────────────────────────
    if (subcommand === 'telemetry-feedback') {
      const lib = require('./lib/telemetry-feedback');
      const jsonMode = process.argv.includes('--json');
      const io = require('./lib/io');
      const action = process.argv[3] || 'report';
      if (action === 'ingest') {
        const name = process.argv[4]; const type = process.argv[5]; const value = parseFloat(process.argv[6]);
        const result = lib.ingestMetric(name, type, value);
        if (jsonMode) { io.writeResult(result); } else {
          if (result.success) console.log(chalk.green(`\n✅ Metric ingested: ${result.metric.id}\n`));
          else console.log(chalk.red(`\n❌ ${result.error}\n`));
        }
      } else if (action === 'analyze') {
        const result = lib.analyzeMetrics();
        if (jsonMode) { io.writeResult(result); } else {
          console.log(chalk.bold(`\n📈 Telemetry Analysis: ${result.total_metrics} metrics\n`));
        }
      } else {
        const result = lib.generateFeedbackReport();
        if (jsonMode) { io.writeResult(result); } else {
          console.log(chalk.bold(`\n📈 Telemetry Report: ${result.total_metrics} metrics`));
          if (result.recommendations.length > 0) {
            for (const r of result.recommendations) console.log(`  ⚠️  ${r}`);
          }
          console.log('');
        }
      }
      return;
    }

    // ─── Item 96: Enterprise Search ──────────────────────────────────────────
    if (subcommand === 'enterprise-search') {
      const lib = require('./lib/enterprise-search');
      const jsonMode = process.argv.includes('--json');
      const io = require('./lib/io');
      const root = process.cwd();
      const action = process.argv[3] || 'index';
      if (action === 'search') {
        const query = process.argv[4];
        const result = lib.searchProject(root, query);
        if (jsonMode) { io.writeResult(result); } else {
          if (result.success) {
            console.log(chalk.bold(`\n🔍 Search: "${query}" — ${result.total_results} results`));
            for (const r of result.results) console.log(`  [${r.type}] ${r.path} (${r.matches} matches)`);
            console.log('');
          } else console.log(chalk.red(`\n❌ ${result.error}\n`));
        }
      } else {
        const result = lib.indexProject(root);
        if (jsonMode) { io.writeResult(result); } else {
          console.log(chalk.bold(`\n🔍 Enterprise Search Index: ${result.total_entries} entries\n`));
        }
      }
      return;
    }

    // ─── Item 40: Revert / Rollback Workflows ────────────────────────────────
    if (subcommand === 'revert') {
      const { revertArtifact } = await import('./lib/revert.js');
      const jsonMode = process.argv.includes('--json');
      const io = require('./lib/io');
      const artifactPath = process.argv[3];
      if (!artifactPath || artifactPath.startsWith('--')) {
        console.error(chalk.red('Usage: jumpstart-mode revert <artifact-path> [--reason "..."]'));
        process.exit(1);
      }
      const reasonIdx = process.argv.indexOf('--reason');
      const reason = reasonIdx > -1 ? process.argv[reasonIdx + 1] : undefined;
      const result = revertArtifact({ artifact: artifactPath, reason });
      if (jsonMode) { io.writeResult(result); } else {
        if (result.success) {
          console.log(chalk.green(`\n✅ Reverted: ${artifactPath}`));
          console.log(`  Archived to: ${result.archived_to}`);
          console.log(`  Restored from: ${result.restored_from || 'none (archive only)'}`);
          console.log(`  Reason: ${result.reason}\n`);
        } else { console.log(chalk.red(`\n❌ ${result.error}\n`)); }
      }
      return;
    }

    // ─── Item 51: ADR Index ──────────────────────────────────────────────────
    if (subcommand === 'adr') {
      const { buildIndex, searchIndex } = await import('./lib/adr-index.js');
      const jsonMode = process.argv.includes('--json');
      const io = require('./lib/io');
      const root = process.cwd();
      const action = process.argv[3] || 'build';
      if (action === 'search') {
        const query = process.argv[4] || '';
        const tag = process.argv.includes('--tag') ? process.argv[process.argv.indexOf('--tag') + 1] : undefined;
        const index = buildIndex(root);
        const result = searchIndex(index, query, { tag });
        if (jsonMode) { io.writeResult(result); } else {
          console.log(chalk.bold(`\n📋 ADR Search: "${query}" — ${result.total} results`));
          for (const r of result.results) console.log(`  ${r.id}: ${r.title} [${r.status}]`);
          console.log('');
        }
      } else {
        const result = buildIndex(root);
        if (jsonMode) { io.writeResult(result); } else {
          console.log(chalk.bold(`\n📋 ADR Index: ${result.indexed} records indexed`));
          console.log(`  Index path: ${result.index_path}\n`);
        }
      }
      return;
    }

    // ─── Item 33: Complexity Calculator ──────────────────────────────────────
    if (subcommand === 'complexity') {
      const { calculateComplexity } = await import('./lib/complexity.js');
      const jsonMode = process.argv.includes('--json');
      const io = require('./lib/io');
      const desc = process.argv[3] && !process.argv[3].startsWith('--') ? process.argv[3] : '';
      const result = calculateComplexity({ description: desc, root: process.cwd() });
      if (jsonMode) { io.writeResult(result); } else {
        console.log(chalk.bold(`\n📊 Complexity Assessment`));
        console.log(`  Recommended depth: ${result.recommended_depth}`);
        console.log(`  Score: ${result.score}`);
        console.log(`  Reasoning: ${result.reasoning}\n`);
      }
      return;
    }

    // ─── Item 47: Cross-Reference Validation ────────────────────────────────
    if (subcommand === 'crossref') {
      const { validateCrossRefs } = await import('./lib/crossref.js');
      const jsonMode = process.argv.includes('--json');
      const io = require('./lib/io');
      const specsDir = process.argv[3] && !process.argv[3].startsWith('--') ? process.argv[3] : 'specs';
      const root = process.cwd();
      const result = validateCrossRefs(specsDir, root);
      if (jsonMode) { io.writeResult(result); } else {
        console.log(chalk.bold(`\n🔗 Cross-Reference Validation`));
        console.log(`  Files scanned: ${result.files_scanned}  Total links: ${result.total_links}`);
        console.log(`  Valid: ${result.valid_links}  Broken: ${result.broken_links.length}`);
        console.log(`  Score: ${result.score}%  ${result.pass ? chalk.green('PASS') : chalk.red('FAIL')}`);
        if (result.broken_links.length > 0) {
          console.log('  Broken links:');
          for (const b of result.broken_links.slice(0, 10)) console.log(`    ${b.file}:${b.line} → ${b.target}`);
        }
        console.log('');
      }
      return;
    }

    // ─── Item 76: Interactive Init ───────────────────────────────────────────
    if (subcommand === 'init') {
      const { generateInitConfig } = await import('./lib/init.js');
      const jsonMode = process.argv.includes('--json');
      const io = require('./lib/io');
      const skillLevel = process.argv[3] && !process.argv[3].startsWith('--') ? process.argv[3] : 'intermediate';
      const projectType = process.argv.includes('--type') ? process.argv[process.argv.indexOf('--type') + 1] : 'greenfield';
      const result = generateInitConfig({ skill_level: skillLevel, project_type: projectType });
      if (jsonMode) { io.writeResult(result); } else {
        console.log(chalk.bold(`\n🎯 Init Configuration (${result.skill_level})`));
        console.log(`  Explanation depth: ${result.explanation_depth}`);
        console.log(`  Project type: ${result.project_type}`);
        console.log('  Recommendations:');
        for (const r of result.recommendations) console.log(`    • ${r}`);
        console.log('');
      }
      return;
    }

    // ─── Item 45: File Locking ──────────────────────────────────────────────
    if (subcommand === 'lock') {
      const { acquireLock, releaseLock, lockStatus, listLocks } = await import('./lib/locks.js');
      const jsonMode = process.argv.includes('--json');
      const io = require('./lib/io');
      const action = process.argv[3] || 'list';
      if (action === 'acquire') {
        const file = process.argv[4];
        const agent = process.argv[5] || 'cli';
        if (!file) { console.error(chalk.red('Usage: jumpstart-mode lock acquire <file> [agent]')); process.exit(1); }
        const result = acquireLock(file, agent);
        if (jsonMode) { io.writeResult(result); } else {
          console.log(result.success ? chalk.green(`\n✅ Lock acquired: ${file} by ${agent}\n`) : chalk.red(`\n❌ ${result.error}\n`));
        }
      } else if (action === 'release') {
        const file = process.argv[4];
        const agent = process.argv[5] || 'cli';
        if (!file) { console.error(chalk.red('Usage: jumpstart-mode lock release <file> [agent]')); process.exit(1); }
        const result = releaseLock(file, agent);
        if (jsonMode) { io.writeResult(result); } else {
          console.log(result.success ? chalk.green(`\n✅ Lock released: ${file}\n`) : chalk.red(`\n❌ ${result.error}\n`));
        }
      } else if (action === 'status') {
        const file = process.argv[4];
        if (!file) { console.error(chalk.red('Usage: jumpstart-mode lock status <file>')); process.exit(1); }
        const result = lockStatus(file);
        if (jsonMode) { io.writeResult(result); } else {
          console.log(chalk.bold('\n🔒 Lock Status'));
          console.log(`  File: ${file}`);
          console.log(`  Locked: ${result.locked}`);
          if (result.lock) console.log(`  By: ${result.lock.agent}  Since: ${result.lock.acquired_at}`);
          console.log('');
        }
      } else {
        const result = listLocks();
        if (jsonMode) { io.writeResult(result); } else {
          console.log(chalk.bold(`\n🔒 Active Locks (${result.total})`));
          for (const l of result.locks) console.log(`  ${l.file}: ${l.agent} (${l.acquired_at})`);
          if (result.total === 0) console.log('  No active locks');
          console.log('');
        }
      }
      return;
    }

    // ─── Item 60: Timestamp Utilities ────────────────────────────────────────
    if (subcommand === 'timestamp') {
      const { now, validate: validateTs, audit: auditTs } = await import('./lib/timestamps.js');
      const jsonMode = process.argv.includes('--json');
      const io = require('./lib/io');
      const action = process.argv[3] || 'now';
      if (action === 'validate') {
        const value = process.argv[4];
        if (!value) { console.error(chalk.red('Usage: jumpstart-mode timestamp validate <timestamp>')); process.exit(1); }
        const result = validateTs(value);
        if (jsonMode) { io.writeResult(result); } else {
          console.log(result.valid ? chalk.green(`\n✅ Valid: ${value}\n`) : chalk.red(`\n❌ Invalid: ${result.error}\n`));
        }
      } else if (action === 'audit') {
        const file = process.argv[4];
        if (!file) { console.error(chalk.red('Usage: jumpstart-mode timestamp audit <file>')); process.exit(1); }
        const result = auditTs(file);
        if (jsonMode) { io.writeResult(result); } else {
          console.log(chalk.bold(`\n🕐 Timestamp Audit: ${file}`));
          console.log(`  Entries: ${result.entries}  Valid: ${result.valid}  Invalid: ${result.invalid.length}`);
          if (result.invalid.length > 0) {
            for (const inv of result.invalid.slice(0, 5)) console.log(`    Line ${inv.line}: ${inv.value}`);
          }
          console.log('');
        }
      } else {
        const ts = now();
        if (jsonMode) { io.writeResult({ timestamp: ts }); } else {
          console.log(`\n🕐 ${ts}\n`);
        }
      }
      return;
    }

    // ─── Item 49: Project Scanner ────────────────────────────────────────────
    if (subcommand === 'scan') {
      const { scan: scanProject } = await import('./lib/scanner.js');
      const jsonMode = process.argv.includes('--json');
      const io = require('./lib/io');
      const root = process.argv[3] && !process.argv[3].startsWith('--') ? process.argv[3] : process.cwd();
      const result = scanProject({ root });
      if (jsonMode) { io.writeResult(result); } else {
        console.log(chalk.bold('\n🔍 Project Scan Results'));
        console.log(`  Files: ${result.stats.files}  Directories: ${result.stats.directories}`);
        if (result.stack) {
          const s = result.stack;
          if (s.language) console.log(`  Language: ${Array.isArray(s.language) ? s.language.join(', ') : s.language}`);
          if (s.runtime) console.log(`  Runtime: ${s.runtime}`);
          if (s.framework) console.log(`  Framework: ${Array.isArray(s.framework) ? s.framework.join(', ') : s.framework}`);
        }
        if (result.risks && result.risks.length > 0) {
          console.log('  Risks:');
          for (const r of result.risks.slice(0, 5)) console.log(`    ⚠ ${r}`);
        }
        console.log('');
      }
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

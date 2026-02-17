# 5-Minute Quickstart

Get from zero to Phase 0 in under 60 seconds.

## Usage

```bash
npx jumpstart-mode quickstart
```

## What It Asks

The quickstart wizard asks 4 simple questions:

| # | Question | Options | Default |
|---|----------|---------|---------|
| 1 | **Project name** | Free text | Current directory name |
| 2 | **Project type** | Greenfield / Brownfield | Auto-detected |
| 3 | **Domain** | Web App, API, CLI Tool, Library, E-Commerce, SaaS, Mobile, Data Pipeline, Other | — |
| 4 | **Ceremony level** | Light / Standard / Rigorous | Standard |

## What Each Question Means

### Project Name
The display name for your project. Used in artifact headers and config. If left blank, the directory name is used.

### Project Type
- **Greenfield** — A brand-new project. The workflow starts at Phase 0 (Challenger).
- **Brownfield** — An existing codebase. The workflow starts with the Scout agent, which analyzes your code before Phase 0.

The wizard auto-detects existing project signals (package.json, src/, .git, etc.) and pre-selects the most likely type.

### Domain
Helps the framework calibrate its domain-specific recommendations. For example, an "ecommerce" project triggers payment and inventory concerns that a "cli-tool" wouldn't need.

Choose "Other" to enter a custom domain.

### Ceremony Level
Controls how much process rigor the framework applies:

| Level | Best For | What Changes |
|-------|----------|-------------|
| **Light** | Prototypes, experiments, hackathons | Minimal docs, optional gates skipped, fast iteration |
| **Standard** | Most projects | Full spec workflow with all quality gates |
| **Rigorous** | Enterprise, regulated, high-risk | Adversarial review, peer review, strict TDD, security audits |

See [Ceremony Profiles](../bin/lib/ceremony.js) for the full settings each profile applies.

## What Happens After

1. The JumpStart framework is installed (`.jumpstart/`, `AGENTS.md`, etc.)
2. Your `config.yaml` is patched with your domain and ceremony level
3. You see a summary of your configuration
4. You're told exactly what to do next:

```
✅ JumpStart initialized!

  Project:  my-app
  Type:     greenfield
  Domain:   web-app
  Ceremony: standard
  Copilot:  enabled

  ▶ Type /jumpstart.challenge to begin!
```

For greenfield projects, your first step is `/jumpstart.challenge` — the Challenger agent will interrogate your problem space.

For brownfield projects, your first step is `/jumpstart.scout` — the Scout agent will analyze your existing codebase.

## Compared to Full Install

The quickstart is a streamlined alternative to the full `npx jumpstart-mode` interactive install. Key differences:

| | Quickstart | Full Install |
|-|-----------|-------------|
| Questions | 4 | 5+ |
| Domain selection | ✓ | ✗ |
| Ceremony level | ✓ | ✗ |
| Copilot integration | Auto-enabled | Asked |
| Approver name | Skipped | Asked |
| Time | ~30 seconds | ~2 minutes |

The full install remains available for users who want fine-grained control over every option.

## After Setup

Use `/jumpstart.next` at any time to see what to do next. Use `/jumpstart.dashboard` to see your overall progress.
